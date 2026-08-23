/**
 * Temporary analysis sessions — the hosted product's entire data path.
 *
 *   Unity  --HTTPS POST /api/analyze-->  token + report URL
 *   Browser --GET /api/analysis/:token-->  the report, until it expires
 *
 * Nothing here writes to a database or to disk. A session holds one or more
 * reports in memory and disappears at its expiry, whether or not anyone
 * looked at it.
 *
 * Only the generated profiler JSON is ever accepted. There is no endpoint that
 * takes project files, source, scenes or assets, and none that persists a
 * report beyond its session.
 */
import { Router } from 'express';
import config from '../config.js';
import { badRequest, wrap, AppError } from '../lib/errors.js';
import { rateLimit, noIndex } from '../lib/security.js';
import { validateReport, explain, SUPPORTED_SCHEMAS } from '../ingest/validate.js';
import {
  createSession, getSession, deleteSession, addReport, getReport,
  setChecklistResult, SessionFullError, DuplicateReportError, stats,
} from '../services/store.js';
import { CHECKLIST } from '../../../shared/xr-metrics/index.js';

const router = Router();

const uploadLimiter = rateLimit({ name: 'uploads' });

/* ------------------------------------------------------------ serialising -- */

/**
 * Shapes a stored report the way the dashboard already consumes a session, so
 * one renderer serves both the hosted report and the local dashboard.
 */
function serializeReport(r) {
  const d = r.data;
  return {
    id: r.id,
    receivedAt: r.receivedAt,
    filename: r.filename,
    source: r.source,
    warnings: r.warnings ?? [],

    // identity — tester fields are optional metadata, never required
    projectName: d.projectName,
    testerName: d.studentName,
    platform: d.platform,
    capturedAt: d.capturedAt,
    durationSec: d.durationSec,
    targetFps: d.targetFps,
    device: d.device,
    gpu: d.gpu,
    os: d.os,

    // scored metrics
    avgFps: d.avgFps,
    avgFrameMs: d.avgFrameMs,
    droppedFrames: d.droppedFrames,
    totalFrames: d.totalFrames,
    memoryMB: d.memoryMB,

    // diagnostics — captured and shown, never scored
    minFps: d.minFps,
    onePercentLowFps: d.onePercentLowFps,
    drawCalls: d.drawCalls,
    triangles: d.triangles,
    batteryLevel: d.batteryLevel,
    batteryStatus: d.batteryStatus,

    captureStatus: d.totalFrames > 0 ? 'valid' : 'invalid',
    series: d.series ?? [],
    checklist: r.checklist,
  };
}

function serializeSession(session) {
  const remaining = Math.max(0, session.expiresAt - Date.now());
  return {
    token: session.token,
    createdAt: session.createdAt,
    expiresAt: new Date(session.expiresAt).toISOString(),
    expiresInSeconds: Math.round(remaining / 1000),
    retention:
      'Temporary. This analysis is held in memory only and is deleted automatically when it expires.',
    reportCount: session.reports.length,
    maxReports: config.session.maxReports,
    reports: session.reports.map(serializeReport),
    checklistItems: CHECKLIST,
  };
}

const reportUrlFor = (token) => `${config.publicBaseUrl}/#/r/${token}`;

/* -------------------------------------------------------------- accepting -- */

/**
 * Pulls the profiler document out of a request body.
 * Accepts either the raw report, or { report, filename } from the browser.
 */
function extractReport(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('Expected an XR Test Profiler JSON document');
  }
  if (typeof body.schema === 'string') return { doc: body, filename: null };
  if (body.report && typeof body.report === 'object' && !Array.isArray(body.report)) {
    return { doc: body.report, filename: body.filename };
  }
  throw badRequest(
    `Expected an XR Test Profiler JSON document (schema: ${SUPPORTED_SCHEMAS.join(', ')}), or { report, filename }`,
  );
}

/** Validates and stores one report, translating store errors into HTTP ones. */
async function acceptReport(session, body, source) {
  const { doc, filename } = extractReport(body);

  // Re-serialising is intentional: the stored copy is canonical JSON produced
  // by us, never a byte-for-byte echo of an untrusted upload.
  const canonical = JSON.stringify(doc);
  const result = validateReport(canonical, filename);

  if (!result.ok) {
    throw new AppError(400, result.errorCode, explain(result.errorCode), {
      detail: result.errorDetail,
      supportedSchemas: SUPPORTED_SCHEMAS,
    });
  }

  try {
    return await addReport(session, result.report, {
      filename,
      source,
      warnings: result.warnings,
      raw: canonical,
    });
  } catch (err) {
    if (err instanceof DuplicateReportError) {
      // Not an error worth failing the request over — point at what is already there.
      return getReport(session, err.reportId);
    }
    if (err instanceof SessionFullError) throw new AppError(409, 'SESSION_FULL', err.message);
    throw err;
  }
}

/* ------------------------------------------------------------------ upload -- */

/**
 * The Unity package's entry point.
 *
 * POST /api/analyze            -> new analysis session
 * POST /api/analyze?token=...  -> add to an existing one (comparison / trend)
 */
router.post(
  '/analyze',
  uploadLimiter,
  wrap(async (req, res) => {
    const requested = req.query.token;
    let session;
    let created = false;

    if (requested) {
      session = await getSession(String(requested));
      if (!session) throw new AppError(410, 'SESSION_EXPIRED', 'That analysis session has expired or does not exist.');
    } else {
      session = await createSession();
      created = true;
    }

    const report = await acceptReport(session, req.body, requested ? 'browser' : 'unity');

    res.status(201).json({
      token: session.token,
      reportId: report.id,
      reportUrl: reportUrlFor(session.token),
      apiUrl: `${config.publicBaseUrl}/api/analysis/${session.token}`,
      expiresAt: new Date(session.expiresAt).toISOString(),
      expiresInSeconds: Math.round((session.expiresAt - Date.now()) / 1000),
      reportCount: session.reports.length,
      createdSession: created,
      warnings: report.warnings ?? [],
      retention:
        'Temporary. Your report is held in memory only and is deleted automatically when this analysis expires.',
      privacy: 'Only the generated profiler JSON was uploaded. No project files, source, scenes or assets are transmitted.',
    });
  }),
);

/* ----------------------------------------------------------------- reading -- */

async function requireSession(req) {
  const session = await getSession(req.params.token);
  if (!session) {
    throw new AppError(
      410,
      'SESSION_EXPIRED',
      'This analysis has expired. Temporary reports are deleted automatically — run the test again to create a new one.',
    );
  }
  return session;
}

router.get(
  '/analysis/:token',
  noIndex,
  wrap(async (req, res) => {
    res.json({ session: serializeSession(await requireSession(req)) });
  }),
);

/** Adds another report to an open analysis, for comparison and trend. */
router.post(
  '/analysis/:token/reports',
  uploadLimiter,
  noIndex,
  wrap(async (req, res) => {
    const session = await requireSession(req);
    const report = await acceptReport(session, req.body, 'browser');
    res.status(201).json({
      reportId: report.id,
      reportCount: session.reports.length,
      session: serializeSession(session),
    });
  }),
);

router.put(
  '/analysis/:token/reports/:reportId/checklist/:itemId',
  noIndex,
  wrap(async (req, res) => {
    const session = await requireSession(req);
    if (!CHECKLIST.some((c) => c.id === req.params.itemId)) throw badRequest('Unknown checklist item');

    const { result } = req.body ?? {};
    if (result != null && !['pass', 'warn', 'fail'].includes(result)) {
      throw badRequest('result must be pass, warn, fail or null');
    }

    const checklist = await setChecklistResult(session, req.params.reportId, req.params.itemId, result ?? null);
    if (!checklist) throw notFound('Report not found in this analysis');
    res.json({ checklist });
  }),
);

/** Explicit "delete this now" — the user does not have to wait for expiry. */
router.delete(
  '/analysis/:token',
  noIndex,
  wrap(async (req, res) => {
    const existed = await deleteSession(req.params.token);
    if (!existed) throw new AppError(410, 'SESSION_EXPIRED', 'That analysis has already been deleted or expired.');
    res.json({ deleted: true });
  }),
);

/** Operational counters. Exposes totals only — never a token or a report. */
router.get(
  '/analysis-stats',
  wrap(async (req, res) => res.json(await stats())),
);

export default router;
