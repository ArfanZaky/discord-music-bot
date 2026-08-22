import Database from "better-sqlite3";
import { join } from "path";
import { mkdirSync, existsSync } from "fs";

const dataDir = join(process.cwd(), "data");
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

const dbPath = join(dataDir, "bot.db");
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    songs TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    UNIQUE(user_id, name)
  )
`);

export function savePlaylist(userId, name, songs) {
  const stmt = db.prepare(
    "INSERT OR REPLACE INTO playlists (user_id, name, songs) VALUES (?, ?, ?)"
  );
  const formatted = songs.map((s) => ({
    url: s.url || s.webpage_url || "",
    name: s.name || s.title || "Unknown Track",
    duration: s.formattedDuration || s.duration || "",
  }));
  stmt.run(userId, name.toLowerCase().trim(), JSON.stringify(formatted));
}

export function appendToPlaylist(userId, name, newSongs) {
  const existing = getPlaylist(userId, name) || [];
  const toAdd = (Array.isArray(newSongs) ? newSongs : [newSongs]).map((s) => ({
    url: s.url || s.webpage_url || "",
    name: s.name || s.title || "Unknown Track",
    duration: s.formattedDuration || s.duration || "",
  }));

  // Avoid exact duplicates if url matches
  const merged = [...existing];
  for (const item of toAdd) {
    if (!item.url) continue;
    const exists = merged.some((m) => m.url === item.url);
    if (!exists) {
      merged.push(item);
    }
  }

  const stmt = db.prepare(
    "INSERT OR REPLACE INTO playlists (user_id, name, songs) VALUES (?, ?, ?)"
  );
  stmt.run(userId, name.toLowerCase().trim(), JSON.stringify(merged));
  return merged.length;
}

export function getPlaylist(userId, name) {
  const stmt = db.prepare("SELECT songs FROM playlists WHERE user_id = ? AND name = ?");
  const row = stmt.get(userId, name.toLowerCase().trim());
  return row ? JSON.parse(row.songs) : null;
}

export function listPlaylists(userId) {
  const stmt = db.prepare(
    "SELECT name, songs FROM playlists WHERE user_id = ? ORDER BY name"
  );
  return stmt.all(userId);
}

export function deletePlaylist(userId, name) {
  const stmt = db.prepare("DELETE FROM playlists WHERE user_id = ? AND name = ?");
  const result = stmt.run(userId, name.toLowerCase().trim());
  return result.changes > 0;
}
