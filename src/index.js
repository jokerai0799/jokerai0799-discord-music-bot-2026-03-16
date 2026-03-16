import 'dotenv/config';
import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} from '@discordjs/voice';
import playDl from 'play-dl';
import { commands } from './commands.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

/** Per-guild queue state */
const queues = new Map();

function getQueue(guildId) {
  if (!queues.has(guildId)) {
    queues.set(guildId, {
      connection: null,
      player: null,
      songs: [],
      current: null,
      playing: false,
    });
  }
  return queues.get(guildId);
}

function destroyQueue(guildId) {
  const q = queues.get(guildId);
  if (!q) return;
  try { q.player?.stop(true); } catch { /* ignore */ }
  try { q.connection?.destroy(); } catch { /* ignore */ }
  queues.delete(guildId);
}

async function playSong(guildId, channel) {
  const q = getQueue(guildId);
  if (!q.songs.length) {
    q.current = null;
    q.playing = false;
    destroyQueue(guildId);
    return;
  }

  const song = q.songs.shift();
  q.current = song;
  q.playing = true;

  try {
    const stream = await playDl.stream(song.url);
    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
    });

    q.player.play(resource);

    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('🎵 Now Playing')
          .setDescription(`**${song.title}**`)
          .addFields({ name: 'Duration', value: song.duration, inline: true })
          .setURL(song.url),
      ],
    });
  } catch (err) {
    console.error('Playback error:', err);
    await channel.send(`⚠️ Error playing **${song.title}**: ${err.message}`);
    return playSong(guildId, channel);
  }
}

/* ── Ready ── */
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    const registered = await client.application.commands.set(
      commands.map((c) => c.toJSON()),
    );
    console.log(`Registered ${registered.size} slash commands.`);
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
});

/* ── Interaction handler ── */
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, guild, member } = interaction;
  const voiceChannel = member?.voice?.channel;
  const q = getQueue(guild.id);

  /* ── /play ── */
  if (commandName === 'play') {
    if (!voiceChannel) {
      return interaction.reply({
        content: '❌ Join a voice channel first.',
        ephemeral: true,
      });
    }

    const query = interaction.options.getString('query');
    await interaction.deferReply();

    try {
      let info;
      if (playDl.yt_validate(query) === 'video') {
        const details = await playDl.video_basic_info(query);
        info = {
          url: query,
          title: details.video_details.title,
          duration: details.video_details.durationRaw,
        };
      } else {
        const results = await playDl.search(query, { limit: 1 });
        if (!results.length) {
          return interaction.editReply('❌ No results found.');
        }
        info = {
          url: results[0].url,
          title: results[0].title,
          duration: results[0].durationRaw,
        };
      }

      q.songs.push(info);

      if (!q.connection) {
        q.connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: guild.id,
          adapterCreator: guild.voiceAdapterCreator,
        });

        q.player = createAudioPlayer();

        q.player.on(AudioPlayerStatus.Idle, () => {
          playSong(guild.id, interaction.channel);
        });

        q.player.on('error', (err) => {
          console.error('Player error:', err);
          playSong(guild.id, interaction.channel);
        });

        q.connection.subscribe(q.player);

        try {
          await entersState(q.connection, VoiceConnectionStatus.Ready, 15_000);
        } catch {
          destroyQueue(guild.id);
          return interaction.editReply('❌ Could not join voice channel.');
        }

        await interaction.editReply(`✅ Queued: **${info.title}**`);
        return playSong(guild.id, interaction.channel);
      }

      return interaction.editReply(
        `✅ Queued (#${q.songs.length}): **${info.title}**`,
      );
    } catch (err) {
      console.error('Play error:', err);
      return interaction.editReply(`⚠️ Error: ${err.message}`);
    }
  }

  /* ── /skip ── */
  if (commandName === 'skip') {
    if (!q.current) {
      return interaction.reply({ content: 'Nothing is playing.', ephemeral: true });
    }
    q.player.stop();
    return interaction.reply('⏭️ Skipped.');
  }

  /* ── /pause ── */
  if (commandName === 'pause') {
    if (!q.playing) {
      return interaction.reply({ content: 'Nothing is playing.', ephemeral: true });
    }
    q.player.pause();
    q.playing = false;
    return interaction.reply('⏸️ Paused.');
  }

  /* ── /resume ── */
  if (commandName === 'resume') {
    if (q.playing) {
      return interaction.reply({ content: 'Already playing.', ephemeral: true });
    }
    q.player.unpause();
    q.playing = true;
    return interaction.reply('▶️ Resumed.');
  }

  /* ── /stop ── */
  if (commandName === 'stop') {
    destroyQueue(guild.id);
    return interaction.reply('⏹️ Stopped and cleared the queue.');
  }

  /* ── /queue ── */
  if (commandName === 'queue') {
    if (!q.current && !q.songs.length) {
      return interaction.reply({ content: 'Queue is empty.', ephemeral: true });
    }

    const lines = [];
    if (q.current) lines.push(`▶️ **${q.current.title}** (${q.current.duration})`);
    q.songs.forEach((s, i) => lines.push(`${i + 1}. ${s.title} (${s.duration})`));

    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('📋 Queue')
          .setDescription(lines.join('\n') || 'Empty'),
      ],
    });
  }

  /* ── /nowplaying ── */
  if (commandName === 'nowplaying') {
    if (!q.current) {
      return interaction.reply({ content: 'Nothing is playing.', ephemeral: true });
    }
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('🎵 Now Playing')
          .setDescription(`**${q.current.title}** (${q.current.duration})`)
          .setURL(q.current.url),
      ],
    });
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);

export { getQueue, destroyQueue };
