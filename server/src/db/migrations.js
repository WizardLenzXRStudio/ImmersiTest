/**
 * Versioned schema migrations.
 *
 * schema.sql creates the CURRENT shape for a fresh database. These migrations
 * bring an OLDER database up to the same shape. The applied version lives in
 * app_meta.schemaVersion.
 *
 * SQLite cannot ALTER a CHECK constraint, so vocabulary changes require the
 * standard rebuild dance: create new table -> copy + map -> drop -> rename.
 */

const MIGRATIONS = [
  {
    version: 1,
    name: 'bug severity/status vocabulary (major->high, minor->medium, wont_fix->closed)',
    /** @returns {boolean} true when it actually changed something. */
    up(db) {
      // Nothing to do on a fresh database — schema.sql already has the new
      // vocabulary and the table will be empty.
      const cols = db.prepare(`PRAGMA table_info(bugs)`).all();
      if (!cols.length) return false;

      const sql = db
        .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='bugs'`)
        .get()?.sql ?? '';
      // Already migrated (fresh DB built from the current schema.sql).
      if (sql.includes("'high'")) return false;

      db.exec(`
        CREATE TABLE bugs_new (
          id             TEXT PRIMARY KEY,
          projectId      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          sessionId      TEXT REFERENCES test_sessions(id) ON DELETE SET NULL,
          studentId      TEXT REFERENCES students(id) ON DELETE SET NULL,
          title          TEXT NOT NULL,
          description    TEXT,
          severity       TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low')),
          status         TEXT NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open','in_progress','resolved','closed')),
          resolutionNote TEXT,
          createdAt      TEXT NOT NULL,
          updatedAt      TEXT NOT NULL,
          resolvedAt     TEXT
        );

        INSERT INTO bugs_new
        SELECT id, projectId, sessionId, studentId, title, description,
               CASE severity WHEN 'major' THEN 'high'
                             WHEN 'minor' THEN 'medium'
                             ELSE severity END,
               CASE status   WHEN 'wont_fix' THEN 'closed'
                             ELSE status END,
               resolutionNote, createdAt, updatedAt, resolvedAt
        FROM bugs;

        DROP TABLE bugs;
        ALTER TABLE bugs_new RENAME TO bugs;
        CREATE INDEX IF NOT EXISTS idx_bugs_project ON bugs(projectId, status);
        CREATE INDEX IF NOT EXISTS idx_bugs_session ON bugs(sessionId);
      `);
      return true;
    },
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS.at(-1)?.version ?? 0;

export function runMigrations(db) {
  const current = Number(
    db.prepare(`SELECT value FROM app_meta WHERE key = 'schemaVersion'`).get()?.value ?? 0,
  );

  const pending = MIGRATIONS.filter((m) => m.version > current);
  for (const m of pending) {
    // Foreign keys must be off during a table rebuild or the DROP cascades.
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      const changed = m.up(db);
      db.prepare(
        `INSERT INTO app_meta (key, value) VALUES ('schemaVersion', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run(String(m.version));
      db.exec('COMMIT');
      // A fresh database is already at the current shape, so stay quiet there.
      if (changed) console.log(`[db] migration ${m.version} applied - ${m.name}`);
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${m.version} (${m.name}) failed: ${err.message}`);
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }

  if (current === 0 && !pending.length) {
    db.prepare(
      `INSERT INTO app_meta (key, value) VALUES ('schemaVersion', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(String(LATEST_SCHEMA_VERSION));
  }
  return pending.length;
}
