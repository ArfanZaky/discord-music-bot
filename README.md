# Discord Music Bot

A self-hosted Discord music bot powered by **Discord.js v14** and **DisTube**. It can play music from YouTube/search queries and Spotify links, manage queues, loop/shuffle playback, and save user playlists in SQLite.

## Features

- Prefix commands with `!`
- Play from URL or YouTube search query
- Spotify link support via DisTube plugin
- Queue controls: skip, stop, pause, resume, volume, now playing
- Loop song/queue and shuffle
- User playlist storage using SQLite
- Docker-ready deployment with FFmpeg and yt-dlp

## Requirements

- Node.js 18+ recommended; production image uses Node 22
- FFmpeg installed on the host, or use the included Dockerfile
- Discord bot token with these intents enabled:
  - Server Members intent is not required
  - Message Content intent is required
  - Voice state access through normal bot permissions

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env`:

```env
DISCORD_TOKEN=your_bot_token_here
# Optional; Docker uses /usr/bin/ffmpeg
# FFMPEG_PATH=/usr/bin/ffmpeg
```

## Run locally

```bash
npm start
```

Development mode:

```bash
npm run dev
```

## Run with Docker Compose

```bash
docker compose up -d --build
```

The compose file reads `DISCORD_TOKEN` from `.env` and mounts this project into `/app`.

## Commands

| Command | Description |
| --- | --- |
| `!play <url/query>` | Play a song from URL or YouTube search |
| `!skip` | Skip current song |
| `!stop` | Stop playback and clear queue |
| `!queue` | Show current queue |
| `!pause` | Pause playback |
| `!resume` | Resume playback |
| `!volume <0-100>` | Set volume |
| `!np` | Show now playing |
| `!loop <off/song/queue>` | Set repeat mode |
| `!shuffle` | Shuffle queue |
| `!ping` | Check bot latency |
| `!saveplaylist <name>` | Save current queue |
| `!loadplaylist <name>` | Load saved playlist |
| `!myplaylists` | List your playlists |
| `!deleteplaylist <name>` | Delete a playlist |
| `!help` | Show help |

## Project Structure

```txt
src/
├── commands/music.js  # Music command handler
├── config.js          # Environment and FFmpeg config
├── db.js              # SQLite playlist storage
└── index.js           # Discord client and DisTube setup
```

## Notes

- Runtime database files are stored in `data/` and are ignored by Git.
- `.env` is ignored by Git. Never commit bot tokens.
- YouTube player cache files (`*-player-script.js`) are runtime artifacts and are ignored.
