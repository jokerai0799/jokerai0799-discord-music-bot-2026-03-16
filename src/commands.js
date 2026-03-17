import { SlashCommandBuilder } from 'discord.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song from SoundCloud (URL or search query)')
    .addStringOption(opt =>
      opt.setName('query').setDescription('SoundCloud URL or search term').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip the current song'),

  new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pause the current song'),

  new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Resume the paused song'),

  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop playback and clear the queue'),

  new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show the current song queue'),

  new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Show the currently playing song'),
];
