const requiredEnv = [
  'DISCORD_BOT_TOKEN',
  'LAVALINK_HOST',
  'LAVALINK_PASSWORD',
];

export function getConfig() {
  const missing = requiredEnv.filter((key) => !process.env[key]?.trim());

  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    discordBotToken: process.env.DISCORD_BOT_TOKEN,
    discordClientId: process.env.DISCORD_CLIENT_ID?.trim() || null,
    discordGuildId: process.env.DISCORD_GUILD_ID?.trim() || null,
    nodeEnv: process.env.NODE_ENV?.trim() || 'development',
    lavalinkHost: process.env.LAVALINK_HOST.trim(),
    lavalinkPort: Number.parseInt(process.env.LAVALINK_PORT?.trim() || '2333', 10),
    lavalinkPassword: process.env.LAVALINK_PASSWORD.trim(),
    lavalinkSecure: process.env.LAVALINK_SECURE?.trim() === 'true',
    lavalinkName: process.env.LAVALINK_NAME?.trim() || 'main',
  };
}
