import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} from "discord.js";
import { YtDlpPlugin } from "@distube/yt-dlp";
import { listPlaylists, getPlaylist, savePlaylist, appendToPlaylist } from "./db.js";

const ytSearcher = new YtDlpPlugin({ update: false });

function createProgressBar(currentSec, totalSec, size = 14) {
  if (!totalSec || isNaN(totalSec) || totalSec <= 0) return "━".repeat(size);
  const progress = Math.min(Math.max(currentSec / totalSec, 0), 1);
  const index = Math.min(Math.floor(progress * size), size - 1);
  const bar = Array.from({ length: size }, (_, i) => (i === index ? "🔘" : "━")).join("");
  return bar;
}

export class MusicPanelManager {
  constructor(client, channelId) {
    this.client = client;
    this.channelId = channelId;
    this.panelMessageId = null;
    this.isUpdating = false;
    this.updateTimeout = null;
    this.searchCache = new Map();
  }

  async init() {
    await this.refreshPanel();
  }

  getChannel() {
    return this.client.channels.cache.get(this.channelId) || null;
  }

  async fetchChannel() {
    try {
      return await this.client.channels.fetch(this.channelId);
    } catch {
      return null;
    }
  }

  buildPanelPayload(guild) {
    const queue = guild ? this.client.distube.getQueue(guild.id) : null;
    const isPlaying = Boolean(queue && queue.songs && queue.songs.length > 0);
    const currentSong = isPlaying ? queue.songs[0] : null;

    const repeatLabels = { 0: "OFF", 1: "SINGLE", 2: "ALL" };
    const repeatStr = queue ? repeatLabels[queue.repeatMode] || "OFF" : "OFF";
    const volume = queue ? queue.volume : 100;
    const isPaused = queue ? queue.paused : false;
    const isAutoplay = queue ? queue.autoplay : false;

    const embed = new EmbedBuilder();

    if (isPlaying && currentSong) {
      const remainingSongs = queue.songs.slice(1);
      const remainingCount = remainingSongs.length;
      const remainingDuration = remainingCount > 0 ? queue.formattedDuration : "0:00";

      const currSec = queue.currentTime || 0;
      const totalSec = currentSong.duration || 0;
      const bar = createProgressBar(currSec, totalSec, 14);

      let queuePreview = "";
      if (remainingCount > 0) {
        const previewList = remainingSongs
          .slice(0, 4)
          .map((s, idx) => `\`${idx + 1}.\` ◈ **${s.name.slice(0, 40)}** \`[${s.formattedDuration}]\``)
          .join("\n");
        const extra = remainingCount > 4 ? `\n*...dan ${remainingCount - 4} lagu berikutnya*` : "";
        queuePreview = `\n\n╭─── 📋 **DAFTAR ANTRIAN** ─────────\n${previewList}${extra}\n╰────────────────────────────`;
      }

      embed
        .setColor(isPaused ? 0xf59e0b : 0x5865f2)
        .setAuthor({
          name: "✦ MATRYOSHKA AUDIO STATION ✦",
          iconURL: this.client.user.displayAvatarURL(),
        })
        .setDescription(
          `╭─ 🎚️ **STATUS SISTEM** ──────────────\n` +
          `│ 🔊 Volume: \`${volume}%\` ｜ 🔄 Mode: \`${repeatStr}\`\n` +
          `│ 🎲 Shuffle: \`${queue.songs.length > 2 ? "ON" : "OFF"}\` ｜ 📡 Radio: \`${isAutoplay ? "ON" : "OFF"}\`\n` +
          `╰────────────────────────────\n\n` +
          `🎧 **SEDANG MEMUTAR:**\n` +
          `▸ [**${currentSong.name}**](${currentSong.url})\n\n` +
          `\`${queue.formattedCurrentTime}\` ${bar} \`${currentSong.formattedDuration}\`\n` +
          `*Diminta oleh:* ${currentSong.user || "Anonim"}` +
          queuePreview
        )
        .setFooter({
          text: `✦ Antrian: ${remainingCount} trek | Total Durasi: ${remainingDuration} ✦`,
          iconURL: this.client.user.displayAvatarURL(),
        });
    } else {
      embed
        .setColor(0x2b2d31)
        .setAuthor({
          name: "✦ MATRYOSHKA AUDIO STATION ✦",
          iconURL: this.client.user.displayAvatarURL(),
        })
        .setDescription(
          `╭─ 🎚️ **KONTROL AUDIO** ──────────────\n` +
          `│ 🔊 Volume: \`${volume}%\` ｜ 🔄 Repeat: \`${repeatStr}\`\n` +
          `│ 🎲 Shuffle: \`OFF\` ｜ 📡 Radio: \`${isAutoplay ? "ON" : "OFF"}\`\n` +
          `╰────────────────────────────\n\n` +
          `✨ **Status:** *Standby / Tidak ada lagu yang aktif.*\n` +
          `Ketik nama lagu / paste URL di chat ini, atau gunakan tombol di bawah!`
        )
        .setFooter({
          text: "✦ Siap memutar musik kapan saja ✦",
          iconURL: this.client.user.displayAvatarURL(),
        });
    }

    // Row 1: Playback controls
    const btnPlayPause = new ButtonBuilder()
      .setCustomId("panel_play_pause")
      .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Primary)
      .setEmoji(isPaused ? "▶️" : "⏸️")
      .setLabel(isPaused ? "Resume" : "Pause")
      .setDisabled(!isPlaying);

    const btnSkip = new ButtonBuilder()
      .setCustomId("panel_skip")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("⏭️")
      .setLabel("Skip")
      .setDisabled(!isPlaying);

    const btnStop = new ButtonBuilder()
      .setCustomId("panel_stop")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("⏹️")
      .setLabel("Stop")
      .setDisabled(!isPlaying);

    const btnVolDown = new ButtonBuilder()
      .setCustomId("panel_vol_down")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🔉")
      .setLabel("-10%")
      .setDisabled(!isPlaying);

    const btnVolUp = new ButtonBuilder()
      .setCustomId("panel_vol_up")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🔊")
      .setLabel("+10%")
      .setDisabled(!isPlaying);

    const row1 = new ActionRowBuilder().addComponents(btnPlayPause, btnSkip, btnStop, btnVolDown, btnVolUp);

    // Row 2: Search, Radio & Playlists
    const btnRepeat = new ButtonBuilder()
      .setCustomId("panel_repeat")
      .setStyle(repeatStr !== "OFF" ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setEmoji("🔄")
      .setLabel(`Loop: ${repeatStr}`);

    const btnShuffle = new ButtonBuilder()
      .setCustomId("panel_shuffle")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🎲")
      .setLabel("Shuffle")
      .setDisabled(!isPlaying || (queue?.songs?.length || 0) < 3);

    const btnAutoplay = new ButtonBuilder()
      .setCustomId("panel_autoplay")
      .setStyle(isAutoplay ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setEmoji("📡")
      .setLabel(isAutoplay ? "Radio: ON" : "Radio: OFF")
      .setDisabled(!isPlaying);

    const btnSearch = new ButtonBuilder()
      .setCustomId("panel_search_modal")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("🔎")
      .setLabel("Cari Musik");

    const btnPlaylist = new ButtonBuilder()
      .setCustomId("panel_my_playlists")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🗂️")
      .setLabel("Koleksi Playlist");

    const row2 = new ActionRowBuilder().addComponents(btnRepeat, btnShuffle, btnAutoplay, btnSearch, btnPlaylist);

    // Row 3: Playlist Actions (Create Playlist & Assign Song to Playlist)
    const btnCreatePlaylist = new ButtonBuilder()
      .setCustomId("panel_create_playlist_modal")
      .setStyle(ButtonStyle.Success)
      .setEmoji("➕")
      .setLabel("Buat Playlist");

    const btnAssignPlaylist = new ButtonBuilder()
      .setCustomId("panel_assign_playlist_btn")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("📌")
      .setLabel("Assign Lagu ke Playlist")
      .setDisabled(!isPlaying);

    const row3 = new ActionRowBuilder().addComponents(btnCreatePlaylist, btnAssignPlaylist);

    return { embeds: [embed], components: [row1, row2, row3] };
  }

  scheduleRefresh(guild, delay = 500) {
    if (this.updateTimeout) clearTimeout(this.updateTimeout);
    this.updateTimeout = setTimeout(() => {
      this.refreshPanel(guild).catch((e) => console.error("Error refreshPanel:", e));
    }, delay);
  }

  async refreshPanel(guild = null) {
    if (this.isUpdating) return;
    this.isUpdating = true;
    try {
      const channel = (await this.fetchChannel()) || this.getChannel();
      if (!channel) return;

      const targetGuild = guild || channel.guild;
      const payload = this.buildPanelPayload(targetGuild);

      // Check if existing panel message is found
      if (this.panelMessageId) {
        try {
          const msg = await channel.messages.fetch(this.panelMessageId);
          if (msg) {
            await msg.edit(payload);
            return;
          }
        } catch {
          this.panelMessageId = null;
        }
      }

      // Look back for last bot messages
      const recent = await channel.messages.fetch({ limit: 15 });
      const existingPanel = recent.find(
        (m) =>
          m.author.id === this.client.user.id &&
          m.embeds.length > 0 &&
          m.embeds[0].author?.name?.includes("MATRYOSHKA AUDIO STATION")
      );

      if (existingPanel) {
        this.panelMessageId = existingPanel.id;
        await existingPanel.edit(payload);
      } else {
        const sent = await channel.send(payload);
        this.panelMessageId = sent.id;
      }
    } catch (err) {
      console.error("Gagal update music panel:", err);
    } finally {
      this.isUpdating = false;
    }
  }

  async handleInteraction(interaction) {
    if (interaction.isButton()) {
      await this.handleButton(interaction);
    } else if (interaction.isModalSubmit()) {
      await this.handleModalSubmit(interaction);
    } else if (interaction.isStringSelectMenu()) {
      await this.handleSelectMenu(interaction);
    }
  }

  async handleButton(interaction) {
    const { customId, member, guild } = interaction;
    if (!customId.startsWith("panel_")) return;

    const voiceChannel = member?.voice?.channel;
    const queue = this.client.distube.getQueue(guild.id);

    // Modal search button
    if (customId === "panel_search_modal") {
      const modal = new ModalBuilder()
        .setCustomId("modal_search_song")
        .setTitle("🔎 Telusuri Musik YouTube");

      const input = new TextInputBuilder()
        .setCustomId("search_query")
        .setLabel("Judul lagu atau kata kunci")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(150);

      const row = new ActionRowBuilder().addComponents(input);
      modal.addComponents(row);
      return interaction.showModal(modal).catch(() => {});
    }

    // Modal Create Playlist
    if (customId === "panel_create_playlist_modal") {
      const modal = new ModalBuilder()
        .setCustomId("modal_create_playlist")
        .setTitle("➕ Buat Playlist Baru");

      const nameInput = new TextInputBuilder()
        .setCustomId("playlist_name")
        .setLabel("Nama Playlist")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(40);

      const songsInput = new TextInputBuilder()
        .setCustomId("playlist_songs")
        .setLabel("Link / Judul Lagu (Pisahkan baris baru)")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(1000);

      modal.addComponents(
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(songsInput)
      );
      return interaction.showModal(modal).catch(() => {});
    }

    // Assign Currently Playing / Current Queue to Playlist
    if (customId === "panel_assign_playlist_btn") {
      if (!queue || !queue.songs || queue.songs.length === 0) {
        return interaction.reply({
          content: "❌ Tidak ada lagu yang sedang diputar!",
          flags: [MessageFlags.Ephemeral],
        }).catch(() => {});
      }

      const playlists = listPlaylists(member.id);
      if (!playlists || playlists.length === 0) {
        return interaction.reply({
          content: "❌ Kamu belum memiliki playlist. Buat playlist terlebih dahulu via tombol `➕ Buat Playlist`!",
          flags: [MessageFlags.Ephemeral],
        }).catch(() => {});
      }

      const options = playlists.slice(0, 25).map((p) => {
        let count = 0;
        try { count = JSON.parse(p.songs).length; } catch {}
        return new StringSelectMenuOptionBuilder()
          .setLabel(p.name.slice(0, 50))
          .setDescription(`Total sekarang: ${count} lagu`)
          .setValue(`assign_to_${p.name}`)
          .setEmoji("📥");
      });

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("panel_assign_select")
        .setPlaceholder("Pilih playlist target...")
        .addOptions(options);

      const row = new ActionRowBuilder().addComponents(selectMenu);

      const currSong = queue.songs[0];
      return interaction.reply({
        content: `📌 **Assign Lagu ke Playlist**\nTrek aktif: **${currSong.name}**\nPilih playlist tujuan di bawah:`,
        components: [row],
        flags: [MessageFlags.Ephemeral],
      }).catch(() => {});
    }

    if (customId === "panel_my_playlists") {
      const playlists = listPlaylists(member.id);
      if (!playlists || playlists.length === 0) {
        return interaction.reply({
          content: "❌ Kamu belum memiliki playlist tersimpan! Buat menggunakan tombol `➕ Buat Playlist`.",
          flags: [MessageFlags.Ephemeral],
        }).catch(() => {});
      }

      const options = playlists.slice(0, 25).map((p) => {
        let count = 0;
        try {
          count = JSON.parse(p.songs).length;
        } catch {}
        return new StringSelectMenuOptionBuilder()
          .setLabel(p.name.slice(0, 50))
          .setDescription(`${count} lagu tersimpan`)
          .setValue(`playlist_${p.name}`)
          .setEmoji("🗂️");
      });

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("panel_playlist_select")
        .setPlaceholder("Pilih playlist untuk diputar...")
        .addOptions(options);

      const row = new ActionRowBuilder().addComponents(selectMenu);

      return interaction.reply({
        content: "🗂️ **Koleksi Playlist Kamu:**",
        components: [row],
        flags: [MessageFlags.Ephemeral],
      }).catch(() => {});
    }

    // Controls that require user to be in voice channel
    if (!voiceChannel) {
      return interaction.reply({
        content: "❌ Kamu harus bergabung di voice channel terlebih dahulu!",
        flags: [MessageFlags.Ephemeral],
      }).catch(() => {});
    }

    switch (customId) {
      case "panel_play_pause": {
        if (!queue) return interaction.reply({ content: "❌ Tidak ada musik!", flags: [MessageFlags.Ephemeral] }).catch(() => {});
        if (queue.paused) {
          this.client.distube.resume(guild.id);
          await interaction.reply({ content: "▶️ Pemutaran dilanjutkan.", flags: [MessageFlags.Ephemeral] }).catch(() => {});
        } else {
          this.client.distube.pause(guild.id);
          await interaction.reply({ content: "⏸️ Pemutaran dijeda.", flags: [MessageFlags.Ephemeral] }).catch(() => {});
        }
        this.scheduleRefresh(guild);
        break;
      }

      case "panel_skip": {
        if (!queue) return interaction.reply({ content: "❌ Tidak ada lagu di antrean!", flags: [MessageFlags.Ephemeral] }).catch(() => {});
        try {
          await this.client.distube.skip(guild.id);
          await interaction.reply({ content: "⏭️ Melewati ke lagu berikutnya.", flags: [MessageFlags.Ephemeral] }).catch(() => {});
        } catch (e) {
          await interaction.reply({ content: "⏹️ Antrean lagu telah selesai.", flags: [MessageFlags.Ephemeral] }).catch(() => {});
        }
        this.scheduleRefresh(guild);
        break;
      }

      case "panel_stop": {
        if (!queue) return interaction.reply({ content: "❌ Tidak ada musik yang berjalan!", flags: [MessageFlags.Ephemeral] }).catch(() => {});
        await this.client.distube.stop(guild.id);
        await interaction.reply({ content: "🛑 Musik dihentikan.", flags: [MessageFlags.Ephemeral] }).catch(() => {});
        this.scheduleRefresh(guild);
        break;
      }

      case "panel_vol_down": {
        if (!queue) return interaction.reply({ content: "❌ Tidak ada musik yang berjalan!", flags: [MessageFlags.Ephemeral] }).catch(() => {});
        const newVol = Math.max(0, queue.volume - 10);
        this.client.distube.setVolume(guild.id, newVol);
        await interaction.reply({ content: `🔉 Volume disetel ke **${newVol}%**`, flags: [MessageFlags.Ephemeral] }).catch(() => {});
        this.scheduleRefresh(guild);
        break;
      }

      case "panel_vol_up": {
        if (!queue) return interaction.reply({ content: "❌ Tidak ada musik yang berjalan!", flags: [MessageFlags.Ephemeral] }).catch(() => {});
        const newVol = Math.min(100, queue.volume + 10);
        this.client.distube.setVolume(guild.id, newVol);
        await interaction.reply({ content: `🔊 Volume disetel ke **${newVol}%**`, flags: [MessageFlags.Ephemeral] }).catch(() => {});
        this.scheduleRefresh(guild);
        break;
      }

      case "panel_repeat": {
        if (!queue) return interaction.reply({ content: "❌ Tidak ada musik yang berjalan!", flags: [MessageFlags.Ephemeral] }).catch(() => {});
        const nextMode = (queue.repeatMode + 1) % 3;
        this.client.distube.setRepeatMode(guild.id, nextMode);
        const modeNames = { 0: "Mati (OFF)", 1: "Ulangi Trek Ini (SINGLE)", 2: "Ulangi Semua Antrian (ALL)" };
        await interaction.reply({ content: `🔄 Mode perulangan: **${modeNames[nextMode]}**`, flags: [MessageFlags.Ephemeral] }).catch(() => {});
        this.scheduleRefresh(guild);
        break;
      }

      case "panel_shuffle": {
        if (!queue || queue.songs.length < 3) {
          return interaction.reply({ content: "❌ Perlu minimal 3 lagu di antrean untuk mengacak urutan!", flags: [MessageFlags.Ephemeral] }).catch(() => {});
        }
        this.client.distube.shuffle(guild.id);
        await interaction.reply({ content: "🎲 Urutan antrean berhasil diacak!", flags: [MessageFlags.Ephemeral] }).catch(() => {});
        this.scheduleRefresh(guild);
        break;
      }

      case "panel_autoplay": {
        if (!queue) return interaction.reply({ content: "❌ Tidak ada musik yang berjalan!", flags: [MessageFlags.Ephemeral] }).catch(() => {});
        const auto = this.client.distube.toggleAutoplay(guild.id);
        await interaction.reply({ content: `📡 Radio Autoplay: **${auto ? "ON" : "OFF"}**`, flags: [MessageFlags.Ephemeral] }).catch(() => {});
        this.scheduleRefresh(guild);
        break;
      }
    }
  }

  async handleModalSubmit(interaction) {
    if (interaction.customId === "modal_search_song") {
      const query = interaction.fields.getTextInputValue("search_query").trim();
      if (!query) {
        return interaction.reply({ content: "❌ Kata kunci pencarian tidak boleh kosong!", flags: [MessageFlags.Ephemeral] }).catch(() => {});
      }

      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] }).catch(() => {});

      // Direct link check
      if (query.startsWith("http://") || query.startsWith("https://")) {
        const voiceChannel = interaction.member?.voice?.channel;
        if (!voiceChannel) {
          return interaction.editReply("❌ Kamu harus berada di voice channel untuk memutar lagu!").catch(() => {});
        }

        try {
          await this.client.distube.play(voiceChannel, query, {
            member: interaction.member,
            textChannel: interaction.channel,
          });
          await interaction.editReply(`⚡ Berhasil memuat tautan: **${query}**`).catch(() => {});
          this.scheduleRefresh(interaction.guild);
        } catch (err) {
          await interaction.editReply(`❌ Gagal memutar link: ${err.message}`).catch(() => {});
        }
        return;
      }

      // Search query via yt-dlp
      try {
        const results = await ytSearcher.resolve(`ytsearch5:${query}`, {});
        const songs = results?.songs || [];

        if (!songs.length) {
          return interaction.editReply(`❌ Tidak ditemukan hasil untuk: \`${query}\``).catch(() => {});
        }

        const searchKey = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        this.searchCache.set(searchKey, songs);
        setTimeout(() => this.searchCache.delete(searchKey), 300000).unref?.();

        const options = songs.slice(0, 5).map((song, i) => {
          const title = (song.name || "Unknown").slice(0, 90);
          const desc = `⏱️ ${song.formattedDuration || "0:00"} ◈ ${song.uploader?.name || "YouTube"}`.slice(0, 95);
          return new StringSelectMenuOptionBuilder()
            .setLabel(`${i + 1}. ${title}`)
            .setDescription(desc)
            .setValue(`${searchKey}__${i}`)
            .setEmoji("🎵");
        });

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId("panel_search_select")
          .setPlaceholder("Pilih lagu untuk dimainkan...")
          .addOptions(options);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.editReply({
          content: `🔎 **Hasil Pencarian:** \`${query}\`\nPilih salah satu trek di bawah:`,
          components: [row],
        }).catch(() => {});
      } catch (err) {
        console.error("Search error:", err);
        await interaction.editReply(`❌ Gagal melakukan pencarian: ${err.message}`).catch(() => {});
      }
    } else if (interaction.customId === "modal_create_playlist") {
      const name = interaction.fields.getTextInputValue("playlist_name").trim();
      const songsRaw = interaction.fields.getTextInputValue("playlist_songs")?.trim() || "";

      if (!name) {
        return interaction.reply({ content: "❌ Nama playlist tidak boleh kosong!", flags: [MessageFlags.Ephemeral] }).catch(() => {});
      }

      const lines = songsRaw.split("\n").map(l => l.trim()).filter(Boolean);
      const queue = this.client.distube.getQueue(interaction.guild.id);

      let initialSongs = [];
      if (lines.length > 0) {
        for (const line of lines) {
          initialSongs.push({ name: line, url: line });
        }
      } else if (queue && queue.songs && queue.songs.length > 0) {
        // If empty input, save current queue as default
        initialSongs = queue.songs.map(s => ({ name: s.name, url: s.url, formattedDuration: s.formattedDuration }));
      }

      savePlaylist(interaction.member.id, name, initialSongs);

      const countMsg = initialSongs.length > 0 ? `dengan **${initialSongs.length} lagu**.` : " (kosong). Gunakan tombol **Assign Lagu** untuk mengisi.";
      return interaction.reply({
        content: `✅ Playlist **${name}** berhasil dibuat ${countMsg}`,
        flags: [MessageFlags.Ephemeral],
      }).catch(() => {});
    }
  }

  async handleSelectMenu(interaction) {
    const { customId, values, member, guild } = interaction;
    const voiceChannel = member?.voice?.channel;

    if (customId === "panel_search_select") {
      if (!voiceChannel) {
        return interaction.reply({
          content: "❌ Kamu harus berada di voice channel untuk memutar lagu!",
          flags: [MessageFlags.Ephemeral],
        }).catch(() => {});
      }

      const selectedValue = values[0];
      const [searchKey, indexStr] = selectedValue.split("__");
      const index = parseInt(indexStr, 10);
      const songs = this.searchCache.get(searchKey);

      if (!songs || !songs[index]) {
        return interaction.reply({
          content: "❌ Sesi pencarian telah kedaluwarsa atau tidak valid. Silakan lakukan pencarian ulang.",
          flags: [MessageFlags.Ephemeral],
        }).catch(() => {});
      }

      const song = songs[index];
      await interaction.reply({
        content: `🎵 **Memutar Trek:** ${song.name} (\`${song.formattedDuration}\`)`,
        flags: [MessageFlags.Ephemeral],
      }).catch(async () => {
        await interaction.followUp({
          content: `🎵 **Memutar Trek:** ${song.name} (\`${song.formattedDuration}\`)`,
          flags: [MessageFlags.Ephemeral],
        }).catch(() => {});
      });

      try {
        await this.client.distube.play(voiceChannel, song.url, {
          member: interaction.member,
          textChannel: interaction.channel,
        });

        this.scheduleRefresh(guild);
      } catch (err) {
        console.error("Gagal play song:", err);
        await interaction.followUp({
          content: `❌ Gagal memutar lagu: ${err.message}`,
          flags: [MessageFlags.Ephemeral],
        }).catch(() => {});
      }
    } else if (customId === "panel_playlist_select") {
      if (!voiceChannel) {
        return interaction.reply({
          content: "❌ Kamu harus berada di voice channel untuk memutar playlist!",
          flags: [MessageFlags.Ephemeral],
        }).catch(() => {});
      }

      const playlistName = values[0].replace("playlist_", "");
      const songs = getPlaylist(member.id, playlistName);

      if (!songs || !songs.length) {
        return interaction.reply({
          content: `❌ Playlist **${playlistName}** tidak memiliki lagu atau tidak ditemukan.`,
          flags: [MessageFlags.Ephemeral],
        }).catch(() => {});
      }

      const songListPreview = songs
        .slice(0, 10)
        .map((s, i) => `\`${i + 1}.\` ◈ **${s.name.slice(0, 45)}**`)
        .join("\n");
      const extra = songs.length > 10 ? `\n*...dan ${songs.length - 10} lagu lainnya*` : "";

      await interaction.reply({
        content: `🗂️ **Memuat Playlist: \`${playlistName}\` (${songs.length} Lagu)**\n\n${songListPreview}${extra}`,
        flags: [MessageFlags.Ephemeral],
      }).catch(() => {});

      try {
        for (const s of songs) {
          await this.client.distube.play(voiceChannel, s.url, {
            member: interaction.member,
            textChannel: interaction.channel,
          });
        }

        this.scheduleRefresh(guild);
      } catch (err) {
        console.error("Gagal play playlist:", err);
        await interaction.followUp({
          content: `❌ Gagal memutar playlist: ${err.message}`,
          flags: [MessageFlags.Ephemeral],
        }).catch(() => {});
      }
    } else if (customId === "panel_assign_select") {
      const queue = this.client.distube.getQueue(guild.id);
      if (!queue || !queue.songs || queue.songs.length === 0) {
        return interaction.reply({
          content: "❌ Tidak ada lagu yang aktif untuk dimasukkan ke playlist!",
          flags: [MessageFlags.Ephemeral],
        }).catch(() => {});
      }

      const targetPlaylist = values[0].replace("assign_to_", "");
      const currSong = queue.songs[0];
      const newTotal = appendToPlaylist(member.id, targetPlaylist, currSong);

      return interaction.reply({
        content: `✅ Lagu **${currSong.name}** berhasil dimasukkan ke playlist **${targetPlaylist}**! (Total sekarang: ${newTotal} lagu)`,
        flags: [MessageFlags.Ephemeral],
      }).catch(() => {});
    }
  }

  async handleDirectMessage(message) {
    if (message.channel.id !== this.channelId || message.author.bot) return;

    // Delete user's text message quickly to keep the music channel tidy
    setTimeout(() => {
      message.delete().catch(() => {});
    }, 1200).unref?.();

    if (message.content.startsWith(this.client.config?.prefix || "!")) {
      return;
    }

    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      const alert = await message.channel.send(`⚠️ <@${message.author.id}>, kamu harus bergabung di voice channel terlebih dahulu!`);
      setTimeout(() => alert.delete().catch(() => {}), 4000).unref?.();
      return;
    }

    const query = message.content.trim();
    if (!query) return;

    try {
      const isDirectUrl = query.startsWith("http://") || query.startsWith("https://");

      if (!isDirectUrl) {
        const results = await ytSearcher.resolve(`ytsearch5:${query}`, {});
        const songs = results?.songs || [];

        if (!songs.length) {
          const alert = await message.channel.send(`❌ Tidak ditemukan lagu: \`${query}\``);
          setTimeout(() => alert.delete().catch(() => {}), 4000).unref?.();
          return;
        }

        if (songs.length === 1) {
          await this.client.distube.play(voiceChannel, songs[0].url, {
            member: message.member,
            textChannel: message.channel,
          });
          this.scheduleRefresh(message.guild);
          return;
        }

        const searchKey = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        this.searchCache.set(searchKey, songs);
        setTimeout(() => this.searchCache.delete(searchKey), 300000).unref?.();

        const options = songs.slice(0, 5).map((song, i) => {
          const title = (song.name || "Unknown").slice(0, 90);
          const desc = `⏱️ ${song.formattedDuration || "0:00"} ◈ ${song.uploader?.name || "YouTube"}`.slice(0, 95);
          return new StringSelectMenuOptionBuilder()
            .setLabel(`${i + 1}. ${title}`)
            .setDescription(desc)
            .setValue(`${searchKey}__${i}`)
            .setEmoji("🎵");
        });

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId("panel_search_select")
          .setPlaceholder("Pilih lagu untuk dimainkan...")
          .addOptions(options);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const replyMsg = await message.channel.send({
          content: `🔎 **Hasil Pencarian untuk:** \`${query}\` (oleh <@${message.author.id}>)`,
          components: [row],
        });

        setTimeout(() => replyMsg.delete().catch(() => {}), 30000).unref?.();
        return;
      }

      await this.client.distube.play(voiceChannel, query, {
        member: message.member,
        textChannel: message.channel,
      });

      this.scheduleRefresh(message.guild);
    } catch (err) {
      console.error("Error direct play:", err);
      const alert = await message.channel.send(`❌ Gagal memutar lagu: ${err.message}`);
      setTimeout(() => alert.delete().catch(() => {}), 4000).unref?.();
    }
  }
}
