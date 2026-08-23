/**
 * Deletion policy.
 *
 *   Project / Student : ARCHIVE by default (history stays viewable).
 *                       Permanent delete requires ?permanent=true and removes
 *                       every dependent session, sample, checklist result, bug
 *                       AND the stored raw report files.
 *   Test session      : always a permanent delete — DB rows via ON DELETE
 *                       CASCADE, plus the JSON file on disk.
 *
 * The invariant: the dashboard must never be able to leave a report file in
 * data/reports/ that nothing in the database points at.
 */
import { getDb, nowIso, transaction } from '../db/index.js';
import { deleteReportFile } from '../ingest/import.js';
import { recomputeProject } from './grading.js';

/** What a permanent delete would destroy — shown in the confirm dialog. */
export function describeProjectDeletion(projectId) {
  const db = getDb();
  const sessions = db
    .prepare('SELECT COUNT(*) AS n FROM test_sessions WHERE projectId = ?')
    .get(projectId).n;
  const samples = db
    .prepare(
      `SELECT COUNT(*) AS n FROM performance_samples
       WHERE sessionId IN (SELECT id FROM test_sessions WHERE projectId = ?)`,
    )
    .get(projectId).n;
  const bugs = db.prepare('SELECT COUNT(*) AS n FROM bugs WHERE projectId = ?').get(projectId).n;
  const checks = db
    .prepare(
      `SELECT COUNT(*) AS n FROM checklist_results
       WHERE sessionId IN (SELECT id FROM test_sessions WHERE projectId = ?)`,
    )
    .get(projectId).n;
  return { sessions, samples, bugs, checklistResults: checks, reportFiles: sessions };
}

export function describeStudentDeletion(studentId) {
  const db = getDb();
  const sessions = db
    .prepare('SELECT COUNT(*) AS n FROM test_sessions WHERE studentId = ?')
    .get(studentId).n;
  const samples = db
    .prepare(
      `SELECT COUNT(*) AS n FROM performance_samples
       WHERE sessionId IN (SELECT id FROM test_sessions WHERE studentId = ?)`,
    )
    .get(studentId).n;
  return { sessions, samples, reportFiles: sessions };
}

export function archiveProject(projectId, archived = true) {
  getDb()
    .prepare('UPDATE projects SET status = ?, archivedAt = ?, updatedAt = ? WHERE id = ?')
    .run(archived ? 'archived' : 'active', archived ? nowIso() : null, nowIso(), projectId);
}

export function archiveStudent(studentId, archived = true) {
  getDb()
    .prepare('UPDATE students SET status = ?, archivedAt = ?, updatedAt = ? WHERE id = ?')
    .run(archived ? 'archived' : 'active', archived ? nowIso() : null, nowIso(), studentId);
}

/** Deletes one session: cascaded rows + the raw report file. */
export function deleteSession(sessionId) {
  const db = getDb();
  const session = db.prepare('SELECT * FROM test_sessions WHERE id = ?').get(sessionId);
  if (!session) return null;

  const counts = {
    samples: db
      .prepare('SELECT COUNT(*) AS n FROM performance_samples WHERE sessionId = ?')
      .get(sessionId).n,
    checklistResults: db
      .prepare('SELECT COUNT(*) AS n FROM checklist_results WHERE sessionId = ?')
      .get(sessionId).n,
  };

  transaction(() => {
    // FKs are ON, so samples + checklist results cascade.
    db.prepare('DELETE FROM test_sessions WHERE id = ?').run(sessionId);
  });

  const fileRemoved = deleteReportFile(session.reportFile);
  // Grades of sibling sessions are unaffected, but the project's derived state
  // may be (e.g. it no longer has any sessions).
  recomputeProject(session.projectId);

  return { ...counts, fileRemoved, projectId: session.projectId };
}

/** Permanently deletes a project and everything that belongs only to it. */
export function deleteProjectPermanently(projectId) {
  const db = getDb();
  const files = db
    .prepare('SELECT reportFile FROM test_sessions WHERE projectId = ?')
    .all(projectId)
    .map((r) => r.reportFile);
  const summary = describeProjectDeletion(projectId);

  transaction(() => {
    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
  });

  let filesRemoved = 0;
  for (const f of files) if (deleteReportFile(f)) filesRemoved++;
  return { ...summary, filesRemoved };
}

/**
 * Permanently deletes a student. Their sessions cascade away, and any project
 * left with no sessions and no other members is NOT auto-removed — silently
 * destroying a project the user did not name would be worse than a stray row.
 */
export function deleteStudentPermanently(studentId) {
  const db = getDb();
  const rows = db
    .prepare('SELECT reportFile, projectId FROM test_sessions WHERE studentId = ?')
    .all(studentId);
  const summary = describeStudentDeletion(studentId);
  const projectIds = [...new Set(rows.map((r) => r.projectId))];

  transaction(() => {
    db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
  });

  let filesRemoved = 0;
  for (const r of rows) if (deleteReportFile(r.reportFile)) filesRemoved++;
  for (const pid of projectIds) recomputeProject(pid);

  return { ...summary, filesRemoved };
}

/**
 * Safety net: removes report files on disk that no session references any more.
 * Runs at startup so a crash mid-delete cannot accumulate orphans.
 */
export function pruneOrphanReports(fs, reportsDir) {
  const db = getDb();
  const known = new Set(
    db
      .prepare('SELECT reportFile FROM test_sessions WHERE reportFile IS NOT NULL')
      .all()
      .map((r) => r.reportFile),
  );
  let removed = 0;
  for (const name of fs.readdirSync(reportsDir)) {
    if (!name.endsWith('.json')) continue;
    if (!known.has(name)) {
      fs.unlinkSync(`${reportsDir}/${name}`);
      removed++;
    }
  }
  return removed;
}
