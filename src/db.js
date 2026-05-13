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
  const songsJson = JSON.stringify(songs.map((s) => ({ url: s.url, name: s.name })));
  stmt.run(userId, name.toLowerCase(), songsJson);
}

export function getPlaylist(userId, name) {
  const stmt = db.prepare("SELECT songs FROM playlists WHERE user_id = ? AND name = ?");
  const row = stmt.get(userId, name.toLowerCase());
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
  const result = stmt.run(userId, name.toLowerCase());
  return result.changes > 0;
}
