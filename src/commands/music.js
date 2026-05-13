/**
 * Handler command musik untuk Discord bot
 * Mendukung: play, skip, stop, queue, pause, resume, volume, np, help, loop, shuffle
 */

export async function handleMusicCommands(message, args, command) {
  const { distube } = message.client;
  const voiceChannel = message.member?.voice?.channel;
  const prefix = message.client.config?.prefix || "!";

  const musicCommands = ["play", "skip", "stop", "queue", "pause", "resume", "volume", "np", "help", "loop", "shuffle", "ping", "saveplaylist", "loadplaylist", "myplaylists", "deleteplaylist"];

  if (!musicCommands.includes(command)) return;

  // Commands yang tidak butuh voice channel
  if (command === "help") {
    const helpText = [
      "**🎵 Daftar Command**",
      "",
      `\`${prefix}play <url/query>\` — Putar lagu dari YouTube/Spotify`,
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
    return message.reply(helpText);
  }

  if (command === "ping") {
    const sent = await message.reply("🏓 Pinging...");
    const latency = sent.createdTimestamp - message.createdTimestamp;
    const wsLatency = Math.round(message.client.ws.ping);
    return sent.edit(`🏓 **Pong!**\n📨 ${latency}ms | 💓 ${wsLatency}ms`);
  }

  if (!["play", "saveplaylist", "myplaylists"].includes(command) && !voiceChannel) {
    return message.reply("❌ Kamu harus berada di voice channel!");
  }

  switch (command) {
    case "play": {
      if (!voiceChannel) {
        return message.reply("❌ Kamu harus berada di voice channel untuk memutar musik!");
      }
      let query = args.join(" ");
      if (!query) {
        return message.reply("❌ Gunakan: `!play <url atau nama lagu>`");
      }
      // Untuk query teks (bukan URL), gunakan ytsearch1 agar YtDlpPlugin bisa mencari
      const isUrl = /^https?:\/\//i.test(query) || /^(spotify|ytsearch|youtube):/i.test(query);
      if (!isUrl) {
        query = `ytsearch1:${query}`;
      }
      await distube.play(voiceChannel, query, {
        member: message.member,
        textChannel: message.channel,
      });
      break;
    }

    case "skip": {
      const queue = distube.getQueue(message);
      if (!queue) return message.reply("❌ Tidak ada antrean!");
      await distube.skip(message);
      await message.reply("⏭️ Melewati lagu...");
      break;
    }

    case "stop": {
      const queue = distube.getQueue(message);
      if (!queue) return message.reply("❌ Tidak ada antrean!");
      distube.stop(message);
      await message.reply("⏹️ Musik dihentikan.");
      break;
    }

    case "queue": {
      const queue = distube.getQueue(message);
      if (!queue) return message.reply("❌ Tidak ada antrean!");
      const q = queue.songs
        .map((s, i) => `${i === 0 ? "▶️" : `${i}.`} ${s.name} - \`${s.formattedDuration}\``)
        .slice(0, 10)
        .join("\n");
      await message.reply(`**Antrean:**\n${q}${queue.songs.length > 10 ? `\n...dan ${queue.songs.length - 10} lagu lainnya` : ""}`);
      break;
    }

    case "pause": {
      const queue = distube.getQueue(message);
      if (!queue) return message.reply("❌ Tidak ada antrean!");
      if (queue.paused) return message.reply("❌ Musik sudah di-pause!");
      distube.pause(message);
      await message.reply("⏸️ Dijeda.");
      break;
    }

    case "resume": {
      const queue = distube.getQueue(message);
      if (!queue) return message.reply("❌ Tidak ada antrean!");
      if (!queue.paused) return message.reply("❌ Musik tidak dijeda!");
      distube.resume(message);
      await message.reply("▶️ Dilanjutkan.");
      break;
    }

    case "volume": {
      const queue = distube.getQueue(message);
      if (!queue) return message.reply("❌ Tidak ada antrean!");
      const vol = parseInt(args[0], 10);
      if (isNaN(vol) || vol < 0 || vol > 100) {
        return message.reply(`🔊 Volume saat ini: **${queue.volume}%**. Gunakan \`!volume 0-100\` untuk mengubah.`);
      }
      distube.setVolume(message, vol);
      await message.reply(`🔊 Volume diatur ke **${vol}%**`);
      break;
    }

    case "np": {
      const queue = distube.getQueue(message);
      if (!queue) return message.reply("❌ Tidak ada lagu yang diputar!");
      const song = queue.songs[0];
      const progress = queue.formattedCurrentTime;
      const total = song.formattedDuration;
      await message.reply(`▶️ **Sedang diputar:** ${song.name}\n\`${progress} / ${total}\``);
      break;
    }

    case "loop": {
      const queue = distube.getQueue(message);
      if (!queue) return message.reply("❌ Tidak ada antrean!");
      const mode = args[0]?.toLowerCase();
      const modes = { off: 0, song: 1, queue: 2 };
      const modeNames = { 0: "Mati", 1: "Ulangi lagu", 2: "Ulangi antrean" };
      if (mode && modes[mode] !== undefined) {
        distube.setRepeatMode(message, modes[mode]);
        await message.reply(`🔁 Loop: **${modeNames[modes[mode]]}**`);
      } else {
        const current = modeNames[queue.repeatMode];
        await message.reply(`🔁 Loop saat ini: **${current}**. Gunakan \`!loop off|song|queue\``);
      }
      break;
    }

    case "shuffle": {
      const queue = distube.getQueue(message);
      if (!queue) return message.reply("❌ Tidak ada antrean!");
      if (queue.songs.length < 3) return message.reply("❌ Perlu minimal 3 lagu di antrean untuk acak!");
      distube.shuffle(message);
      await message.reply("🔀 Antrean diacak!");
      break;
    }

    case "saveplaylist": {
      const queue = distube.getQueue(message);
      const name = args.join(" ").trim();
      if (!name) return message.reply("❌ Gunakan: `!saveplaylist <nama>`");
      if (!queue || queue.songs.length < 2) return message.reply("❌ Perlu minimal 2 lagu di antrean!");
      const { savePlaylist } = await import("../db.js");
      savePlaylist(message.author.id, name, queue.songs);
      await message.reply(`✅ Playlist **${name}** disimpan (${queue.songs.length} lagu)`);
      break;
    }

    case "loadplaylist": {
      if (!voiceChannel) return message.reply("❌ Kamu harus di voice channel!");
      const name = args.join(" ").trim();
      if (!name) return message.reply("❌ Gunakan: `!loadplaylist <nama>`");
      const { getPlaylist } = await import("../db.js");
      const songs = getPlaylist(message.author.id, name);
      if (!songs || songs.length === 0) return message.reply("❌ Playlist tidak ditemukan!");
      for (const s of songs) {
        await distube.play(voiceChannel, s.url, { member: message.member, textChannel: message.channel });
      }
      await message.reply(`✅ Memutar playlist **${name}** (${songs.length} lagu)`);
      break;
    }

    case "myplaylists": {
      const { listPlaylists } = await import("../db.js");
      const playlists = listPlaylists(message.author.id);
      if (!playlists.length) return message.reply("❌ Kamu belum punya playlist. Gunakan `!saveplaylist <nama>`");
      const list = playlists.map((p) => `• **${p.name}** (${JSON.parse(p.songs).length} lagu)`).join("\n");
      await message.reply(`**📁 Playlist kamu:**\n${list}`);
      break;
    }

    case "deleteplaylist": {
      const name = args.join(" ").trim();
      if (!name) return message.reply("❌ Gunakan: `!deleteplaylist <nama>`");
      const { deletePlaylist } = await import("../db.js");
      const deleted = deletePlaylist(message.author.id, name);
      await message.reply(deleted ? `✅ Playlist **${name}** dihapus` : "❌ Playlist tidak ditemukan!");
      break;
    }

    default:
      break;
  }
}
