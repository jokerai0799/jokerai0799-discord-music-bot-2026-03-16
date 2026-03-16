const requiredEnv = ['DISCORD_BOT_TOKEN'];

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
  };
}
