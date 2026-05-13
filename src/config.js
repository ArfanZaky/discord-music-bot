import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";
import { resolve } from "path";

// Load .env - coba beberapa lokasi (docker volume /app atau cwd)
const paths = [".env", "/app/.env", resolve(process.cwd(), ".env")];
for (const p of paths) {
  if (existsSync(p)) {
    loadEnv({ path: p });
    break;
  }
}
import ffmpegStatic from "ffmpeg-static";

// Linux: /usr/bin/ffmpeg (docker apt). Windows: ffmpeg-static
const defaultFfmpeg = process.env.FFMPEG_PATH || (process.platform === "win32" ? ffmpegStatic : "/usr/bin/ffmpeg");

export const config = {
  token: process.env.DISCORD_TOKEN,
  prefix: "!",
  ffmpegPath: defaultFfmpeg,
};
