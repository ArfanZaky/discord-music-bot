/**
 * Handler command musik untuk Discord bot
 * Mendukung: play, skip, stop, queue, pause, resume, volume, np, help, loop, shuffle
 */

const MUSIC_CHANNEL_ID = "1485833926302892136";

async function sendTidyReply(message, content) {
  const replyMsg = await message.reply(content);
  if (message.channel.id === MUSIC_CHANNEL_ID) {
    setTimeout(() => {
      replyMsg.delete().catch(() => {});
    }, 5000).unref?.();
  }
  return replyMsg;
}

function normalizePlayQuery(query) {
  const trimmed = query.trim().replace(/[,.\s]+$/g, "");

  try {
    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./, "");
    const isYoutubeWatch = ["youtube.com", "m.youtube.com", "music.youtube.com"].includes(host) && url.pathname === "/watch";

    if (isYoutubeWatch && url.searchParams.has("v")) {
      return `https://www.youtube.com/watch?v=${url.searchParams.get("v")}`;
    }
  } catch {
    // Not a URL
  }

  return trimmed;
}

async function playWithQueueRecovery(distube, voiceChannel, query, options) {
  const guildId = voiceChannel.guild.id;
  const clearStoppedQueue = () => {
    const queue = distube.getQueue(guildId);
    if (queue?.stopped) {
      distube.queues.remove(guildId);
    }
  };

  clearStoppedQueue();
  try {
    await distube.play(voiceChannel, query, options);
  } catch (error) {
    if (error?.errorCode !== "QUEUE_STOPPED") {
      throw error;
    }
    distube.queues.remove(guildId);
    await distube.play(voiceChannel, query, options);
  }
}

export async function handleMusicCommands(message, args, command) {
  const { distube } = message.client;
  const voiceChannel = message.member?.voice?.channel;
  const prefix = message.client.config?.prefix || "!";

  const musicCommands = [
    "play", "p", "skip", "stop", "queue", "pause", "resume",
    "volume", "np", "help", "loop", "shuffle", "ping",
    "saveplaylist", "loadplaylist", "myplaylists", "deleteplaylist"
  ];

  if (!musicCommands.includes(command)) return;

  // Commands yang tidak butuh voice channel
  if (command === "help") {
    const helpText = [
      "**🎵 Daftar Command**",
      "",
      `\`${prefix}play <url/query>\` atau \`${prefix}p\` — Putar lagu dari YouTube/Spotify`,
      `\`${prefix}skip\` — Lewati ke lagu berikutnya`,
      `\`${prefix}stop\` — Hentikan musik & kosongkan antrean`,
      `\`${prefix}queue\` — Lihat antrean lagu`,
      `\`${prefix}pause\` — Jeda musik`,
      `\`${prefix}resume\` — Lanjutkan musik`,
      `\`${prefix}volume <0-100>\` — Atur volume`,
      `\`${prefix}np\` — Lagu yang sedang diputar`,
      `\`${prefix}loop <off/song/queue>\` — Ulangi: mati/lagu/antrean`,
      `\`${prefix}shuffle\` — Acak antrean`,
      `\`${prefix}ping\` — Cek latency bot`,
      "",
      "**📁 Playlist Favorit**",
      `\`${prefix}saveplaylist <nama>\` — Simpan antrean ke playlist`,
      `\`${prefix}loadplaylist <nama>\` — Putar playlist tersimpan`,
      `\`${prefix}myplaylists\` — Daftar playlist kamu`,
      `\`${prefix}deleteplaylist <nama>\` — Hapus playlist`,
      `\`${prefix}help\` — Tampilkan bantuan ini`,
    ].join("\n");
    return sendTidyReply(message, helpText);
  }

  if (command === "ping") {
    const sent = await message.reply("🏓 Pinging...");
    const latency = sent.createdTimestamp - message.createdTimestamp;
    const wsLatency = Math.round(message.client.ws.ping);
    await sent.edit(`🏓 **Pong!**\n📨 ${latency}ms | 💓 ${wsLatency}ms`);
    if (message.channel.id === MUSIC_CHANNEL_ID) {
      setTimeout(() => sent.delete().catch(() => {}), 5000).unref?.();
    }
    return;
  }

  if (!["play", "p", "saveplaylist", "myplaylists"].includes(command) && !voiceChannel) {
    return sendTidyReply(message, "❌ Kamu harus berada di voice channel!");
  }

  switch (command) {
    case "p":
    case "play": {
      if (!voiceChannel) {
        return sendTidyReply(message, "❌ Kamu harus berada di voice channel untuk memutar musik!");
      }
      let query = normalizePlayQuery(args.join(" "));
      if (!query) {
        return sendTidyReply(message, "❌ Gunakan: `!play <url atau nama lagu>`");
      }
      await playWithQueueRecovery(distube, voiceChannel, query, {
        member: message.member,
        textChannel: message.channel,
      });
      break;
    }

    case "skip": {
      const queue = distube.getQueue(message);
      if (!queue) return sendTidyReply(message, "❌ Tidak ada antrean!");
      await distube.skip(message);
      await sendTidyReply(message, "⏭️ Melewati lagu...");
      break;
    }

    case "stop": {
      const queue = distube.getQueue(message);
      if (!queue) return sendTidyReply(message, "❌ Tidak ada antrean!");
      await distube.stop(message);
      await sendTidyReply(message, "⏹️ Musik dihentikan.");
      break;
    }

    case "queue": {
      const queue = distube.getQueue(message);
      if (!queue) return sendTidyReply(message, "❌ Tidak ada antrean!");
      const q = queue.songs
        .map((s, i) => `${i === 0 ? "▶️" : `${i}.`} ${s.name} - \`${s.formattedDuration}\``)
        .slice(0, 10)
        .join("\n");
      await sendTidyReply(message, `**Antrean:**\n${q}${queue.songs.length > 10 ? `\n...dan ${queue.songs.length - 10} lagu lainnya` : ""}`);
      break;
    }

    case "pause": {
      const queue = distube.getQueue(message);
      if (!queue) return sendTidyReply(message, "❌ Tidak ada antrean!");
      if (queue.paused) return sendTidyReply(message, "❌ Musik sudah di-pause!");
      distube.pause(message);
      await sendTidyReply(message, "⏸️ Dijeda.");
      break;
    }

    case "resume": {
      const queue = distube.getQueue(message);
      if (!queue) return sendTidyReply(message, "❌ Tidak ada antrean!");
      if (!queue.paused) return sendTidyReply(message, "❌ Musik tidak dijeda!");
      distube.resume(message);
      await sendTidyReply(message, "▶️ Dilanjutkan.");
      break;
    }

    case "volume": {
      const queue = distube.getQueue(message);
      if (!queue) return sendTidyReply(message, "❌ Tidak ada antrean!");
      const vol = parseInt(args[0], 10);
      if (isNaN(vol) || vol < 0 || vol > 100) {
        return sendTidyReply(message, `🔊 Volume saat ini: **${queue.volume}%**. Gunakan \`!volume 0-100\` untuk mengubah.`);
      }
      distube.setVolume(message, vol);
      await sendTidyReply(message, `🔊 Volume diatur ke **${vol}%**`);
      break;
    }

    case "np": {
      const queue = distube.getQueue(message);
      if (!queue) return sendTidyReply(message, "❌ Tidak ada lagu yang diputar!");
      const song = queue.songs[0];
      const progress = queue.formattedCurrentTime;
      const total = song.formattedDuration;
      await sendTidyReply(message, `▶️ **Sedang diputar:** ${song.name}\n\`${progress} / ${total}\``);
      break;
    }

    case "loop": {
      const queue = distube.getQueue(message);
      if (!queue) return sendTidyReply(message, "❌ Tidak ada antrean!");
      const mode = args[0]?.toLowerCase();
      const modes = { off: 0, song: 1, queue: 2 };
      const modeNames = { 0: "Mati", 1: "Ulangi lagu", 2: "Ulangi antrean" };
      if (mode && modes[mode] !== undefined) {
        distube.setRepeatMode(message, modes[mode]);
        await sendTidyReply(message, `🔁 Loop: **${modeNames[modes[mode]]}**`);
      } else {
        const current = modeNames[queue.repeatMode];
        await sendTidyReply(message, `🔁 Loop saat ini: **${current}**. Gunakan \`!loop off|song|queue\``);
      }
      break;
    }

    case "shuffle": {
      const queue = distube.getQueue(message);
      if (!queue) return sendTidyReply(message, "❌ Tidak ada antrean!");
      if (queue.songs.length < 3) return sendTidyReply(message, "❌ Perlu minimal 3 lagu di antrean untuk acak!");
      distube.shuffle(message);
      await sendTidyReply(message, "🔀 Antrean diacak!");
      break;
    }

    case "saveplaylist": {
      const queue = distube.getQueue(message);
      const name = args.join(" ").trim();
      if (!name) return sendTidyReply(message, "❌ Gunakan: `!saveplaylist <nama>`");
      if (!queue || queue.songs.length < 2) return sendTidyReply(message, "❌ Perlu minimal 2 lagu di antrean!");
      const { savePlaylist } = await import("../db.js");
      savePlaylist(message.author.id, name, queue.songs);
      await sendTidyReply(message, `✅ Playlist **${name}** disimpan (${queue.songs.length} lagu)`);
      break;
    }

    case "loadplaylist": {
      if (!voiceChannel) return sendTidyReply(message, "❌ Kamu harus di voice channel!");
      const name = args.join(" ").trim();
      if (!name) return sendTidyReply(message, "❌ Gunakan: `!loadplaylist <nama>`");
      const { getPlaylist } = await import("../db.js");
      const songs = getPlaylist(message.author.id, name);
      if (!songs || songs.length === 0) return sendTidyReply(message, "❌ Playlist tidak ditemukan!");
      for (const s of songs) {
        await distube.play(voiceChannel, s.url, { member: message.member, textChannel: message.channel });
      }
      await sendTidyReply(message, `✅ Memutar playlist **${name}** (${songs.length} lagu)`);
      break;
    }

    case "myplaylists": {
      const { listPlaylists } = await import("../db.js");
      const playlists = listPlaylists(message.author.id);
      if (!playlists.length) return sendTidyReply(message, "❌ Kamu belum punya playlist. Gunakan `!saveplaylist <nama>`");
      const list = playlists.map((p) => `• **${p.name}** (${JSON.parse(p.songs).length} lagu)`).join("\n");
      await sendTidyReply(message, `**📁 Playlist kamu:**\n${list}`);
      break;
    }

    case "deleteplaylist": {
      const name = args.join(" ").trim();
      if (!name) return sendTidyReply(message, "❌ Gunakan: `!deleteplaylist <nama>`");
      const { deletePlaylist } = await import("../db.js");
      const deleted = deletePlaylist(message.author.id, name);
      await sendTidyReply(message, deleted ? `✅ Playlist **${name}** dihapus` : "❌ Playlist tidak ditemukan!");
      break;
    }

    default:
      break;
  }
}
