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

function getQueue(guildId) {
  if (!queues.has(guildId)) {
    queues.set(guildId, {
      player: null,
      songs: [],
      current: null,
      textChannel: null,
      voiceChannelId: null,
      idleTimer: null,
    });
  }

  return queues.get(guildId);
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
    return [hours, minutes, seconds].map((part, index) => String(part).padStart(index === 0 ? 1 : 2, '0')).join(':');
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
          { name: 'Source', value: 'SoundCloud via Lavalink', inline: true },
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
    await queue.player.stopTrack();
    await scheduleIdleDisconnect(guildId);
    return;
  }

  clearIdleTimer(queue);
  queue.current = next;
  await queue.player.playTrack({ track: { encoded: next.encoded } });
  await sendNowPlaying(queue, next);
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
    shardId: 0,
    deaf: true,
    mute: false,
  });

  player.on('end', () => {
    playNext(guild.id).catch((error) => {
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
    playNext(guild.id).catch(console.error);
  });

  queue.player = player;
  return queue;
}

client.once('clientReady', async () => {
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
    if (!queue.current || !queue.player) {
      return safeReply(interaction, { content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
    }

    await queue.player.stopTrack();
    return safeReply(interaction, '⏭️ Skipped.');
  }

  if (commandName === 'pause') {
    if (!queue.current || !queue.player) {
      return safeReply(interaction, { content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
    }

    await queue.player.setPaused(true);
    return safeReply(interaction, '⏸️ Paused.');
  }

  if (commandName === 'resume') {
    if (!queue.current || !queue.player) {
      return safeReply(interaction, { content: 'Nothing is queued right now.', flags: MessageFlags.Ephemeral });
    }

    await queue.player.setPaused(false);
    return safeReply(interaction, '▶️ Resumed.');
  }

  if (commandName === 'stop') {
    if (!queue.current && !queue.songs.length) {
      return safeReply(interaction, { content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
    }

    queue.songs = [];
    queue.current = null;
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

    const lines = [];
    if (queue.current) lines.push(`▶️ ${formatSong(queue.current)}`);
    queue.songs.forEach((song, index) => lines.push(`${index + 1}. ${formatSong(song)}`));

    return safeReply(interaction, {
      embeds: [
        new EmbedBuilder().setColor(0x5865f2).setTitle('📋 Queue').setDescription(lines.join('\n')),
      ],
    });
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
          .setURL(queue.current.url || null),
      ],
    });
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
