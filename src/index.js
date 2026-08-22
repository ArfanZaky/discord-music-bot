import { Client, GatewayIntentBits, Events, Routes } from "discord.js";
import { getVoiceConnection, VoiceConnectionStatus } from "@discordjs/voice";
import { DisTube } from "distube";
import { YtDlpPlugin, json } from "@distube/yt-dlp";
import { SpotifyPlugin } from "@distube/spotify";
import { config } from "./config.js";
import { handleMusicCommands } from "./commands/music.js";
import { MusicPanelManager } from "./panel.js";

// Custom YtDlpPlugin with search capability and reliable audio extraction format
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
    // YouTube stream extraction with format fallback
    const info = await json(song.url, {
      dumpSingleJson: true,
      noWarnings: true,
      preferFreeFormats: true,
      skipDownload: true,
      simulate: true,
      format: "ba/ba*",
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
  ffmpeg: { path: config.ffmpegPath },
});

const MUSIC_CHANNEL_ID = "1485833926302892136";
const musicPanel = new MusicPanelManager(client, MUSIC_CHANNEL_ID);

client.distube = distube;
client.config = config;
client.musicPanel = musicPanel;

const EMPTY_VOICE_DISCONNECT_DELAY_MS = 5_000;
const EMPTY_VOICE_SWEEP_INTERVAL_MS = 15_000;
const EMPTY_VOICE_DISCONNECT_COOLDOWN_MS = 60_000;
const EMPTY_VOICE_AUTO_DISCONNECT_ENABLED = false;
const emptyVoiceDisconnectTimers = new Map();
const emptyVoiceDisconnectCooldowns = new Map();

function getBotVoiceChannel(guild) {
  return guild?.members?.me?.voice?.channel ?? null;
}

async function getFreshBotVoiceChannel(guild) {
  const me = await guild?.members?.fetchMe?.().catch(() => guild?.members?.me);
  return me?.voice?.channel ?? null;
}

function hasHumanMembers(channel) {
  return Boolean(channel?.members?.some((member) => !member.user.bot));
}

function clearEmptyVoiceDisconnectTimer(guildId) {
  const timer = emptyVoiceDisconnectTimers.get(guildId);
  if (timer) {
    clearTimeout(timer);
    emptyVoiceDisconnectTimers.delete(guildId);
  }
}

async function sendOwnVoiceStateLeave(guildId) {
  const guild = client.guilds.cache.get(guildId);
  const payload = {
    op: 4,
    d: {
      guild_id: guildId,
      channel_id: null,
      self_deaf: true,
      self_mute: true,
    },
  };

  const shard = guild?.shard;
  if (shard?.send) {
    shard.send(payload);
    return true;
  }

  await client.ws?._ws?.send?.(guild?.shardId ?? 0, payload);
  return true;
}

async function forceBotVoiceStateLeave(guildId) {
  await sendOwnVoiceStateLeave(guildId).catch((error) => {
    console.error("Gagal kirim gateway leave voice:", error);
  });

  await client.rest.patch(Routes.guildMember(guildId, client.user.id), {
    body: { channel_id: null },
    reason: "Auto-disconnect: voice channel kosong",
  }).catch((error) => {
    console.error("Gagal REST clear voice state:", error);
  });
}

function disableVoiceReconnect(connection) {
  if (!connection) return;
  connection.joinConfig.channelId = null;
  connection.rejoin = () => false;
  connection.removeAllListeners(VoiceConnectionStatus.Disconnected);
}

function disconnectVoiceConnection(connection) {
  if (!connection) return;
  disableVoiceReconnect(connection);
  if (
    connection.state.status !== VoiceConnectionStatus.Destroyed &&
    connection.state.status !== VoiceConnectionStatus.Signalling
  ) {
    connection.disconnect();
  }
}

function destroyVoiceConnection(connection, adapterAvailable = true) {
  if (!connection) return;
  disableVoiceReconnect(connection);
  if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
    connection.destroy(adapterAvailable);
  }
}

async function forceLeaveEmptyVoice(guild, guildId) {
  const distubeVoice = distube.voices.get(guildId);
  const groupedConnection = getVoiceConnection(guildId, client.user?.id);
  const defaultConnection = getVoiceConnection(guildId);

  distubeVoice?.stop?.(true);
  disableVoiceReconnect(distubeVoice?.connection);
  disableVoiceReconnect(groupedConnection);
  disableVoiceReconnect(defaultConnection);

  disconnectVoiceConnection(distubeVoice?.connection);
  disconnectVoiceConnection(groupedConnection);
  disconnectVoiceConnection(defaultConnection);

  distube.voices.leave(guildId);
  distube.voices.remove(guildId);
  distube.queues.remove(guildId);

  await forceBotVoiceStateLeave(guildId);

  const me = await guild.members.fetchMe({ force: true }).catch(() => guild.members.me);
  await me?.voice?.disconnect?.("Auto-disconnect: voice channel kosong").catch(() => {});

  destroyVoiceConnection(distubeVoice?.connection, false);
  destroyVoiceConnection(groupedConnection, false);
  destroyVoiceConnection(defaultConnection, false);

  setTimeout(async () => {
    const freshMe = await guild.members.fetchMe({ force: true }).catch(() => guild.members.me);
    if (freshMe?.voice?.channel) {
      await forceBotVoiceStateLeave(guildId);
      await freshMe.voice.disconnect("Auto-disconnect retry: voice channel kosong").catch(() => {});
    }
  }, 2_000).unref?.();
}

function scheduleEmptyVoiceDisconnect(guild) {
  if (!EMPTY_VOICE_AUTO_DISCONNECT_ENABLED) return;
  const guildId = guild?.id;
  if (!guildId) return;

  const botVoiceChannel = getBotVoiceChannel(guild);
  if (!botVoiceChannel || hasHumanMembers(botVoiceChannel)) {
    clearEmptyVoiceDisconnectTimer(guildId);
    return;
  }

  if (emptyVoiceDisconnectTimers.has(guildId)) return;

  const lastDisconnectAt = emptyVoiceDisconnectCooldowns.get(guildId) ?? 0;
  if (Date.now() - lastDisconnectAt < EMPTY_VOICE_DISCONNECT_COOLDOWN_MS) return;

  const timer = setTimeout(async () => {
    emptyVoiceDisconnectTimers.delete(guildId);

    const currentBotVoiceChannel = await getFreshBotVoiceChannel(guild);
    if (!currentBotVoiceChannel || hasHumanMembers(currentBotVoiceChannel)) return;

    try {
      await forceLeaveEmptyVoice(guild, guildId);
      emptyVoiceDisconnectCooldowns.set(guildId, Date.now());
      console.log(`👋 Auto-disconnect dari ${currentBotVoiceChannel.name}: voice channel kosong.`);
    } catch (error) {
      console.error("Gagal auto-disconnect dari voice channel kosong:", error);
    }
  }, EMPTY_VOICE_DISCONNECT_DELAY_MS);
  timer.unref?.();
  emptyVoiceDisconnectTimers.set(guildId, timer);
}

client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot online sebagai ${client.user.tag}`);
  client.user.setActivity("!play | Music Bot", { type: 2 }); // type 2 = LISTENING

  // Initialize persistent music controller panel
  await musicPanel.init().catch((e) => console.error("Init panel error:", e));

  setTimeout(async () => {
    for (const guild of client.guilds.cache.values()) {
      const channel = await getFreshBotVoiceChannel(guild);
      if (channel && !hasHumanMembers(channel)) {
        await forceBotVoiceStateLeave(guild.id).catch((error) => {
          console.error("Gagal clear stale voice saat startup:", error);
        });
        console.log(`👋 Clear stale voice dari ${channel.name}: voice channel kosong.`);
      }
    }
  }, 2_000).unref?.();

  setInterval(() => {
    for (const guild of client.guilds.cache.values()) {
      scheduleEmptyVoiceDisconnect(guild);
    }
  }, EMPTY_VOICE_SWEEP_INTERVAL_MS).unref?.();
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  const guild = newState.guild ?? oldState.guild;
  const botVoiceChannel = getBotVoiceChannel(guild);
  if (!botVoiceChannel) {
    clearEmptyVoiceDisconnectTimer(guild?.id);
    return;
  }

  const affectedChannelIds = new Set([oldState.channelId, newState.channelId].filter(Boolean));
  if (!affectedChannelIds.has(botVoiceChannel.id)) return;

  scheduleEmptyVoiceDisconnect(guild);
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
