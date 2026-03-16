# Discord Music Bot

Production-ready Discord music bot with slash commands for queue-based YouTube playback.

## Features

- `/play` — queue a YouTube URL or search query
- `/skip` — skip the current track
- `/pause` — pause playback
- `/resume` — resume playback
- `/stop` — stop playback and clear the queue
- `/queue` — show the current queue
- `/nowplaying` — show the current track
- Graceful shutdown for process restarts
- Environment validation at startup
- Slash command deployment script

## Requirements

- Node.js 18.18+
- A Discord bot token
- A Discord application client ID
- FFmpeg support is not required with the current `play-dl` voice flow, but voice dependencies must install successfully on the host

## Setup

```bash
npm install
cp .env.example .env
```

Set the following environment variables in `.env`:

```bash
DISCORD_BOT_TOKEN=...
DISCORD_CLIENT_ID=...
# Optional for fast guild-scoped command deployment during testing
DISCORD_GUILD_ID=...
```

## Run locally

```bash
npm run deploy
npm start
```

## Production deployment

Recommended process manager: systemd, pm2, Docker, or another supervisor that restarts the bot if it exits.

Minimum production checklist:

- Use a dedicated Discord application and bot token
- Keep `.env` out of git
- Run `npm ci --omit=dev` on the server
- Run `npm run deploy` after changing slash commands
- Keep the bot in only the servers where you actually need it
- Monitor logs for voice and playback failures

## CI

The repository includes GitHub Actions CI that installs dependencies and runs syntax checks.

## Notes

- This bot streams from YouTube search or URL input via `play-dl`
- Playback can fail if YouTube changes or upstream rate limits kick in; the bot skips failed tracks automatically
