const requiredEnv = [
  'DISCORD_BOT_TOKEN',
  'LAVALINK_HOST',
  'LAVALINK_PASSWORD',
];

const defaults = {
  queueLimitFree: 50,
  queueLimitPremium: 150,
  volumeMaxFree: 125,
  volumeMaxPremium: 200,
  defaultVolume: 100,
};

function parseNumberEnv(key, fallback) {
  const value = Number.parseInt(process.env[key]?.trim() ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseIdList(value) {
  if (!value?.trim()) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

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
    premiumGuildIds: parseIdList(process.env.PREMIUM_GUILD_IDS),
    queueLimitFree: parseNumberEnv('QUEUE_LIMIT_FREE', defaults.queueLimitFree),
    queueLimitPremium: parseNumberEnv('QUEUE_LIMIT_PREMIUM', defaults.queueLimitPremium),
    volumeMaxFree: parseNumberEnv('VOLUME_MAX_FREE', defaults.volumeMaxFree),
    volumeMaxPremium: parseNumberEnv('VOLUME_MAX_PREMIUM', defaults.volumeMaxPremium),
    defaultVolume: parseNumberEnv('DEFAULT_VOLUME', defaults.defaultVolume),
  };
}
