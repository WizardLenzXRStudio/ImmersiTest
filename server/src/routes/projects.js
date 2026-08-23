import { Router } from 'express';
import { getDb, newId, nowIso, normalizeName } from '../db/index.js';
import { badRequest, notFound, wrap } from '../lib/errors.js';
import {
  archiveProject,
  deleteProjectPermanently,
  describeProjectDeletion,
} from '../services/deletion.js';

const router = Router();

/** Project row + the aggregates the dashboard table needs. */
const LIST_SQL = `
  SELECT p.*,
         (SELECT COUNT(*) FROM project_members m WHERE m.projectId = p.id)            AS studentCount,
         (SELECT COUNT(*) FROM test_sessions s WHERE s.projectId = p.id)             AS sessionCount,
         (SELECT COUNT(*) FROM bugs b WHERE b.projectId = p.id AND b.status IN ('open','in_progress')) AS openBugs,
         ls.id                AS latestSessionId,
         ls.capturedAt        AS latestCapturedAt,
         ls.avgFps            AS latestAvgFps,
         ls.onePercentLowFps  AS latestOnePercentLowFps,
         ls.memoryMB          AS latestMemoryMB,
         ls.gradeLetter       AS latestGrade,
         ls.gradeScore        AS latestScore,
         ls.performanceStatus AS latestStatus,
         ls.captureStatus     AS latestCaptureStatus
  FROM projects p
  LEFT JOIN test_sessions ls
    ON ls.id = (SELECT id FROM test_sessions WHERE projectId = p.id
                ORDER BY capturedAt DESC, importedAt DESC LIMIT 1)
`;

router.get(
  '/',
  wrap((req, res) => {
    const includeArchived = req.query.includeArchived === 'true';
    const rows = getDb()
      .prepare(`${LIST_SQL} ${includeArchived ? '' : "WHERE p.status = 'active'"} ORDER BY p.projectName COLLATE NOCASE`)
      .all();
    res.json({ projects: rows });
  }),
);

router.get(
  '/:id',
  wrap((req, res) => {
    const db = getDb();
    const project = db.prepare(`${LIST_SQL} WHERE p.id = ?`).get(req.params.id);
    if (!project) throw notFound('Project not found');

    project.students = db
      .prepare(
        `SELECT st.*, m.role,
                (SELECT COUNT(*) FROM test_sessions s WHERE s.studentId = st.id AND s.projectId = ?) AS sessionCount
         FROM project_members m JOIN students st ON st.id = m.studentId
         WHERE m.projectId = ? ORDER BY st.studentName COLLATE NOCASE`,
      )
      .all(req.params.id, req.params.id);

    project.sessions = db
      .prepare(
        `SELECT s.id, s.capturedAt, s.importedAt, s.avgFps, s.minFps, s.onePercentLowFps, s.avgFrameMs,
                s.droppedFrames, s.totalFrames, s.memoryMB, s.targetFps, s.platform, s.device,
                s.captureStatus, s.performanceStatus, s.gradeLetter, s.gradeScore,
                st.studentName, st.id AS studentRowId
         FROM test_sessions s JOIN students st ON st.id = s.studentId
         WHERE s.projectId = ? ORDER BY s.capturedAt ASC`,
      )
      .all(req.params.id);

    project.bugs = db
      .prepare('SELECT * FROM bugs WHERE projectId = ? ORDER BY createdAt DESC')
      .all(req.params.id);

    res.json({ project });
  }),
);

router.post(
  '/',
  wrap((req, res) => {
    const { projectName, platform, targetFps, description } = req.body ?? {};
    if (!projectName || !projectName.trim()) throw badRequest('projectName is required');
    if (!['VR', 'AR'].includes(platform)) throw badRequest('platform must be "VR" or "AR"');
    const fps = Number(targetFps);
    if (!Number.isFinite(fps) || fps < 1) throw badRequest('targetFps must be a positive number');

    const now = nowIso();
    const id = newId('prj');
    getDb()
      .prepare(
        `INSERT INTO projects (id, projectName, normalizedName, platform, targetFps, description, status, createdAt, updatedAt)
         VALUES (?,?,?,?,?,?, 'active', ?, ?)`,
      )
      .run(id, projectName.trim(), normalizeName(projectName), platform, Math.round(fps), description ?? null, now, now);

    res.status(201).json({ project: getDb().prepare(`${LIST_SQL} WHERE p.id = ?`).get(id) });
  }),
);

router.patch(
  '/:id',
  wrap((req, res) => {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    if (!existing) throw notFound('Project not found');

    const { projectName, platform, targetFps, description, status } = req.body ?? {};
    const next = {
      projectName: projectName?.trim() || existing.projectName,
      platform: platform ?? existing.platform,
      targetFps: targetFps != null ? Math.round(Number(targetFps)) : existing.targetFps,
      description: description !== undefined ? description : existing.description,
      status: status ?? existing.status,
    };
    if (!['VR', 'AR'].includes(next.platform)) throw badRequest('platform must be "VR" or "AR"');
    if (!Number.isFinite(next.targetFps) || next.targetFps < 1) throw badRequest('targetFps invalid');
    if (!['active', 'archived'].includes(next.status)) throw badRequest('status invalid');

    // Renaming must keep the normalized key in step, or the next import would
    // create a second project instead of matching this one.
    db.prepare(
      `UPDATE projects SET projectName = ?, normalizedName = ?, platform = ?, targetFps = ?,
                           description = ?, status = ?, archivedAt = ?, updatedAt = ?
       WHERE id = ?`,
    ).run(
      next.projectName,
      normalizeName(next.projectName),
      next.platform,
      next.targetFps,
      next.description,
      next.status,
      next.status === 'archived' ? (existing.archivedAt ?? nowIso()) : null,
      nowIso(),
      req.params.id,
    );

    res.json({ project: db.prepare(`${LIST_SQL} WHERE p.id = ?`).get(req.params.id) });
  }),
);

/** What a permanent delete would destroy — drives the confirmation dialog. */
router.get(
  '/:id/deletion-impact',
  wrap((req, res) => {
    const p = getDb().prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id);
    if (!p) throw notFound('Project not found');
    res.json({ impact: describeProjectDeletion(req.params.id) });
  }),
);

router.delete(
  '/:id',
  wrap((req, res) => {
    const p = getDb().prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id);
    if (!p) throw notFound('Project not found');

    if (req.query.permanent === 'true') {
      res.json({ deleted: 'permanent', ...deleteProjectPermanently(req.params.id) });
    } else {
      archiveProject(req.params.id, true);
      res.json({ deleted: 'archived' });
    }
  }),
);

export default router;
