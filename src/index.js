import { Client, Intents } from 'discord.js';
import { commands } from './commands.js';

const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_VOICE_STATES] });

client.once('ready', async () => {
  const data = await client.application.commands.set(commands.map(c => c.toJSON()));
  console.log(`Registered ${data.length} commands.`);
});

client.login(process.env.DISCORD_BOT_TOKEN);
