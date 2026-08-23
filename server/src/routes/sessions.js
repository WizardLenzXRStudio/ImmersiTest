import { Router } from 'express';
import { getDb, nowIso } from '../db/index.js';
import { badRequest, notFound, wrap } from '../lib/errors.js';
import { deleteSession } from '../services/deletion.js';
import { recomputeSession } from '../services/grading.js';
import { CHECKLIST } from '../../../shared/xr-metrics/index.js';

const router = Router();

router.get(
  '/',
  wrap((req, res) => {
    const { projectId, studentId, platform, status, from, to } = req.query;
    const where = [];
    const args = [];
    if (projectId) { where.push('s.projectId = ?'); args.push(projectId); }
    if (studentId) { where.push('s.studentId = ?'); args.push(studentId); }
    if (platform) { where.push('s.platform = ?'); args.push(platform); }
    if (status) { where.push('s.performanceStatus = ?'); args.push(status); }
    if (from) { where.push('s.capturedAt >= ?'); args.push(from); }
    if (to) { where.push('s.capturedAt <= ?'); args.push(to); }

    const rows = getDb()
      .prepare(
        `SELECT s.id, s.capturedAt, s.importedAt, s.avgFps, s.minFps, s.onePercentLowFps,
                s.avgFrameMs, s.droppedFrames, s.totalFrames, s.memoryMB, s.targetFps,
                s.platform, s.device, s.captureStatus, s.performanceStatus,
                s.gradeLetter, s.gradeScore, s.originalFilename,
                p.projectName, p.id AS projectId, st.studentName, st.id AS studentId
         FROM test_sessions s
         JOIN projects p ON p.id = s.projectId
         JOIN students st ON st.id = s.studentId
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY s.capturedAt DESC`,
      )
      .all(...args);
    res.json({ sessions: rows });
  }),
);

/** Full report: metrics + series + checklist + linked bugs. */
router.get(
  '/:id',
  wrap((req, res) => {
    const db = getDb();
    const session = db
      .prepare(
        `SELECT s.*, p.projectName, p.id AS projectId, st.studentName, st.studentId AS studentCode, st.id AS studentRowId
         FROM test_sessions s
         JOIN projects p ON p.id = s.projectId
         JOIN students st ON st.id = s.studentId
         WHERE s.id = ?`,
      )
      .get(req.params.id);
    if (!session) throw notFound('Test session not found');

    // rawReport is large and already available via /raw — keep the list payload lean.
    delete session.rawReport;

    session.series = db
      .prepare(
        `SELECT tSeconds AS t, fps, frameMs, memMB FROM performance_samples
         WHERE sessionId = ? ORDER BY sampleIndex ASC`,
      )
      .all(req.params.id);

    const results = db
      .prepare('SELECT itemId, result, note FROM checklist_results WHERE sessionId = ?')
      .all(req.params.id);
    session.checklist = Object.fromEntries(results.map((r) => [r.itemId, r.result]));
    // Notes were already read here; exposing them lets the PDF report show them.
    session.checklistNotes = Object.fromEntries(
      results.filter((r) => r.note).map((r) => [r.itemId, r.note]),
    );
    session.checklistItems = CHECKLIST;

    session.bugs = db
      .prepare(
        `SELECT * FROM bugs WHERE projectId = ? ORDER BY (sessionId = ?) DESC, createdAt DESC`,
      )
      .all(session.projectId, req.params.id);

    res.json({ session });
  }),
);

/** The original report, exactly as imported. */
router.get(
  '/:id/raw',
  wrap((req, res) => {
    const row = getDb()
      .prepare('SELECT rawReport, originalFilename, reportFile FROM test_sessions WHERE id = ?')
      .get(req.params.id);
    if (!row) throw notFound('Test session not found');

    if (req.query.download === 'true') {
      res.setHeader('Content-Disposition', `attachment; filename="${row.originalFilename ?? row.reportFile ?? 'report.json'}"`);
    }
    res.type('application/json').send(row.rawReport);
  }),
);

/** Set or clear one checklist item, then re-grade. */
router.put(
  '/:id/checklist/:itemId',
  wrap((req, res) => {
    const db = getDb();
    const session = db.prepare('SELECT id FROM test_sessions WHERE id = ?').get(req.params.id);
    if (!session) throw notFound('Test session not found');
    if (!CHECKLIST.some((c) => c.id === req.params.itemId)) throw badRequest('Unknown checklist item');

    const { result } = req.body ?? {};
    if (result === null) {
      db.prepare('DELETE FROM checklist_results WHERE sessionId = ? AND itemId = ?').run(
        req.params.id,
        req.params.itemId,
      );
    } else {
      if (!['pass', 'warn', 'fail'].includes(result)) throw badRequest('result must be pass, warn, fail or null');
      db.prepare(
        `INSERT INTO checklist_results (sessionId, itemId, result, assessedAt) VALUES (?,?,?,?)
         ON CONFLICT(sessionId, itemId) DO UPDATE SET result = excluded.result, assessedAt = excluded.assessedAt`,
      ).run(req.params.id, req.params.itemId, result, nowIso());
    }

    const derived = recomputeSession(req.params.id);
    const rows = db
      .prepare('SELECT itemId, result FROM checklist_results WHERE sessionId = ?')
      .all(req.params.id);
    res.json({ checklist: Object.fromEntries(rows.map((r) => [r.itemId, r.result])), derived });
  }),
);

router.delete(
  '/:id',
  wrap((req, res) => {
    const removed = deleteSession(req.params.id);
    if (!removed) throw notFound('Test session not found');
    res.json({ deleted: 'permanent', ...removed });
  }),
);

export default router;
