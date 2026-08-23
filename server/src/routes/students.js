import { Router } from 'express';
import { getDb, newId, nowIso, normalizeName } from '../db/index.js';
import { badRequest, notFound, wrap } from '../lib/errors.js';
import {
  archiveStudent,
  deleteStudentPermanently,
  describeStudentDeletion,
} from '../services/deletion.js';

const router = Router();

const LIST_SQL = `
  SELECT st.*,
         (SELECT COUNT(*) FROM project_members m WHERE m.studentId = st.id) AS projectCount,
         (SELECT COUNT(*) FROM test_sessions s WHERE s.studentId = st.id)   AS sessionCount,
         ls.id                AS latestSessionId,
         ls.capturedAt        AS latestCapturedAt,
         ls.avgFps            AS latestAvgFps,
         ls.gradeLetter       AS latestGrade,
         ls.performanceStatus AS latestStatus
  FROM students st
  LEFT JOIN test_sessions ls
    ON ls.id = (SELECT id FROM test_sessions WHERE studentId = st.id
                ORDER BY capturedAt DESC, importedAt DESC LIMIT 1)
`;

router.get(
  '/',
  wrap((req, res) => {
    const includeArchived = req.query.includeArchived === 'true';
    res.json({
      students: getDb()
        .prepare(`${LIST_SQL} ${includeArchived ? '' : "WHERE st.status = 'active'"} ORDER BY st.studentName COLLATE NOCASE`)
        .all(),
    });
  }),
);

router.get(
  '/:id',
  wrap((req, res) => {
    const db = getDb();
    const student = db.prepare(`${LIST_SQL} WHERE st.id = ?`).get(req.params.id);
    if (!student) throw notFound('Student not found');

    student.projects = db
      .prepare(
        `SELECT p.*, m.role,
                (SELECT COUNT(*) FROM test_sessions s WHERE s.projectId = p.id AND s.studentId = ?) AS sessionCount
         FROM project_members m JOIN projects p ON p.id = m.projectId
         WHERE m.studentId = ? ORDER BY p.projectName COLLATE NOCASE`,
      )
      .all(req.params.id, req.params.id);

    student.sessions = db
      .prepare(
        `SELECT s.id, s.capturedAt, s.avgFps, s.minFps, s.onePercentLowFps, s.avgFrameMs,
                s.droppedFrames, s.totalFrames, s.memoryMB, s.targetFps, s.platform, s.device,
                s.captureStatus, s.performanceStatus, s.gradeLetter, s.gradeScore,
                p.projectName, p.id AS projectRowId
         FROM test_sessions s JOIN projects p ON p.id = s.projectId
         WHERE s.studentId = ? ORDER BY s.capturedAt ASC`,
      )
      .all(req.params.id);

    res.json({ student });
  }),
);

router.post(
  '/',
  wrap((req, res) => {
    const { studentName, studentId, email } = req.body ?? {};
    if (!studentName || !studentName.trim()) throw badRequest('studentName is required');

    const now = nowIso();
    const id = newId('stu');
    getDb()
      .prepare(
        `INSERT INTO students (id, studentId, studentName, normalizedName, email, status, createdAt, updatedAt)
         VALUES (?,?,?,?,?, 'active', ?, ?)`,
      )
      // Blank student codes must be NULL, never "", or the UNIQUE index would
      // allow only one code-less student.
      .run(id, studentId?.trim() || null, studentName.trim(), normalizeName(studentName), email?.trim() || null, now, now);

    res.status(201).json({ student: getDb().prepare(`${LIST_SQL} WHERE st.id = ?`).get(id) });
  }),
);

router.patch(
  '/:id',
  wrap((req, res) => {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
    if (!existing) throw notFound('Student not found');

    const { studentName, studentId, email, status } = req.body ?? {};
    const nextName = studentName?.trim() || existing.studentName;
    const nextStatus = status ?? existing.status;
    if (!['active', 'archived'].includes(nextStatus)) throw badRequest('status invalid');

    db.prepare(
      `UPDATE students SET studentName = ?, normalizedName = ?, studentId = ?, email = ?,
                           status = ?, archivedAt = ?, updatedAt = ?
       WHERE id = ?`,
    ).run(
      nextName,
      normalizeName(nextName),
      studentId !== undefined ? studentId?.trim() || null : existing.studentId,
      email !== undefined ? email?.trim() || null : existing.email,
      nextStatus,
      nextStatus === 'archived' ? (existing.archivedAt ?? nowIso()) : null,
      nowIso(),
      req.params.id,
    );

    res.json({ student: db.prepare(`${LIST_SQL} WHERE st.id = ?`).get(req.params.id) });
  }),
);

router.get(
  '/:id/deletion-impact',
  wrap((req, res) => {
    const s = getDb().prepare('SELECT id FROM students WHERE id = ?').get(req.params.id);
    if (!s) throw notFound('Student not found');
    res.json({ impact: describeStudentDeletion(req.params.id) });
  }),
);

router.delete(
  '/:id',
  wrap((req, res) => {
    const s = getDb().prepare('SELECT id FROM students WHERE id = ?').get(req.params.id);
    if (!s) throw notFound('Student not found');

    if (req.query.permanent === 'true') {
      res.json({ deleted: 'permanent', ...deleteStudentPermanently(req.params.id) });
    } else {
      archiveStudent(req.params.id, true);
      res.json({ deleted: 'archived' });
    }
  }),
);

export default router;
