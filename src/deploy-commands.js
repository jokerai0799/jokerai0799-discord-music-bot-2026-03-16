import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { commands } from './commands.js';
import { getConfig } from './config.js';

const { discordBotToken, discordClientId } = getConfig();

if (!discordClientId) {
  throw new Error('Missing DISCORD_CLIENT_ID. This is required to deploy slash commands.');
}

const rest = new REST({ version: '10' }).setToken(discordBotToken);
const body = commands.map((command) => command.toJSON());

async function main() {
  const route = discordGuildId
    ? Routes.applicationGuildCommands(discordClientId, discordGuildId)
    : Routes.applicationCommands(discordClientId);

  const scope = discordGuildId ? `guild ${discordGuildId}` : 'global';
  console.log(`Deploying ${body.length} slash commands to ${scope} scope...`);

  await rest.put(route, { body });
  console.log('Slash commands deployed successfully.');
}

main().catch((error) => {
  console.error('Failed to deploy slash commands:', error);
  process.exitCode = 1;
});
