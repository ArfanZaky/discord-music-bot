import { Client, GatewayIntentBits, Events } from "discord.js";
import { DisTube } from "distube";
import { YtDlpPlugin, json } from "@distube/yt-dlp";
import { SpotifyPlugin } from "@distube/spotify";
import { config } from "./config.js";
import { handleMusicCommands } from "./commands/music.js";
import { MusicPanelManager } from "./panel.js";

// Custom YtDlpPlugin with search capability, reliable client & stream recovery
export class SafeYtDlpPlugin extends YtDlpPlugin {
  type = "extractor";

  async searchSong(query, options) {
    const res = await this.resolve(`ytsearch1:${query}`, options);
    if (res?.songs?.length) return res.songs[0];
    return res;
  }

  async getStreamURL(song) {
    if (!song.url) {
      throw new Error("Cannot get stream url from invalid song.");
    }
    // YouTube stream extraction with format fallback and stable player clients
    const info = await json(song.url, {
      dumpSingleJson: true,
      noWarnings: true,
      preferFreeFormats: true,
      skipDownload: true,
      simulate: true,
      format: "ba/ba*/b",
      extractorArgs: "youtube:player_client=android,web",
    }).catch((e) => {
      throw new Error(`${e.stderr || e}`);
    });
    if (Array.isArray(info.entries)) {
      throw new Error("Cannot get stream URL of an entire playlist");
    }
    return info.url;
  }
}

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
  plugins: [new SpotifyPlugin(), new SafeYtDlpPlugin({ update: false })],
  ffmpeg: {
    path: config.ffmpegPath,
    args: {
      global: {},
      input: {
        reconnect: 1,
        reconnect_streamed: 1,
        reconnect_delay_max: 5,
        reconnect_at_eof: 1,
        reconnect_on_network_error: 1,
        reconnect_on_http_error: "4xx,5xx",
      },
      output: {},
    },
  },
});

const MUSIC_CHANNEL_ID = "1485833926302892136";
const musicPanel = new MusicPanelManager(client, MUSIC_CHANNEL_ID);

client.distube = distube;
client.config = config;
client.musicPanel = musicPanel;

client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot online sebagai ${client.user.tag}`);
  client.user.setActivity("!play | Music Bot", { type: 2 }); // type 2 = LISTENING

  // Initialize persistent music controller panel
  await musicPanel.init().catch((e) => console.error("Init panel error:", e));
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    await musicPanel.handleInteraction(interaction);
  } catch (error) {
    console.error("Interaction handling error:", error);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: `❌ Error: ${error.message}`, flags: [1 << 6] }).catch(() => {});
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  // Intercept messages inside the designated music control channel
  if (message.channel.id === MUSIC_CHANNEL_ID) {
    await musicPanel.handleDirectMessage(message);
    if (!message.content.startsWith(config.prefix)) {
      return;
    }
  }

  if (!message.content.startsWith(config.prefix)) return;

  const args = message.content.slice(config.prefix.length).trim().split(/ +/);
  const command = args.shift()?.toLowerCase();

  try {
    await handleMusicCommands(message, args, command);
    musicPanel.scheduleRefresh(message.guild);
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
  if (queue.textChannel?.id !== MUSIC_CHANNEL_ID) {
    queue.textChannel?.send(`▶️ Memutar: **${song.name}** - ${song.formattedDuration}`);
  }
  musicPanel.scheduleRefresh(queue.textChannel?.guild);
});

distube.on("addSong", (queue, song) => {
  if (queue.textChannel?.id !== MUSIC_CHANNEL_ID) {
    queue.textChannel?.send(`✅ Ditambahkan ke antrean: **${song.name}**`);
  }
  musicPanel.scheduleRefresh(queue.textChannel?.guild);
});

distube.on("finishSong", (queue) => {
  musicPanel.scheduleRefresh(queue.textChannel?.guild);
});

distube.on("finish", (queue) => {
  musicPanel.scheduleRefresh(queue.textChannel?.guild);
});

distube.on("deleteQueue", (queue) => {
  musicPanel.scheduleRefresh(queue.textChannel?.guild);
});

distube.on("error", (error, queue) => {
  console.error("DisTube error:", error.message);
  const channel = queue?.textChannel;
  if (channel?.send && channel.id !== MUSIC_CHANNEL_ID) {
    channel.send(`❌ Error: ${error.message}`).catch(() => {});
  }
  if (queue?.textChannel?.guild) {
    musicPanel.scheduleRefresh(queue.textChannel.guild);
  }
});

distube.on("empty", (queue) => {
  if (queue.textChannel?.id !== MUSIC_CHANNEL_ID) {
    queue.textChannel?.send("Voice channel kosong! Meninggalkan channel...");
  }
  queue.voice.leave();
  musicPanel.scheduleRefresh(queue.textChannel?.guild);
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
});

const token = config.token?.trim();
if (!token) {
  console.error("❌ DISCORD_TOKEN tidak ditemukan!");
  process.exit(1);
}

client.login(token).catch((err) => {
  console.error("Login gagal:", err.message);
  process.exit(1);
});
