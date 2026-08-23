/**
 * Recomputes a session's derived state from the shared metrics module.
 *
 * The score depends only on the session's own metrics and its checklist
 * results, so it is refreshed at import and whenever the checklist changes.
 * Defects carry no score penalty and therefore never trigger a recompute.
 */
import { getDb } from '../db/index.js';
import { computeGrade, isInvalidCapture } from '../../../shared/xr-metrics/index.js';

export function recomputeSession(sessionId) {
  const db = getDb();
  const s = db.prepare('SELECT * FROM test_sessions WHERE id = ?').get(sessionId);
  if (!s) return null;

  const checklistRows = db
    .prepare('SELECT itemId, result FROM checklist_results WHERE sessionId = ?')
    .all(sessionId);
  const checklist = Object.fromEntries(checklistRows.map((r) => [r.itemId, r.result]));

  const g = computeGrade(s, { checklist });
  const capture = isInvalidCapture(s) ? 'invalid' : 'valid';
  // Overall status comes from the final score band; an invalid capture has none.
  const perf = g ? g.status : 'neutral';

  db.prepare(
    `UPDATE test_sessions
     SET captureStatus = ?, performanceStatus = ?, gradeLetter = ?, gradeScore = ?
     WHERE id = ?`,
  ).run(capture, perf, g ? g.grade : null, g ? g.score : null, sessionId);

  return { captureStatus: capture, performanceStatus: perf, grade: g };
}

/** Refresh every session of a project. */
export function recomputeProject(projectId) {
  const db = getDb();
  const ids = db.prepare('SELECT id FROM test_sessions WHERE projectId = ?').all(projectId);
  for (const { id } of ids) recomputeSession(id);
}

/**
 * Bumped whenever the scoring formula changes. Stored scores are derived data,
 * so on startup any session graded under an older formula is recomputed —
 * otherwise old rows would keep showing scores the current rules never produce.
 *   1 = weighted performance with checklist/bug penalties (retired)
 *   2 = 5 metrics x 12 + checklist 40 (retired)
 *   3 = 4 metrics x 15 + checklist 40 (Min FPS and 1% Low no longer scored)
 */
export const SCORING_VERSION = 3;

export function regradeIfScoringChanged() {
  const db = getDb();
  const stored = Number(
    db.prepare("SELECT value FROM app_meta WHERE key = 'scoringVersion'").get()?.value ?? 0,
  );
  if (stored === SCORING_VERSION) return 0;

  const ids = db.prepare('SELECT id FROM test_sessions').all();
  for (const { id } of ids) recomputeSession(id);

  db.prepare(
    `INSERT INTO app_meta (key, value) VALUES ('scoringVersion', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(SCORING_VERSION));

  return ids.length;
}
