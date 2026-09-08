import type Database from 'better-sqlite3'

// The current schema for a fresh installation. No historical upgrades or sample data.
export function initializeSchema(database: Database.Database) {
  database.transaction(() => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS app_metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workspace_entities (key TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, entity_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workspace_state (id INTEGER PRIMARY KEY NOT NULL, revision INTEGER NOT NULL, fields TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workspace_receipts (id TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL, digest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, content BLOB NOT NULL, unreferenced_since INTEGER NOT NULL DEFAULT 0);
    `)
  })()
}
