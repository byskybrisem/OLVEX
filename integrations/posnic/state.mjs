import { DatabaseSync } from "node:sqlite";
import { requireValue } from "./mapping.mjs";

export function openState(config) {
  const db = new DatabaseSync(config.statePath);
  try {
    // A second connector using this file must fail instead of competing for
    // the cursors or mixing routing changes with delivery.
    db.exec(`
      PRAGMA locking_mode = EXCLUSIVE;
      PRAGMA journal_mode = DELETE;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS register_routes (source TEXT PRIMARY KEY, target TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS events (
        sequence INTEGER PRIMARY KEY, action TEXT NOT NULL, reference TEXT NOT NULL,
        sale_id TEXT NOT NULL, physical TEXT NOT NULL, session TEXT NOT NULL,
        payload TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0, UNIQUE (action, reference)
      );
      CREATE INDEX IF NOT EXISTS event_sale ON events(sale_id, action);
      CREATE INDEX IF NOT EXISTS pending_events ON events(sequence) WHERE sent = 0;
      CREATE TABLE IF NOT EXISTS deletions (
        sale_id TEXT PRIMARY KEY, at TEXT NOT NULL, checked_at INTEGER NOT NULL DEFAULT 0
      );
    `);
    const get = db.prepare("SELECT value FROM settings WHERE key = ?");
    const set = db.prepare("INSERT OR REPLACE INTO settings VALUES (?, ?)");
    const binding = JSON.stringify([
      config.posnicOrigin, config.olvexOrigin, config.sourceLicense, config.sourceBranch,
      config.businessId, config.branchId, config.startOn, config.timeZone,
    ]);
    db.exec("BEGIN EXCLUSIVE");
    const previous = get.get("binding")?.value;
    requireValue(!previous || previous === binding, "Bağlayıcı durumu farklı kaynak, hedef veya tarih kapsamına bağlı.");
    set.run("binding", binding);
    for (const row of db.prepare("SELECT source, target FROM register_routes").all()) {
      requireValue(config.routes.get(row.source)?.registerId === row.target,
        "Daha önce kaydedilen fiziksel kasa eşleştirmesi değiştirilemez.");
    }
    const route = db.prepare("INSERT INTO register_routes VALUES (?, ?) ON CONFLICT(source) DO NOTHING");
    for (const [source, target] of config.routes) route.run(source, target.registerId);
    db.exec("COMMIT");
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
