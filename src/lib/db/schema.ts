import * as SQLite from 'expo-sqlite';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('neurex.db').then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          start_ms INTEGER NOT NULL,
          end_ms INTEGER NOT NULL,
          tib_min INTEGER NOT NULL,
          tst_min INTEGER NOT NULL,
          waso_min INTEGER NOT NULL,
          efficiency REAL NOT NULL,
          stage_minutes_json TEXT NOT NULL,
          epochs_json TEXT NOT NULL,
          stim_pulses_json TEXT NOT NULL,
          score INTEGER,
          uploaded_at_ms INTEGER
        );
        CREATE TABLE IF NOT EXISTS device (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          serial TEXT,
          firmware TEXT,
          battery INTEGER,
          last_sync_ms INTEGER,
          paired INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS prefs (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
      return db;
    });
  }
  return dbPromise;
}
