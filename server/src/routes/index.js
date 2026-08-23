/**
 * API surface.
 *
 * Hosted mode mounts ONLY what the public workflow needs: health, the checklist
 * definition and the temporary analysis endpoints. The SQLite dashboard —
 * applications, testers, stored sessions, defects, bulk import, backup export
 * and the legacy migration — is not mounted at all, so there is no route that
 * could create or read permanent user data on the public service.
 */
import { Router } from 'express';
import config, { paths } from '../config.js';
import { wrap } from '../lib/errors.js';
import analysis from './analysis.js';
import { CHECKLIST, EVALUATION_AREAS, GRADE_CONFIG } from '../../../shared/xr-metrics/index.js';

const router = Router();

/* ------------------------------------------------------------ always on -- */

router.get(
  '/health',
  wrap(async (req, res) => {
    let database = 'not-used';
    if (config.isLocal) {
      database = 'ok';
      try {
        const { getDb } = await import('../db/index.js');
        getDb().prepare('SELECT 1').get();
      } catch {
        database = 'error';
      }
    }

    const healthy = database !== 'error';
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      product: config.product,
      vendor: config.vendor,
      tagline: config.tagline,
      version: config.version,
      mode: config.mode,
      database,
      ...(config.isLocal ? { dbFile: paths.dbFile } : {}),
      sessionTtlMinutes: Math.round(config.session.ttlMs / 60_000),
      uptimeSeconds: Math.round(process.uptime()),
    });
  }),
);

/** The evaluation model, so no client ever hardcodes a second copy. */
router.get('/checklist-items', (req, res) =>
  res.json({ items: CHECKLIST, areas: EVALUATION_AREAS, grading: GRADE_CONFIG }),
);

// Temporary analysis sessions: the hosted workflow, also available locally so
// the same report view can be exercised in development.
router.use('/', analysis);

/* ------------------------------------------------- local dashboard only -- */

if (config.isLocal) {
  const [
    { default: projects },
    { default: students },
    { default: sessions },
    { default: bugs },
    { default: dashboard },
    { default: reports },
    { default: migrate },
    { default: data },
  ] = await Promise.all([
    import('./projects.js'),
    import('./students.js'),
    import('./sessions.js'),
    import('./bugs.js'),
    import('./dashboard.js'),
    import('./reports.js'),
    import('./migrate.js'),
    import('./data.js'),
  ]);

  router.use('/projects', projects);
  router.use('/students', students);
  router.use('/sessions', sessions);
  router.use('/bugs', bugs);
  router.use('/dashboard', dashboard);
  router.use('/reports', reports);
  router.use('/migrate', migrate);
  router.use('/data', data);
}

export default router;
