import 'dotenv/config';
import { Client, GatewayIntentBits, EmbedBuilder, MessageFlags } from 'discord.js';
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  NoSubscriberBehavior,
} from '@discordjs/voice';
import playDl from 'play-dl';
import { commands } from './commands.js';
import { getConfig } from './config.js';

const config = getConfig();
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const queues = new Map();
let soundCloudReady = false;

function getQueue(guildId) {
  if (!queues.has(guildId)) {
    queues.set(guildId, {
      connection: null,
      player: createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Pause,
        },
      }),
      songs: [],
      current: null,
      textChannel: null,
      playing: false,
      playerEventsBound: false,
      connectionEventsBound: false,
    });
  }

  return queues.get(guildId);
}

function cleanupQueue(queue) {
  try {
    queue.player?.stop(true);
  } catch {}

  try {
    queue.connection?.destroy();
  } catch {}

  queue.connection = null;
  queue.connectionEventsBound = false;
}

function destroyQueue(guildId) {
  const queue = queues.get(guildId);
  if (!queue) return;

  cleanupQueue(queue);
  queues.delete(guildId);
}

function formatSong(song) {
  return `**${song.title}** (${song.duration})`;
}

async function ensureSoundCloud() {
  if (soundCloudReady) return;

  const clientId = await playDl.getFreeClientID();
  await playDl.setToken({ soundcloud: { client_id: clientId } });
  soundCloudReady = true;
  console.log('SoundCloud client initialized.');
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

async function sendNowPlaying(queue, song) {
  await safeChannelSend(queue.textChannel, {
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🎵 Now Playing')
        .setDescription(formatSong(song))
        .setURL(song.url),
    ],
  });
}

function bindPlayerEvents(queue, guildId) {
  if (queue.playerEventsBound) return;

  queue.player.on(AudioPlayerStatus.Idle, () => {
    playNext(guildId).catch((error) => {
      console.error('Failed to continue queue:', error);
    });
  });

  queue.player.on('error', async (error) => {
    console.error('Player error:', error);
    await safeChannelSend(queue.textChannel, '⚠️ Player error occurred. Trying the next track.');
    await playNext(guildId);
  });

  queue.playerEventsBound = true;
}

async function playNext(guildId) {
  const queue = queues.get(guildId);
  if (!queue) return;

  if (!queue.songs.length) {
    queue.current = null;
    queue.playing = false;
    cleanupQueue(queue);
    queues.delete(guildId);
    return;
  }

  const song = queue.songs.shift();
  queue.current = song;
  queue.playing = true;

  try {
    const stream = await playDl.stream(song.url);
    const resource = createAudioResource(stream.stream, { inputType: stream.type });
    queue.player.play(resource);
    await sendNowPlaying(queue, song);
  } catch (error) {
    console.error('Playback error:', error);
    await safeChannelSend(queue.textChannel, `⚠️ Error playing ${formatSong(song)}. Skipping to the next track.`);
    await playNext(guildId);
  }
}

async function resolveSong(query) {
  await ensureSoundCloud();

  const soundcloudValidation = playDl.so_validate(query);
  if (soundcloudValidation === 'track') {
    const details = await playDl.soundcloud(query);
    return {
      url: details.url,
      title: details.name,
      duration: details.durationRaw || 'Unknown',
      source: 'soundcloud',
    };
  }

  const soundcloudResults = await playDl.search(query, { limit: 1, source: { soundcloud: 'tracks' } });
  if (!soundcloudResults.length) {
    throw new Error('No SoundCloud results found for that query.');
  }

  return {
    url: soundcloudResults[0].url,
    title: soundcloudResults[0].name || soundcloudResults[0].title,
    duration: soundcloudResults[0].durationRaw || 'Unknown',
    source: 'soundcloud',
  };
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

function bindConnectionEvents(queue, guildId) {
  if (!queue.connection || queue.connectionEventsBound) return;

  queue.connection.on('stateChange', (oldState, newState) => {
    console.log(`Voice state [${guildId}]: ${oldState.status} -> ${newState.status}`);
  });

  queue.connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(queue.connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(queue.connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      destroyQueue(guildId);
    }
  });

  queue.connectionEventsBound = true;
}

async function connectQueue(queue, guild, voiceChannel) {
  bindPlayerEvents(queue, guild.id);

  if (!queue.connection) {
    queue.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    queue.connectionEventsBound = false;
  }

  bindConnectionEvents(queue, guild.id);
  queue.connection.subscribe(queue.player);

  try {
    await entersState(queue.connection, VoiceConnectionStatus.Ready, 15_000);
  } catch (error) {
    cleanupQueue(queue);
    throw new Error('Voice connection timed out. Check the bot voice permissions and VPS outbound UDP/network access.');
  }

  return queue.connection;
}

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag} (${config.nodeEnv})`);

  try {
    await ensureSoundCloud();
  } catch (error) {
    console.error('Failed to initialize SoundCloud client:', error);
  }
  if (!client.application) return;

  try {
    const registered = await client.application.commands.set(commands.map((command) => command.toJSON()));
    console.log(`Registered ${registered.size} global slash commands.`);
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

    const query = interaction.options.getString('query', true);

    try {
      const song = await resolveSong(query);
      queue.songs.push(song);
      queue.textChannel = interaction.channel;

      const shouldStartPlayback = !queue.current && queue.player.state.status !== AudioPlayerStatus.Playing;

      await connectQueue(queue, guild, voiceChannel);

      if (shouldStartPlayback) {
        await safeReply(interaction, `✅ Added to queue: ${formatSong(song)}`);
        await playNext(guild.id);
        return;
      }

      return safeReply(interaction, `✅ Added to queue (#${queue.songs.length}): ${formatSong(song)}`);
    } catch (error) {
      console.error('Play error:', error);
      if (queue.songs.length && !queue.current) {
        queue.songs = [];
      }
      return safeReply(interaction, `⚠️ ${error.message || 'Unable to start playback.'}`);
    }
  }

  if (commandName === 'skip') {
    if (!queue.current) {
      return safeReply(interaction, { content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
    }

    queue.player.stop();
    return safeReply(interaction, '⏭️ Skipped.');
  }

  if (commandName === 'pause') {
    if (!queue.current || !queue.playing) {
      return safeReply(interaction, { content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
    }

    queue.player.pause();
    queue.playing = false;
    return safeReply(interaction, '⏸️ Paused.');
  }

  if (commandName === 'resume') {
    if (!queue.current) {
      return safeReply(interaction, { content: 'Nothing is queued right now.', flags: MessageFlags.Ephemeral });
    }

    if (queue.playing) {
      return safeReply(interaction, { content: 'Already playing.', flags: MessageFlags.Ephemeral });
    }

    queue.player.unpause();
    queue.playing = true;
    return safeReply(interaction, '▶️ Resumed.');
  }

  if (commandName === 'stop') {
    if (!queue.current && !queue.songs.length) {
      return safeReply(interaction, { content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
    }

    destroyQueue(guild.id);
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
          .setURL(queue.current.url),
      ],
    });
  }
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
    destroyQueue(guildId);
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

export { destroyQueue, getQueue };
