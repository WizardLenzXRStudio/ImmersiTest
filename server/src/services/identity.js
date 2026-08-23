/**
 * Resolves an imported report to a project and a student, creating them when
 * they do not exist yet.
 *
 * Matching rules (deterministic, so the same report always lands in the same
 * place):
 *   project — by normalized name
 *   student — by studentId when present, otherwise by normalized name
 *
 * studentId is frequently blank (XRTestProfiler defaults it to ""), so the name
 * fallback is the common path, not the exception.
 */
import { getDb, newId, nowIso, normalizeName } from '../db/index.js';

export function resolveProject(report) {
  const db = getDb();
  const norm = normalizeName(report.projectName);

  const existing = db.prepare('SELECT * FROM projects WHERE normalizedName = ?').get(norm);
  if (existing) return { project: existing, created: false };

  const now = nowIso();
  const id = newId('prj');
  db.prepare(
    `INSERT INTO projects (id, projectName, normalizedName, platform, targetFps, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
  ).run(id, report.projectName, norm, report.platform, report.targetFps, now, now);

  return { project: db.prepare('SELECT * FROM projects WHERE id = ?').get(id), created: true };
}

/**
 * The local dashboard keeps a row per tester so history can be grouped, but the
 * profiler need not supply a name. An anonymous capture resolves to a single
 * shared "Unassigned Tester" record rather than inventing a person per report.
 */
export const ANONYMOUS_TESTER = 'Unassigned Tester';

export function resolveStudent(report) {
  const db = getDb();
  const displayName = report.studentName ?? ANONYMOUS_TESTER;

  if (report.studentId) {
    const byCode = db.prepare('SELECT * FROM students WHERE studentId = ?').get(report.studentId);
    if (byCode) return { student: byCode, created: false };
  }

  const norm = normalizeName(displayName);
  // Only fall back to name matching for students that have no code at all —
  // otherwise two different people sharing a display name would be merged.
  const byName = db
    .prepare('SELECT * FROM students WHERE normalizedName = ? AND studentId IS NULL')
    .get(norm);
  if (byName) {
    if (report.studentId) {
      db.prepare('UPDATE students SET studentId = ?, updatedAt = ? WHERE id = ?').run(
        report.studentId,
        nowIso(),
        byName.id,
      );
      return {
        student: db.prepare('SELECT * FROM students WHERE id = ?').get(byName.id),
        created: false,
      };
    }
    return { student: byName, created: false };
  }

  const now = nowIso();
  const id = newId('stu');
  db.prepare(
    `INSERT INTO students (id, studentId, studentName, normalizedName, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`,
  ).run(id, report.studentId, displayName, norm, now, now);

  return { student: db.prepare('SELECT * FROM students WHERE id = ?').get(id), created: true };
}

/** Idempotent — a student may appear in many reports for the same project. */
export function linkMember(projectId, studentId) {
  getDb()
    .prepare(
      `INSERT INTO project_members (projectId, studentId, joinedAt) VALUES (?, ?, ?)
       ON CONFLICT(projectId, studentId) DO NOTHING`,
    )
    .run(projectId, studentId, nowIso());
}
