/**
 * Data Management — where the data lives, how big it is, and how to back it up.
 *
 * Deliberately does not expose raw SQL or database internals: the export is a
 * plain, portable JSON bundle that a human (or a future importer) can read.
 */
import { Router } from 'express';
import { statSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDb } from '../db/index.js';
import { paths } from '../config.js';
import config from '../config.js';
import { wrap } from '../lib/errors.js';
import { buildWorkbook, rowsFromDb, workbookFilename } from '../services/excel.js';

const router = Router();

const sizeOf = (p) => {
  try {
    return existsSync(p) ? statSync(p).size : 0;
  } catch {
    return 0;
  }
};

router.get(
  '/summary',
  wrap((req, res) => {
    const db = getDb();
    const n = (sql) => db.prepare(sql).get().n;

    // WAL/SHM count toward what the user would need to copy.
    const dbBytes = ['', '-wal', '-shm'].reduce((t, suffix) => t + sizeOf(paths.dbFile + suffix), 0);
    const reportFiles = existsSync(paths.reportsDir)
      ? readdirSync(paths.reportsDir).filter((f) => f.endsWith('.json'))
      : [];
    const reportBytes = reportFiles.reduce((t, f) => t + sizeOf(resolve(paths.reportsDir, f)), 0);

    res.json({
      version: config.version,
      location: { database: paths.dbFile, reports: paths.reportsDir, dataFolder: paths.dataDir },
      counts: {
        projects: n('SELECT COUNT(*) n FROM projects'),
        students: n('SELECT COUNT(*) n FROM students'),
        sessions: n('SELECT COUNT(*) n FROM test_sessions'),
        samples: n('SELECT COUNT(*) n FROM performance_samples'),
        checklistResults: n('SELECT COUNT(*) n FROM checklist_results'),
        bugs: n('SELECT COUNT(*) n FROM bugs'),
        reportFiles: reportFiles.length,
      },
      storage: { databaseBytes: dbBytes, reportsBytes: reportBytes, totalBytes: dbBytes + reportBytes },
      schemaVersion: db.prepare("SELECT value FROM app_meta WHERE key='schemaVersion'").get()?.value ?? '0',
    });
  }),
);

/**
 * Full portable export. Includes every original report verbatim, so the bundle
 * alone is enough to reconstruct the archive.
 */
router.get(
  '/export',
  wrap((req, res) => {
    const db = getDb();
    const all = (sql) => db.prepare(sql).all();

    const bundle = {
      format: 'xr-test-lab-export-v1',
      exportedAt: new Date().toISOString(),
      appVersion: config.version,
      projects: all('SELECT * FROM projects ORDER BY projectName'),
      students: all('SELECT * FROM students ORDER BY studentName'),
      projectMembers: all('SELECT * FROM project_members'),
      checklistItems: all('SELECT * FROM checklist_items ORDER BY sortOrder'),
      bugs: all('SELECT * FROM bugs ORDER BY createdAt'),
      sessions: all('SELECT * FROM test_sessions ORDER BY capturedAt').map((s) => ({
        ...s,
        // rawReport is the original profiler JSON — re-embed it as an object so
        // the bundle is readable rather than a string of escaped JSON.
        rawReport: (() => {
          try {
            return JSON.parse(s.rawReport);
          } catch {
            return s.rawReport;
          }
        })(),
        samples: db
          .prepare('SELECT sampleIndex, tSeconds, fps, frameMs, memMB FROM performance_samples WHERE sessionId = ? ORDER BY sampleIndex')
          .all(s.id),
        checklist: db
          .prepare('SELECT itemId, result, note, assessedAt FROM checklist_results WHERE sessionId = ?')
          .all(s.id),
      })),
    };

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    res.setHeader('Content-Disposition', `attachment; filename="xr-test-lab-backup-${stamp}.json"`);
    res.type('application/json').send(JSON.stringify(bundle, null, 2));
  }),
);

/**
 * Five-sheet Excel overview: Projects, Students, Test Sessions, XR Checklist,
 * Bugs. Built server-side straight from SQLite, so the database is the source
 * of truth and nothing depends on what the browser happens to have loaded.
 */
router.get(
  '/export.xlsx',
  wrap(async (req, res) => {
    const wb = await buildWorkbook(rowsFromDb());
    res.setHeader('Content-Disposition', `attachment; filename="${workbookFilename()}"`);
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await wb.xlsx.write(res);
    res.end();
  }),
);

export default router;
