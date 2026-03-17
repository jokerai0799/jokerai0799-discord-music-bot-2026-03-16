# Jukebox Discord Music Bot

Slash-command music bot focused on reliable SoundCloud playback through Lavalink. The goal is to offer strong core controls today while keeping the premium roadmap honest and grounded in what actually exists.

## Current Feature Set

- ✅ SoundCloud playback via Lavalink with `/play`
- ✅ Queue controls: `/queue`, `/remove`, `/shuffle`, `/skip`, `/stop`
- ✅ Playback management: `/pause`, `/resume`, `/nowplaying`, `/loop`, `/volume`
- ✅ Server-friendly guardrails — destructive actions require you to be in the same voice channel as the bot, and the bot auto-disconnects after idle periods
- ✅ Tier-aware limits so premium-designated guilds can have longer queues and higher volume ceilings without pretending other features exist yet
- ✅ Honest `/premium` command that explains the current state vs. upcoming roadmap

## Roadmap (Planned, Not Built Yet)

These items appear in the marketing site and `/premium` output so the story remains truthful:

- Saved playlists per guild
- Multi-source playback (YouTube + Spotify linking in addition to SoundCloud)
- Optional 24/7 channel idle mode for premium guilds

Until these ship, they will remain clearly marked as planned both in the README and inside the bot response.

## Requirements

- Node.js 20.18+
- A running Lavalink node reachable from the bot
- Discord bot token with the **applications.commands** scope

## Environment Variables

Copy `.env.example` to `.env` and fill in the values:

| Name | Required | Description |
| --- | --- | --- |
| `DISCORD_BOT_TOKEN` | ✅ | Bot token from the Discord developer portal |
| `DISCORD_CLIENT_ID` | ✅ (for slash command deploy) | Application ID |
| `DISCORD_GUILD_ID` | optional | If set, commands deploy to a single guild for faster iteration |
| `NODE_ENV` | optional | Defaults to `development` |
| `LAVALINK_HOST` | ✅ | Hostname of your Lavalink node (e.g. `http://localhost`) |
| `LAVALINK_PORT` | optional | Defaults to `2333` |
| `LAVALINK_PASSWORD` | ✅ | Lavalink auth password |
| `LAVALINK_SECURE` | optional | Set to `true` when using HTTPS |
| `LAVALINK_NAME` | optional | Label for the Lavalink node in logs |
| `PREMIUM_GUILD_IDS` | optional | Comma-separated list of guild IDs that should receive premium limits |
| `QUEUE_LIMIT_FREE` | optional | Upcoming song cap for standard guilds (default `50`) |
| `QUEUE_LIMIT_PREMIUM` | optional | Upcoming song cap for premium guilds (default `150`) |
| `VOLUME_MAX_FREE` | optional | Max volume percentage standard guilds can set (default `125`) |
| `VOLUME_MAX_PREMIUM` | optional | Max volume for premium guilds (default `200`) |
| `DEFAULT_VOLUME` | optional | Starting volume applied when the bot joins (default `100`) |

## Commands

| Command | Description |
| --- | --- |
| `/play <query>` | Search SoundCloud or use a direct URL to play music |
| `/skip` | Skip the current song |
| `/pause` / `/resume` | Pause or resume playback |
| `/stop` | Clear the queue and disconnect |
| `/queue` | Show the current queue with loop + volume status |
| `/nowplaying` | Show the current song card |
| `/remove <position>` | Remove a specific upcoming track |
| `/shuffle` | Shuffle the upcoming queue |
| `/loop <off|track|queue>` | Toggle loop state |
| `/volume <level>` | Set playback volume, respecting guild limits |
| `/premium` | Display whether the guild is premium plus the honest roadmap |

All control commands require you to share the same voice channel as the bot so that servers can keep moderation tidy.

## Running the Bot

```bash
# install dependencies
npm install

# optional: register slash commands once DISCORD_CLIENT_ID is set
npm run deploy

# start the bot (requires Lavalink to be running and reachable)
npm start
```

## Tests / Checks

```bash
npm test
```

The current test suite runs `node --check` against the source files to catch syntax errors. Expand this with integration tests when adding higher-risk functionality.

## Deployment Checklist

1. Fill in `.env`
2. Register slash commands using `npm run deploy`
3. Start the bot via your preferred process manager or Railway/Nixpacks deployment
4. Use `/premium` inside a guild to confirm whether it is treated as standard or premium

If the hosted Jukebox site copy ever promises more than what appears above, update either the site or this README so they stay aligned.
