import { Client, GatewayIntentBits, Events } from "discord.js";
import { DisTube } from "distube";
import { YtDlpPlugin } from "@distube/yt-dlp";
import { SpotifyPlugin } from "@distube/spotify";
import { config } from "./config.js";
import { handleMusicCommands } from "./commands/music.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const distube = new DisTube(client, {
  emitNewSongOnly: true,
  emitAddSongWhenCreatingQueue: false,
  emitAddListWhenCreatingQueue: false,
  plugins: [new SpotifyPlugin(), new YtDlpPlugin({ update: false })],
  ffmpeg: { path: config.ffmpegPath },
});

client.distube = distube;
client.config = config;

client.once(Events.ClientReady, () => {
  console.log(`✅ Bot online sebagai ${client.user.tag}`);
  client.user.setActivity("!play | Music Bot", { type: 2 }); // type 2 = LISTENING
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(config.prefix)) return;

  const args = message.content.slice(config.prefix.length).trim().split(/ +/);
  const command = args.shift()?.toLowerCase();

  try {
    await handleMusicCommands(message, args, command);
  } catch (error) {
    console.error("Error handling command:", error);
    const errMsg = error.errorCode === "FFMPEG_NOT_INSTALLED"
      ? "❌ **FFmpeg tidak terinstal.** Pasang FFmpeg dan tambahkan ke PATH sistem."
      : error.errorCode === "YTDLP_ERROR"
        ? "❌ **Gagal mengambil audio.** Coba lagu lain atau periksa koneksi server."
        : `❌ ${error.message}`;
    try {
      await message.channel.send(errMsg);
    } catch {
      // Bot tidak punya permission, ignore
    }
  }
});

// DisTube event handlers
distube.on("playSong", (queue, song) => {
  queue.textChannel?.send(`▶️ Memutar: **${song.name}** - ${song.formattedDuration}`);
});

distube.on("addSong", (queue, song) => {
  queue.textChannel?.send(`✅ Ditambahkan ke antrean: **${song.name}**`);
});

distube.on("error", (error, queue) => {
  console.error("DisTube error:", error.message);
  const channel = queue?.textChannel;
  if (channel?.send) {
    channel.send(`❌ Error: ${error.message}`).catch(() => {});
  }
});


process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
});

const token = config.token?.trim();
if (!token) {
  console.error("❌ DISCORD_TOKEN tidak ditemukan! Cek: 1) File .env di /var/www/discordjs/  2) env_file di docker-compose");
  process.exit(1);
}
if (token.length < 50) {
  console.error("❌ DISCORD_TOKEN terlalu pendek. Copy lengkap dari Developer Portal → Bot → Reset Token");
  process.exit(1);
}

client.login(token).catch((err) => {
  console.error("Login gagal:", err.message);
  process.exit(1);
});
