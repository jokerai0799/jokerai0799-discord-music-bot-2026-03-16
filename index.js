import { Client, GatewayIntentBits, Partials, REST, Routes } from discord.js;
import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType } from @discordjs/voice;
import dotenv from dotenv;
import ytdl from ytdl-core;
import ytSearch from yt-search;
import { SlashCommandBuilder } from @discordjs/builders;

dotenv.config();
const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages], partials: [Partials.Message] });

const queues = new Map();

function ensureQueue(guildId){ if(!queues.has(guildId)) queues.set(guildId, { textChannel: null, voiceChannel: null, connection: null, player: null, playNext: null, queue: [], playing: false }); return queues.get(guildId);} 

async function playNext(guild){ const g = ensureQueue(guild); if(!g.queue.length){ if(g.connection){ try { g.connection.destroy(); } catch(e){} finally { g.connection = null; } } g.playing = false; return; } const item = g.queue.shift(); const stream = ytdl(item.url, { quality: highestaudio, filter: audioonly }); const resource = createAudioResource(stream, { inputType: StreamType.Arbitrary }); g.player.play(resource); g.playing = true; }

client.once(ready, ()=>{ console.log(); });

client.on(interactionCreate, async interaction => {
  if(!interaction.isChatInputCommand()) return;
  const q = ensureQueue(interaction.guild.id);
  q.textChannel = interaction.channel;
  if(interaction.commandName === play){
    const query = interaction.options.getString(query);
    let url = query;
    if(!ytdl.validateURL(query)){
      const r = await ytSearch(query);
      url = (r?.videos?.length ? r.videos[0].url : null);
    }
    if(!url){ await interaction.reply({ content: No
