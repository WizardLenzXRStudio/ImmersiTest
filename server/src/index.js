/**
 * Entrypoint.
 *
 *   local  — initialise the SQLite dashboard, then serve everything.
 *   hosted — serve the public analysis service. No database is opened, no
 *            data directory is created and nothing is written to disk.
 */
import fs from 'node:fs';
import config, { paths } from './config.js';
import { startSweeper, stopSweeper } from './services/analysisStore.js';
import { createApp } from './app.js';

let closeDb = () => {};
let storedSessions = null;

if (config.isLocal) {
  const db = await import('./db/index.js');
  const { pruneOrphanReports } = await import('./services/deletion.js');
  const { regradeIfScoringChanged } = await import('./services/grading.js');

  db.initDb();
  closeDb = db.closeDb;

  // Scores are derived data: re-apply the current formula to anything graded
  // under an older one.
  try {
    const regraded = regradeIfScoringChanged();
    if (regraded) console.log(`[xr-test-lab] re-scored ${regraded} session(s) under the current formula`);
  } catch (err) {
    console.warn('[xr-test-lab] re-scoring skipped:', err.message);
  }

  // A crash between "delete row" and "delete file" would otherwise leave a
  // report on disk that nothing points at.
  try {
    const pruned = pruneOrphanReports(fs, paths.reportsDir);
    if (pruned) console.log(`[xr-test-lab] pruned ${pruned} orphaned report file(s)`);
  } catch (err) {
    console.warn('[xr-test-lab] orphan prune skipped:', err.message);
  }

  storedSessions = db.getDb().prepare('SELECT COUNT(*) AS n FROM test_sessions').get().n;
}

// Expired analysis sessions are removed on a timer as well as on access, so an
// abandoned upload does not linger until someone happens to ask for it.
startSweeper();

const server = createApp().listen(config.port, config.host, () => {
  // ASCII only: Windows consoles frequently run a non-UTF-8 code page and
  // would render arrows and dashes as mojibake.
  console.log('');
  console.log(`  ${config.product} ${config.version}  --  ${config.vendor}`);
  console.log(`  ${config.tagline}`);
  console.log('');
  console.log(`  mode     : ${config.mode}`);
  console.log(`  listening: http://${config.host}:${config.port}`);
  console.log(`  public   : ${config.publicBaseUrl}`);
  if (config.isLocal) {
    console.log(`  database : ${paths.dbFile}`);
    console.log(`  reports  : ${paths.reportsDir}`);
    console.log(`  sessions : ${storedSessions} stored`);
  } else {
    console.log(`  storage  : none - analyses are temporary and expire after ${Math.round(config.session.ttlMs / 60000)} min`);
    console.log(`  origins  : ${config.allowedOrigins.join(', ') || '(same-origin only)'}`);
  }
  console.log('');
});

let closing = false;
function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`\n[xr-test-lab] ${signal} - shutting down`);
  stopSweeper();
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
