import { Router } from 'express';
import { getDb } from '../db/index.js';
import { wrap } from '../lib/errors.js';
import config from '../config.js';

const router = Router();

router.get(
  '/stats',
  wrap((req, res) => {
    const db = getDb();
    const one = (sql, ...a) => db.prepare(sql).get(...a);

    const totals = {
      projects: one("SELECT COUNT(*) AS n FROM projects WHERE status = 'active'").n,
      archivedProjects: one("SELECT COUNT(*) AS n FROM projects WHERE status = 'archived'").n,
      students: one("SELECT COUNT(*) AS n FROM students WHERE status = 'active'").n,
      sessions: one('SELECT COUNT(*) AS n FROM test_sessions').n,
      openBugs: one("SELECT COUNT(*) AS n FROM bugs WHERE status IN ('open','in_progress')").n,
      criticalBugs: one(
        "SELECT COUNT(*) AS n FROM bugs WHERE severity = 'critical' AND status IN ('open','in_progress')",
      ).n,
    };

    // Distribution is over the LATEST session of each active project — that is
    // what "how is the class doing right now" means.
    const latest = db
      .prepare(
        `SELECT ls.performanceStatus AS status, ls.captureStatus AS capture
         FROM projects p
         JOIN test_sessions ls ON ls.id = (
           SELECT id FROM test_sessions WHERE projectId = p.id
           ORDER BY capturedAt DESC, importedAt DESC LIMIT 1)
         WHERE p.status = 'active'`,
      )
      .all();

    const dist = { pass: 0, warn: 0, fail: 0, invalid: 0 };
    for (const r of latest) {
      if (r.capture === 'invalid') dist.invalid++;
      else if (dist[r.status] !== undefined) dist[r.status]++;
    }
    const graded = dist.pass + dist.warn + dist.fail;
    const pct = (n) => (graded ? Math.round((n / graded) * 100) : 0);

    res.json({
      totals,
      distribution: { ...dist, counted: graded },
      distributionPct: { pass: pct(dist.pass), warn: pct(dist.warn), fail: pct(dist.fail) },
      recentSessions: db
        .prepare(
          `SELECT s.id, s.capturedAt, s.avgFps, s.gradeLetter, s.performanceStatus, s.captureStatus,
                  s.platform, p.projectName, p.id AS projectId, st.studentName
           FROM test_sessions s
           JOIN projects p ON p.id = s.projectId
           JOIN students st ON st.id = s.studentId
           ORDER BY s.importedAt DESC LIMIT 10`,
        )
        .all(),
      version: config.version,
    });
  }),
);

export default router;
