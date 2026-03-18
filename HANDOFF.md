# Neonix Bot Handoff

## Project location
- Local path: `/root/.openclaw/workspace/projects/neonix-music-bot-prod`
- Current purpose: Discord music bot runtime

## Current implementation truth
- Current live playback source: SoundCloud via Lavalink
- Current slash commands are defined in `src/commands.js`
- Runtime behavior and queue/player logic live in `src/index.js`
- Env parsing and defaults live in `src/config.js`

## Validation workflow
Run these before handoff:

```bash
cd /root/.openclaw/workspace/projects/neonix-music-bot-prod
npm run verify
```

## Deployment / operations
- Systemd service file: `neonix-bot.service`
- Service uses:
  - Working directory: `/root/.openclaw/workspace/projects/neonix-music-bot-prod`
  - Environment file: `/root/.openclaw/workspace/projects/neonix-music-bot-prod/.env`
- Railway/Nixpacks configs are present for app deployment paths.

## Handoff checklist
1. Keep product naming aligned as `Neonix` in docs, embeds, and service labels.
2. If slash commands change, run `npm run deploy` after environment values are correct.
3. If the bot directory moves again, update `neonix-bot.service` paths in the same change.
4. Validate with `npm run verify` before deployment.
5. Keep README truthful about what is live versus roadmap.
