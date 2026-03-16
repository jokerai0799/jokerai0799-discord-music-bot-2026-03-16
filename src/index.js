import 'dotenv/config';
import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
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

async function sendNowPlaying(queue, song) {
  if (!queue.textChannel) return;

  await queue.textChannel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🎵 Now Playing')
        .setDescription(formatSong(song))
        .setURL(song.url),
    ],
  });
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
    if (queue.textChannel) {
      await queue.textChannel.send(`⚠️ Error playing ${formatSong(song)}. Skipping to the next track.`);
    }
    await playNext(guildId);
  }
}

async function resolveSong(query) {
  if (playDl.yt_validate(query) === 'video') {
    const details = await playDl.video_basic_info(query);
    return {
      url: query,
      title: details.video_details.title,
      duration: details.video_details.durationRaw || 'Live',
    };
  }

  const results = await playDl.search(query, { limit: 1 });
  if (!results.length) {
    throw new Error('No results found.');
  }

  return {
    url: results[0].url,
    title: results[0].title,
    duration: results[0].durationRaw || 'Unknown',
  };
}

function ensureVoiceAccess(interaction) {
  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    return { error: '❌ Join a voice channel first.' };
  }

  const botChannelId = interaction.guild?.members?.me?.voice?.channelId;
  if (botChannelId && botChannelId !== voiceChannel.id) {
    return { error: '❌ Join the same voice channel as the bot.' };
  }

  return { voiceChannel };
}

async function connectQueue(queue, guild, voiceChannel) {
  if (queue.connection) {
    return queue.connection;
  }

  queue.connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true,
  });

  queue.player.on(AudioPlayerStatus.Idle, () => {
    playNext(guild.id).catch((error) => {
      console.error('Failed to continue queue:', error);
    });
  });

  queue.player.on('error', async (error) => {
    console.error('Player error:', error);
    if (queue.textChannel) {
      await queue.textChannel.send('⚠️ Player error occurred. Trying the next track.');
    }
    await playNext(guild.id);
  });

  queue.connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(queue.connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(queue.connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      destroyQueue(guild.id);
    }
  });

  queue.connection.subscribe(queue.player);
  await entersState(queue.connection, VoiceConnectionStatus.Ready, 15_000);
  return queue.connection;
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag} (${config.nodeEnv})`);
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
      return interaction.reply({ content: error, ephemeral: true });
    }

    const query = interaction.options.getString('query', true);
    await interaction.deferReply();

    try {
      const song = await resolveSong(query);
      queue.songs.push(song);
      queue.textChannel = interaction.channel;

      const shouldStartPlayback = !queue.current && queue.player.state.status !== AudioPlayerStatus.Playing;

      await connectQueue(queue, guild, voiceChannel);

      if (shouldStartPlayback) {
        await interaction.editReply(`✅ Added to queue: ${formatSong(song)}`);
        await playNext(guild.id);
        return;
      }

      return interaction.editReply(`✅ Added to queue (#${queue.songs.length}): ${formatSong(song)}`);
    } catch (error) {
      console.error('Play error:', error);
      if (queue.songs.length && !queue.current) {
        queue.songs = [];
      }
      return interaction.editReply(`⚠️ ${error.message}`);
    }
  }

  if (commandName === 'skip') {
    if (!queue.current) {
      return interaction.reply({ content: 'Nothing is playing.', ephemeral: true });
    }

    queue.player.stop();
    return interaction.reply('⏭️ Skipped.');
  }

  if (commandName === 'pause') {
    if (!queue.current || !queue.playing) {
      return interaction.reply({ content: 'Nothing is playing.', ephemeral: true });
    }

    queue.player.pause();
    queue.playing = false;
    return interaction.reply('⏸️ Paused.');
  }

  if (commandName === 'resume') {
    if (!queue.current) {
      return interaction.reply({ content: 'Nothing is queued right now.', ephemeral: true });
    }

    if (queue.playing) {
      return interaction.reply({ content: 'Already playing.', ephemeral: true });
    }

    queue.player.unpause();
    queue.playing = true;
    return interaction.reply('▶️ Resumed.');
  }

  if (commandName === 'stop') {
    if (!queue.current && !queue.songs.length) {
      return interaction.reply({ content: 'Nothing is playing.', ephemeral: true });
    }

    destroyQueue(guild.id);
    return interaction.reply('⏹️ Stopped and cleared the queue.');
  }

  if (commandName === 'queue') {
    if (!queue.current && !queue.songs.length) {
      return interaction.reply({ content: 'Queue is empty.', ephemeral: true });
    }

    const lines = [];
    if (queue.current) lines.push(`▶️ ${formatSong(queue.current)}`);
    queue.songs.forEach((song, index) => lines.push(`${index + 1}. ${formatSong(song)}`));

    return interaction.reply({
      embeds: [
        new EmbedBuilder().setColor(0x5865f2).setTitle('📋 Queue').setDescription(lines.join('\n')),
      ],
    });
  }

  if (commandName === 'nowplaying') {
    if (!queue.current) {
      return interaction.reply({ content: 'Nothing is playing.', ephemeral: true });
    }

    return interaction.reply({
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
