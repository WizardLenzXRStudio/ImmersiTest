/**
 * Local SQLite database.
 *
 * Uses Node's built-in `node:sqlite` — no native module to compile, nothing to
 * install, works offline. The database file lives at data/xr-test-lab.db and is
 * the permanent source of truth.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { paths } from '../config.js';
import { runMigrations } from './migrations.js';
import { CHECKLIST } from '../../../shared/xr-metrics/index.js';

let db = null;

export function getDb() {
  if (!db) throw new Error('Database not initialised — call initDb() first');
  return db;
}

/** Creates directories, opens the file, applies schema, seeds the rubric. */
export function initDb() {
  mkdirSync(paths.dataDir, { recursive: true });
  mkdirSync(paths.reportsDir, { recursive: true });

  db = new DatabaseSync(paths.dbFile);

  // WAL survives crashes better and allows reads during writes.
  db.exec('PRAGMA journal_mode = WAL');
  // Off by default in SQLite — without this the cascade rules are decorative.
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  db.exec(readFileSync(paths.schemaFile, 'utf8'));
  runMigrations(db);
  seedChecklist();

  return db;
}

/** The eight QA items are reference data, not user data — keep them in sync. */
function seedChecklist() {
  const upsert = db.prepare(`
    INSERT INTO checklist_items (id, title, description, sortOrder, isActive)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title,
                                  description = excluded.description,
                                  sortOrder = excluded.sortOrder
  `);
  CHECKLIST.forEach((c, i) => upsert.run(c.id, c.t, c.d, i));
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

/* ------------------------------------------------------------- helpers ---- */

export const newId = (prefix) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
export const nowIso = () => new Date().toISOString();

/** Lower-case + collapse whitespace: the key used to match names on import. */
export const normalizeName = (s) => (s ?? '').toString().trim().toLowerCase().replace(/\s+/g, ' ');

/** Runs `fn` inside a transaction, rolling back on any throw. */
export function transaction(fn) {
  const d = getDb();
  d.exec('BEGIN');
  try {
    const result = fn(d);
    d.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      d.exec('ROLLBACK');
    } catch {
      /* rollback failure must not mask the original error */
    }
    throw err;
  }
}
