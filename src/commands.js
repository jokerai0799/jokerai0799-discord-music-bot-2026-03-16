import { SlashCommandBuilder } from 'discord.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song from SoundCloud via Lavalink (URL or search query)')
    .addStringOption((opt) =>
      opt.setName('query').setDescription('SoundCloud URL or search term').setRequired(true),
    ),

  new SlashCommandBuilder().setName('skip').setDescription('Skip the current song'),

  new SlashCommandBuilder().setName('pause').setDescription('Pause the current song'),

  new SlashCommandBuilder().setName('resume').setDescription('Resume the paused song'),

  new SlashCommandBuilder().setName('stop').setDescription('Stop playback and clear the queue'),

  new SlashCommandBuilder().setName('queue').setDescription('Show the current song queue'),

  new SlashCommandBuilder().setName('nowplaying').setDescription('Show the currently playing song'),

  new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove a track from the queue by its position')
    .addIntegerOption((opt) =>
      opt
        .setName('position')
        .setDescription('Use /queue to find the position (1 = next up)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(500),
    ),

  new SlashCommandBuilder().setName('shuffle').setDescription('Shuffle the upcoming queue'),

  new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Control loop mode for the current session')
    .addStringOption((opt) =>
      opt
        .setName('mode')
        .setDescription('Loop the current track, entire queue, or disable looping')
        .setRequired(true)
        .addChoices(
          { name: 'Off', value: 'off' },
          { name: 'Track', value: 'track' },
          { name: 'Queue', value: 'queue' },
        ),
    ),

  new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Set playback volume (per guild session)')
    .addIntegerOption((opt) =>
      opt
        .setName('level')
        .setDescription('1-200 (actual max depends on guild tier)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(200),
    ),

  new SlashCommandBuilder()
    .setName('premium')
    .setDescription('Show whether the current guild is marked as premium and what that includes'),
];
