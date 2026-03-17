import 'dotenv/config';
import { Client, GatewayIntentBits, EmbedBuilder, MessageFlags, Routes, REST } from 'discord.js';
import { Connectors, Shoukaku } from 'shoukaku';
import { commands } from './commands.js';
import { getConfig } from './config.js';

const config = getConfig();
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const nodes = [
  {
    name: config.lavalinkName,
    url: `${config.lavalinkHost}:${config.lavalinkPort}`,
    auth: config.lavalinkPassword,
    secure: config.lavalinkSecure,
  },
];

const shoukaku = new Shoukaku(new Connectors.DiscordJS(client), nodes, {
  moveOnDisconnect: false,
  resume: false,
  reconnectTries: 3,
  reconnectInterval: 5_000,
  restTimeout: 15_000,
});

const rest = new REST({ version: '10' }).setToken(config.discordBotToken);
const queues = new Map();
const IDLE_DISCONNECT_MS = 60_000;

const LOOP_MODES = {
  OFF: 'off',
  TRACK: 'track',
  QUEUE: 'queue',
};

function bootstrapQueue(guildId) {
  const isPremium = config.premiumGuildIds.includes(guildId);
  return {
    player: null,
    songs: [],
    current: null,
    textChannel: null,
    voiceChannelId: null,
    idleTimer: null,
    loop: LOOP_MODES.OFF,
    volume: Math.min(config.defaultVolume, isPremium ? config.volumeMaxPremium : config.volumeMaxFree),
    isPremium,
    maxSize: isPremium ? config.queueLimitPremium : config.queueLimitFree,
    volumeMax: isPremium ? config.volumeMaxPremium : config.volumeMaxFree,
  };
}

function getQueue(guildId) {
  if (!queues.has(guildId)) {
    queues.set(guildId, bootstrapQueue(guildId));
  }

  const queue = queues.get(guildId);
  const isPremium = config.premiumGuildIds.includes(guildId);
  queue.isPremium = isPremium;
  queue.maxSize = isPremium ? config.queueLimitPremium : config.queueLimitFree;
  queue.volumeMax = isPremium ? config.volumeMaxPremium : config.volumeMaxFree;
  queue.volume = Math.min(queue.volume, queue.volumeMax);

  return queue;
}

function formatSong(song) {
  const duration = song.isStream ? 'Live' : formatDuration(song.length);
  return `**${song.title}** (${duration})`;
}

function formatDuration(ms) {
  if (!ms || ms < 0) return 'Unknown';

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return [hours, minutes, seconds]
      .map((part, index) => String(part).padStart(index === 0 ? 1 : 2, '0'))
      .join(':');
  }

  return [minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

async function safeChannelSend(channel, payload) {
  if (!channel) return;

  try {
    await channel.send(payload);
  } catch (error) {
    console.error('Failed to send channel message:', error);
  }
}

async function safeReply(interaction, payload) {
  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply(payload);
    }

    return await interaction.reply(payload);
  } catch (error) {
    if (error?.code === 10062) {
      console.warn('Interaction expired before reply could be sent.');
      return null;
    }

    console.error('Interaction reply failed:', error);
    return null;
  }
}

async function safeDefer(interaction) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply();
    }
    return true;
  } catch (error) {
    if (error?.code === 10062) {
      console.warn('Interaction expired before deferReply could be sent.');
      return false;
    }

    console.error('deferReply failed:', error);
    return false;
  }
}

function ensureVoiceAccess(interaction) {
  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    return { error: '❌ Join a voice channel first.' };
  }

  const permissions = voiceChannel.permissionsFor(interaction.guild.members.me);
  if (!permissions?.has(['Connect', 'Speak'])) {
    return { error: '❌ I need Connect and Speak permissions in that voice channel.' };
  }

  const botChannelId = interaction.guild?.members?.me?.voice?.channelId;
  if (botChannelId && botChannelId !== voiceChannel.id) {
    return { error: '❌ Join the same voice channel as the bot.' };
  }

  return { voiceChannel };
}

function ensureControlAccess(interaction, queue) {
  if (!queue?.player) {
    return { error: 'I am not connected to a voice channel right now.' };
  }

  const memberChannel = interaction.member?.voice?.channel;
  if (!memberChannel) {
    return { error: 'Join a voice channel to use that command.' };
  }

  const botChannelId = interaction.guild?.members?.me?.voice?.channelId;
  if (!botChannelId) {
    return { error: 'I am not connected to voice right now.' };
  }

  if (memberChannel.id !== botChannelId) {
    return { error: 'Join the same voice channel as the bot to use that command.' };
  }

  return { voiceChannel: memberChannel };
}

function formatLoopLabel(loopMode) {
  if (loopMode === LOOP_MODES.TRACK) return 'Track';
  if (loopMode === LOOP_MODES.QUEUE) return 'Queue';
  return 'Off';
}

async function registerCommands() {
  if (!client.application || !config.discordClientId) return;

  const body = commands.map((command) => command.toJSON());

  if (config.discordGuildId) {
    await rest.put(Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId), { body });
    await rest.put(Routes.applicationCommands(config.discordClientId), { body: [] });
    console.log(`Registered ${body.length} guild slash commands and cleared global command drift.`);
    return;
  }

  await rest.put(Routes.applicationCommands(config.discordClientId), { body });
  console.log(`Registered ${body.length} global slash commands.`);
}

async function resolveTrack(query) {
  const node = shoukaku.getIdealNode();
  if (!node) {
    throw new Error('No Lavalink node is available. Check LAVALINK_HOST / LAVALINK_PASSWORD / LAVALINK_PORT.');
  }

  const identifier = /^https?:\/\//i.test(query) ? query : `scsearch:${query}`;
  const result = await node.rest.resolve(identifier);

  if (!result) {
    throw new Error('Lavalink returned no search result.');
  }

  if (result.loadType === 'error') {
    throw new Error(result.data?.message || 'Lavalink search failed.');
  }

  if (result.loadType === 'empty' || !result.data?.length) {
    throw new Error('No SoundCloud results found for that query.');
  }

  const [track] = result.data;
  return {
    encoded: track.encoded,
    identifier: track.info.identifier,
    title: track.info.title,
    url: track.info.uri,
    author: track.info.author,
    length: track.info.length,
    isStream: track.info.isStream,
  };
}

async function sendNowPlaying(queue, song) {
  await safeChannelSend(queue.textChannel, {
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🎵 Now Playing')
        .setDescription(formatSong(song))
        .setURL(song.url || null)
        .addFields(
          { name: 'Artist', value: song.author || 'Unknown', inline: true },
          { name: 'Loop', value: formatLoopLabel(queue.loop), inline: true },
          { name: 'Volume', value: `${queue.volume}%`, inline: true },
        ),
    ],
  });
}

function clearIdleTimer(queue) {
  if (!queue?.idleTimer) return;
  clearTimeout(queue.idleTimer);
  queue.idleTimer = null;
}

async function scheduleIdleDisconnect(guildId) {
  const queue = queues.get(guildId);
  if (!queue?.player) return;

  clearIdleTimer(queue);
  queue.idleTimer = setTimeout(async () => {
    const latestQueue = queues.get(guildId);
    if (!latestQueue?.player || latestQueue.current || latestQueue.songs.length) {
      return;
    }

    await safeChannelSend(latestQueue.textChannel, '👋 Leaving voice channel after 60 seconds of inactivity.');
    await destroyQueue(guildId);
  }, IDLE_DISCONNECT_MS);
}

async function destroyQueue(guildId) {
  const queue = queues.get(guildId);
  if (!queue) return;

  clearIdleTimer(queue);
  queue.current = null;
  queue.songs = [];
  queue.player = null;
  queue.voiceChannelId = null;

  try {
    await shoukaku.leaveVoiceChannel(guildId);
  } catch (error) {
    console.error('Failed to leave voice channel cleanly:', error);
  }

  queues.delete(guildId);
}

async function playNext(guildId) {
  const queue = queues.get(guildId);
  if (!queue?.player) return;

  const next = queue.songs.shift();
  if (!next) {
    queue.current = null;
    await scheduleIdleDisconnect(guildId);
    return;
  }

  clearIdleTimer(queue);
  queue.current = next;

  try {
    await queue.player.playTrack({ track: { encoded: next.encoded } });
    await queue.player.setVolume(queue.volume);
    await sendNowPlaying(queue, next);
  } catch (error) {
    console.error('Failed to start next track:', error);
    queue.current = null;
    if (queue.songs.length) {
      await playNext(guildId);
    } else {
      await scheduleIdleDisconnect(guildId);
    }
  }
}

async function handleTrackFinished(guildId, reason = 'finished') {
  const queue = queues.get(guildId);
  if (!queue) return;

  const finished = queue.current;
  queue.current = null;
  const finishedNaturally = reason === 'finished';

  if (finishedNaturally && queue.loop === LOOP_MODES.TRACK && finished) {
    queue.songs.unshift(finished);
  } else if (finishedNaturally && queue.loop === LOOP_MODES.QUEUE && finished) {
    queue.songs.push(finished);
  }

  await playNext(guildId);
}

async function ensurePlayer(guild, voiceChannel, textChannel) {
  const queue = getQueue(guild.id);
  queue.textChannel = textChannel;
  queue.voiceChannelId = voiceChannel.id;

  if (queue.player) {
    return queue;
  }

  if (!shoukaku.getIdealNode()) {
    throw new Error('No Lavalink node is connected.');
  }

  const player = await shoukaku.joinVoiceChannel({
    guildId: guild.id,
    channelId: voiceChannel.id,
    shardId: guild.shardId ?? 0,
    deaf: true,
    mute: false,
  });

  player.on('end', (event) => {
    if (event?.reason === 'replaced' || event?.reason === 'cleanup') {
      return;
    }

    handleTrackFinished(guild.id, event?.reason).catch((error) => {
      console.error('Failed to continue queue:', error);
    });
  });

  player.on('closed', () => {
    destroyQueue(guild.id).catch(console.error);
  });

  player.on('exception', (error) => {
    console.error('Lavalink player exception:', error);
  });

  player.on('stuck', (error) => {
    console.error('Lavalink player stuck:', error);
    handleTrackFinished(guild.id, 'stuck').catch(console.error);
  });

  queue.player = player;
  await queue.player.setGlobalVolume(queue.volume);
  return queue;
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag} (${config.nodeEnv})`);

  try {
    await registerCommands();
  } catch (error) {
    console.error('Failed to register commands on startup:', error);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.inGuild()) {
    return;
  }

  const { commandName, guild } = interaction;
  const queue = getQueue(guild.id);

  if (commandName === 'play') {
    const { voiceChannel, error } = ensureVoiceAccess(interaction);
    if (error) {
      return safeReply(interaction, { content: error, flags: MessageFlags.Ephemeral });
    }

    const deferred = await safeDefer(interaction);
    if (!deferred) return;

    if (queue.songs.length >= queue.maxSize) {
      const note = queue.isPremium
        ? ''
        : '\nPremium tiers (on the roadmap) will raise this limit once available.';
      return safeReply(
        interaction,
        `⚠️ Queue limit reached (${queue.maxSize} upcoming tracks). Remove something before adding more.${note}`,
      );
    }

    try {
      const song = await resolveTrack(interaction.options.getString('query', true));
      await ensurePlayer(guild, voiceChannel, interaction.channel);

      clearIdleTimer(queue);
      queue.songs.push(song);
      const shouldStart = !queue.current;

      if (shouldStart) {
        await safeReply(interaction, `✅ Added to queue: ${formatSong(song)}`);
        await playNext(guild.id);
      } else {
        await safeReply(interaction, `✅ Added to queue (#${queue.songs.length}): ${formatSong(song)}`);
      }
      return;
    } catch (playError) {
      console.error('Play error:', playError);
      return safeReply(interaction, `⚠️ ${playError.message || 'Unable to start playback.'}`);
    }
  }

  if (commandName === 'skip') {
    const { error } = ensureControlAccess(interaction, queue);
    if (error) {
      return safeReply(interaction, { content: error, flags: MessageFlags.Ephemeral });
    }

    if (!queue.current || !queue.player) {
      return safeReply(interaction, { content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
    }

    await queue.player.stopTrack();
    return safeReply(interaction, '⏭️ Skipped.');
  }

  if (commandName === 'pause') {
    const { error } = ensureControlAccess(interaction, queue);
    if (error) {
      return safeReply(interaction, { content: error, flags: MessageFlags.Ephemeral });
    }

    if (!queue.current || !queue.player) {
      return safeReply(interaction, { content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
    }

    await queue.player.setPaused(true);
    return safeReply(interaction, '⏸️ Paused.');
  }

  if (commandName === 'resume') {
    const { error } = ensureControlAccess(interaction, queue);
    if (error) {
      return safeReply(interaction, { content: error, flags: MessageFlags.Ephemeral });
    }

    if (!queue.current || !queue.player) {
      return safeReply(interaction, { content: 'Nothing is queued right now.', flags: MessageFlags.Ephemeral });
    }

    await queue.player.setPaused(false);
    return safeReply(interaction, '▶️ Resumed.');
  }

  if (commandName === 'stop') {
    const { error } = ensureControlAccess(interaction, queue);
    if (error) {
      return safeReply(interaction, { content: error, flags: MessageFlags.Ephemeral });
    }

    if (!queue.current && !queue.songs.length) {
      return safeReply(interaction, { content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
    }

    queue.songs = [];
    queue.current = null;
    queue.loop = LOOP_MODES.OFF;
    clearIdleTimer(queue);
    try {
      await queue.player?.stopTrack();
    } catch {}
    await destroyQueue(guild.id);
    return safeReply(interaction, '⏹️ Stopped and cleared the queue.');
  }

  if (commandName === 'queue') {
    if (!queue.current && !queue.songs.length) {
      return safeReply(interaction, { content: 'Queue is empty.', flags: MessageFlags.Ephemeral });
    }

    const description = [];
    if (queue.current) {
      description.push(`▶️ ${formatSong(queue.current)}`);
    }

    if (queue.songs.length) {
      queue.songs.forEach((song, index) => {
        description.push(`${index + 1}. ${formatSong(song)}`);
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('📋 Queue')
      .setDescription(description.join('\n'))
      .setFooter({
        text: `Loop: ${formatLoopLabel(queue.loop)} • Volume: ${queue.volume}% • ${
          queue.isPremium ? 'Premium' : 'Standard'
        } guild limit: ${queue.maxSize}`,
      });

    return safeReply(interaction, { embeds: [embed] });
  }

  if (commandName === 'nowplaying') {
    if (!queue.current) {
      return safeReply(interaction, { content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
    }

    return safeReply(interaction, {
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('🎵 Now Playing')
          .setDescription(formatSong(queue.current))
          .setURL(queue.current.url || null)
          .addFields(
            { name: 'Artist', value: queue.current.author || 'Unknown', inline: true },
            { name: 'Loop', value: formatLoopLabel(queue.loop), inline: true },
            { name: 'Volume', value: `${queue.volume}%`, inline: true },
          ),
      ],
    });
  }

  if (commandName === 'remove') {
    const { error } = ensureControlAccess(interaction, queue);
    if (error) {
      return safeReply(interaction, { content: error, flags: MessageFlags.Ephemeral });
    }

    if (!queue.songs.length) {
      return safeReply(interaction, { content: 'Queue is empty.', flags: MessageFlags.Ephemeral });
    }

    const position = interaction.options.getInteger('position', true);
    if (position < 1 || position > queue.songs.length) {
      return safeReply(
        interaction,
        { content: `Position must be between 1 and ${queue.songs.length}.`, flags: MessageFlags.Ephemeral },
      );
    }

    const [removed] = queue.songs.splice(position - 1, 1);
    return safeReply(interaction, `🗑️ Removed: ${formatSong(removed)}`);
  }

  if (commandName === 'shuffle') {
    const { error } = ensureControlAccess(interaction, queue);
    if (error) {
      return safeReply(interaction, { content: error, flags: MessageFlags.Ephemeral });
    }

    if (queue.songs.length < 2) {
      return safeReply(interaction, { content: 'Need at least 2 songs queued to shuffle.', flags: MessageFlags.Ephemeral });
    }

    for (let i = queue.songs.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue.songs[i], queue.songs[j]] = [queue.songs[j], queue.songs[i]];
    }

    return safeReply(interaction, '🔀 Shuffled the upcoming songs.');
  }

  if (commandName === 'loop') {
    const { error } = ensureControlAccess(interaction, queue);
    if (error) {
      return safeReply(interaction, { content: error, flags: MessageFlags.Ephemeral });
    }

    if (!queue.player) {
      return safeReply(interaction, { content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
    }

    const mode = interaction.options.getString('mode', true);
    if (!Object.values(LOOP_MODES).includes(mode)) {
      return safeReply(interaction, { content: 'Invalid loop mode.', flags: MessageFlags.Ephemeral });
    }

    queue.loop = mode;
    return safeReply(interaction, `🔁 Loop mode set to **${formatLoopLabel(mode)}**.`);
  }

  if (commandName === 'volume') {
    const { error } = ensureControlAccess(interaction, queue);
    if (error) {
      return safeReply(interaction, { content: error, flags: MessageFlags.Ephemeral });
    }

    const requested = interaction.options.getInteger('level', true);
    const max = queue.volumeMax;
    if (requested < 1 || requested > max) {
      return safeReply(
        interaction,
        {
          content: `Volume must be between 1 and ${max}%.${
            queue.isPremium ? '' : ' Higher ceilings unlock once premium tiers launch.'
          }`,
          flags: MessageFlags.Ephemeral,
        },
      );
    }

    queue.volume = requested;
    try {
      await queue.player?.setGlobalVolume(requested);
    } catch (error) {
      console.error('Failed to set volume:', error);
      return safeReply(interaction, '⚠️ Volume set internally, but Lavalink did not accept the change.');
    }

    return safeReply(interaction, `🔊 Volume set to ${requested}%.`);
  }

  if (commandName === 'premium') {
    const currentTier = queue.isPremium ? 'Premium' : 'Standard';
    const liveBenefits = [
      `• Queue limit: up to ${queue.maxSize} songs`,
      `• Volume ceiling: ${queue.volumeMax}%`,
    ];

    const planned = [
      '• Saved playlists per guild',
      '• Multi-source playback (YouTube + Spotify linking)',
      '• Optional 24/7 channel idle mode',
    ];

    const embed = new EmbedBuilder()
      .setColor(queue.isPremium ? 0xfbbf24 : 0x5865f2)
      .setTitle('Jukebox Premium Status')
      .setDescription(
        queue.isPremium
          ? 'This guild is flagged as Premium in the bot configuration.'
          : 'This guild is currently using the standard feature set.',
      )
      .addFields(
        { name: 'Current tier', value: currentTier, inline: true },
        { name: 'Working benefits', value: liveBenefits.join('\n') || 'Standard limits', inline: false },
        {
          name: 'Roadmap (not yet live)',
          value: planned.join('\n'),
          inline: false,
        },
      );

    return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
  }
});

shoukaku.on('ready', (name) => {
  console.log(`Lavalink node ready: ${name}`);
});

shoukaku.on('error', (name, error) => {
  console.error(`Lavalink node error [${name}]:`, error);
});

client.on('error', (error) => {
  console.error('Discord client error:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

async function shutdown(signal) {
  console.log(`Received ${signal}. Shutting down gracefully...`);
  for (const guildId of queues.keys()) {
    await destroyQueue(guildId);
  }

  await client.destroy();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT').catch(console.error));
process.on('SIGTERM', () => shutdown('SIGTERM').catch(console.error));

client.login(config.discordBotToken).catch((error) => {
  console.error('Discord login failed:', error);
  process.exit(1);
});
