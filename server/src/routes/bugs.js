import { Router } from 'express';
import { getDb, newId, nowIso } from '../db/index.js';
import { badRequest, notFound, wrap } from '../lib/errors.js';

const router = Router();

// 'critical' must keep its name — shared/xr-metrics deducts grade points for it.
const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const STATUSES = ['open', 'in_progress', 'resolved', 'closed'];

const SELECT = `
  SELECT b.*, p.projectName, st.studentName
  FROM bugs b
  JOIN projects p ON p.id = b.projectId
  LEFT JOIN students st ON st.id = b.studentId
`;

/** Severity order for sorting: critical first. */
const SEVERITY_RANK = `CASE b.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`;
const SORTS = {
  created: 'b.createdAt DESC',
  oldest: 'b.createdAt ASC',
  severity: `${SEVERITY_RANK} ASC, b.createdAt DESC`,
  status: 'b.status ASC, b.createdAt DESC',
  project: 'p.projectName COLLATE NOCASE ASC, b.createdAt DESC',
};

router.get(
  '/',
  wrap((req, res) => {
    const { projectId, sessionId, status, severity, q, sort } = req.query;
    const where = [];
    const args = [];
    if (projectId) { where.push('b.projectId = ?'); args.push(projectId); }
    if (sessionId) { where.push('b.sessionId = ?'); args.push(sessionId); }
    if (status) { where.push('b.status = ?'); args.push(status); }
    if (severity) { where.push('b.severity = ?'); args.push(severity); }
    if (q) {
      where.push('(b.title LIKE ? OR b.description LIKE ?)');
      args.push(`%${q}%`, `%${q}%`);
    }

    res.json({
      bugs: getDb()
        .prepare(
          `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
           ORDER BY ${SORTS[sort] ?? SORTS.created}`,
        )
        .all(...args),
    });
  }),
);

/** Single defect — avoids the client fetching the whole list to edit one. */
router.get(
  '/:id',
  wrap((req, res) => {
    const bug = getDb().prepare(`${SELECT} WHERE b.id = ?`).get(req.params.id);
    if (!bug) throw notFound('Defect not found');
    res.json({ bug });
  }),
);

router.post(
  '/',
  wrap((req, res) => {
    const { projectId, sessionId, studentId, title, description, severity } = req.body ?? {};
    if (!projectId) throw badRequest('projectId is required');
    if (!title || !title.trim()) throw badRequest('title is required');
    if (!SEVERITIES.includes(severity)) throw badRequest(`severity must be one of ${SEVERITIES.join(', ')}`);

    const db = getDb();
    if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)) throw notFound('Project not found');

    const now = nowIso();
    const id = newId('bug');
    db.prepare(
      `INSERT INTO bugs (id, projectId, sessionId, studentId, title, description, severity, status, createdAt, updatedAt)
       VALUES (?,?,?,?,?,?,?, 'open', ?, ?)`,
    ).run(id, projectId, sessionId ?? null, studentId ?? null, title.trim(), description ?? null, severity, now, now);

    // Defects do not affect the numeric score, so no re-grade is needed.
    res.status(201).json({ bug: db.prepare(`${SELECT} WHERE b.id = ?`).get(id) });
  }),
);

router.patch(
  '/:id',
  wrap((req, res) => {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM bugs WHERE id = ?').get(req.params.id);
    if (!existing) throw notFound('Bug not found');

    const { title, description, severity, status, resolutionNote } = req.body ?? {};
    const next = {
      title: title?.trim() || existing.title,
      description: description !== undefined ? description : existing.description,
      severity: severity ?? existing.severity,
      status: status ?? existing.status,
      resolutionNote: resolutionNote !== undefined ? resolutionNote : existing.resolutionNote,
    };
    if (!SEVERITIES.includes(next.severity)) throw badRequest('severity invalid');
    if (!STATUSES.includes(next.status)) throw badRequest('status invalid');

    const resolvedAt =
      next.status === 'resolved' ? (existing.resolvedAt ?? nowIso()) : null;

    db.prepare(
      `UPDATE bugs SET title = ?, description = ?, severity = ?, status = ?,
                       resolutionNote = ?, resolvedAt = ?, updatedAt = ?
       WHERE id = ?`,
    ).run(next.title, next.description, next.severity, next.status, next.resolutionNote, resolvedAt, nowIso(), req.params.id);

    res.json({ bug: db.prepare(`${SELECT} WHERE b.id = ?`).get(req.params.id) });
  }),
);

router.delete(
  '/:id',
  wrap((req, res) => {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM bugs WHERE id = ?').get(req.params.id);
    if (!existing) throw notFound('Bug not found');
    db.prepare('DELETE FROM bugs WHERE id = ?').run(req.params.id);
    res.json({ deleted: true });
  }),
);

export default router;
