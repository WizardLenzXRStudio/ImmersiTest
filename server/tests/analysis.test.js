/**
 * Hosted mode: the temporary analysis service.
 *
 * Runs the app with XRLAB_MODE=hosted, which is the production shape — no
 * database, no permanent routes, no stored reports. node:test gives each test
 * file its own process, so setting the environment here cannot leak into the
 * local-mode suite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.XRLAB_MODE = 'hosted';
process.env.XRLAB_PUBLIC_URL = 'https://xrtestlab.example.com';
process.env.XRLAB_ALLOWED_ORIGINS = 'https://allowed.example.com';
process.env.XRLAB_SESSION_TTL_MINUTES = '60';
process.env.XRLAB_SESSION_MAX_REPORTS = '4';
process.env.XRLAB_UPLOAD_LIMIT = '256kb';
// The suite makes far more than the default number of uploads.
process.env.XRLAB_RATE_MAX = '100000';

const { default: config } = await import('../src/config.js');
const store = await import('../src/services/analysisStore.js');
const { createApp } = await import('../src/app.js');

const server = await new Promise((r) => {
  const s = createApp().listen(0, '127.0.0.1', () => r(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;

test.after(() => {
  server.close();
  store.reset();
});

const call = async (method, path, body, headers = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed, text, headers: res.headers };
};

/** A report in the exact XRTestProfiler contract. */
function report(o = {}) {
  const n = o.samples ?? 8;
  return {
    schema: 'xr-test-profile-v1',
    projectName: o.projectName ?? 'Nebula Trainer',
    // The profiler ships these blank; a test must work without them.
    studentName: o.studentName ?? '',
    studentId: o.studentId ?? '',
    platform: o.platform ?? 'VR',
    capturedAt: o.capturedAt ?? '2026-08-12T10:15:30.000Z',
    durationSec: 30,
    targetFps: o.targetFps ?? 72,
    avgFps: o.avgFps ?? 71.4,
    minFps: 48,
    onePercentLowFps: 55,
    avgFrameMs: o.avgFrameMs ?? 14.01,
    droppedFrames: o.dropped ?? 9,
    totalFrames: o.total ?? 1440,
    memoryMB: o.memoryMB ?? 1180.4,
    drawCalls: -1,
    triangles: -1,
    batteryLevel: -1,
    batteryStatus: 'Unknown',
    device: 'Quest 3',
    gpu: 'Adreno 740',
    os: 'Android 14',
    series: Array.from({ length: n }, (_, i) => ({
      t: +(i * 0.5).toFixed(1), fps: 70, frameMs: 14.28, memMB: 900 + i,
    })),
  };
}

const newAnalysis = async (o) => {
  const res = await call('POST', '/api/analyze', report(o));
  assert.equal(res.status, 201, res.text);
  return res.body;
};

/* ------------------------------------------------------------------ mode -- */

test('hosted mode reports itself and uses no database', async () => {
  const { status, body } = await call('GET', '/api/health');
  assert.equal(status, 200);
  assert.equal(body.mode, 'hosted');
  assert.equal(body.database, 'not-used');
  assert.equal(body.vendor, 'Wizardlenz XR Studio');
  assert.ok(!('dbFile' in body), 'hosted mode must not advertise a database file');
});

test('every permanent-storage route is absent in hosted mode', async () => {
  const gone = [
    '/api/projects', '/api/students', '/api/sessions', '/api/bugs',
    '/api/dashboard/stats', '/api/data/summary', '/api/data/export',
    '/api/data/export.xlsx', '/api/migrate/status',
  ];
  for (const path of gone) {
    const { status } = await call('GET', path);
    assert.equal(status, 404, `${path} must not exist on the public service`);
  }
  // Nor may anything write to them.
  assert.equal((await call('POST', '/api/projects', { projectName: 'x' })).status, 404);
  assert.equal((await call('POST', '/api/reports/import', { files: [] })).status, 404);
});

/* ---------------------------------------------------------------- upload -- */

test('a profiler upload creates a temporary analysis and returns a report URL', async () => {
  const body = await newAnalysis();

  assert.match(body.token, /^[A-Za-z0-9_-]{32,}$/, 'token must be long and URL-safe');
  assert.equal(body.reportUrl, `${config.publicBaseUrl}/#/r/${body.token}`);
  assert.ok(body.reportUrl.startsWith('https://'), 'hosted report links must be HTTPS');
  assert.ok(body.expiresInSeconds > 0 && body.expiresInSeconds <= 3600);
  assert.match(body.retention, /deleted automatically/i);
  assert.match(body.privacy, /No project files/i);
  assert.equal(body.createdSession, true);
});

test('tokens are unguessable and unique per upload', async () => {
  const tokens = new Set();
  for (let i = 0; i < 8; i++) {
    tokens.add((await newAnalysis({ capturedAt: `2026-08-1${i}T10:00:00.000Z` })).token);
  }
  assert.equal(tokens.size, 8, 'every upload must get its own token');
  for (const t of tokens) assert.ok(t.length >= 32);
});

test('a report round-trips with metrics, series and no tester invented', async () => {
  const { token } = await newAnalysis();
  const { status, body } = await call('GET', `/api/analysis/${token}`);
  assert.equal(status, 200);

  const r = body.session.reports[0];
  assert.equal(r.projectName, 'Nebula Trainer');
  assert.equal(r.avgFps, 71.4);
  assert.equal(r.series.length, 8);
  assert.equal(r.captureStatus, 'valid');
  assert.equal(r.source, 'unity');
  // Blank tester metadata must stay blank, never become a placeholder person.
  assert.equal(r.testerName, null);
  // Diagnostics survive the trip but are clearly separate from scored metrics.
  assert.equal(r.minFps, 48);
  assert.equal(r.onePercentLowFps, 55);
  assert.equal(body.session.checklistItems.length, 8);
});

test('optional tester metadata is preserved when the profiler supplies it', async () => {
  const { token } = await newAnalysis({ studentName: 'Alex Rivera', studentId: 'QA-014' });
  const { body } = await call('GET', `/api/analysis/${token}`);
  assert.equal(body.session.reports[0].testerName, 'Alex Rivera');
});

test('a zero-frame capture is accepted and marked INVALID, never failed', async () => {
  const { token } = await newAnalysis({ total: 0, avgFps: 0, dropped: 0 });
  const { body } = await call('GET', `/api/analysis/${token}`);
  assert.equal(body.session.reports[0].captureStatus, 'invalid');
});

/* ------------------------------------------------------ payload rejection -- */

test('malformed, unsupported and incomplete payloads are each rejected', async () => {
  const cases = [
    [{ nope: true }, 400],
    [{ schema: 'xr-test-profile-v9', projectName: 'x' }, 400],
    [{ schema: 'xr-test-profile-v1' }, 400],
    [[], 400],
  ];
  for (const [payload, expected] of cases) {
    const { status, body } = await call('POST', '/api/analyze', payload);
    assert.equal(status, expected, JSON.stringify(payload));
    assert.ok(body.error.message.length > 10, 'rejections must be plain English');
  }

  const codes = await Promise.all([
    call('POST', '/api/analyze', { schema: 'xr-test-profile-v9', projectName: 'x' }),
    call('POST', '/api/analyze', { schema: 'xr-test-profile-v1' }),
  ]);
  assert.equal(codes[0].body.error.code, 'UNSUPPORTED_SCHEMA');
  assert.equal(codes[1].body.error.code, 'MISSING_REQUIRED_FIELD');
});

test('invalid JSON is rejected as JSON, not as a crash', async () => {
  const res = await fetch(`${BASE}/api/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{ this is not json',
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'INVALID_JSON');
});

test('an oversized payload is refused before it can be stored', async () => {
  const huge = report();
  huge.series = Array.from({ length: 40000 }, (_, i) => ({ t: i, fps: 72, frameMs: 13.8, memMB: 1000 }));
  const res = await fetch(`${BASE}/api/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(huge),
  });
  assert.equal(res.status, 413);
  assert.equal((await res.json()).error.code, 'TOO_LARGE');
});

/* -------------------------------------------------- multi-report sessions -- */

test('more reports can join one analysis, for comparison and trend', async () => {
  const { token } = await newAnalysis();
  const add = await call('POST', `/api/analysis/${token}/reports`, {
    report: report({ capturedAt: '2026-08-13T10:00:00.000Z', avgFps: 60 }),
    filename: 'run2.json',
  });
  assert.equal(add.status, 201);
  assert.equal(add.body.reportCount, 2);
  assert.equal(add.body.session.reports[1].source, 'browser');
  assert.equal(add.body.session.reports[1].filename, 'run2.json');
});

test('the same report twice resolves to the existing entry rather than duplicating', async () => {
  const first = await newAnalysis();
  const again = await call('POST', `/api/analyze?token=${first.token}`, report());
  assert.equal(again.status, 201);
  assert.equal(again.body.reportCount, 1, 'a duplicate must not add a second report');
  assert.equal(again.body.reportId, first.reportId);
});

test('an analysis cannot grow without bound', async () => {
  const { token } = await newAnalysis({ capturedAt: '2026-01-01T00:00:00.000Z' });
  for (let i = 1; i < config.session.maxReports; i++) {
    const res = await call('POST', `/api/analysis/${token}/reports`, {
      report: report({ capturedAt: `2026-01-0${i + 1}T00:00:00.000Z` }),
    });
    assert.equal(res.status, 201);
  }
  const overflow = await call('POST', `/api/analysis/${token}/reports`, {
    report: report({ capturedAt: '2026-02-02T00:00:00.000Z' }),
  });
  assert.equal(overflow.status, 409);
  assert.equal(overflow.body.error.code, 'SESSION_FULL');
});

/* --------------------------------------------------------------- scoring -- */

test('XR validation results attach to a report and drive its score', async () => {
  const { token } = await newAnalysis();
  const { body: before } = await call('GET', `/api/analysis/${token}`);
  const reportId = before.session.reports[0].id;

  const put = await call('PUT', `/api/analysis/${token}/reports/${reportId}/checklist/launch`, { result: 'pass' });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body.checklist, { launch: 'pass' });

  // Clearing works too.
  const cleared = await call('PUT', `/api/analysis/${token}/reports/${reportId}/checklist/launch`, { result: null });
  assert.deepEqual(cleared.body.checklist, {});

  assert.equal(
    (await call('PUT', `/api/analysis/${token}/reports/${reportId}/checklist/nope`, { result: 'pass' })).status,
    400,
  );
  assert.equal(
    (await call('PUT', `/api/analysis/${token}/reports/${reportId}/checklist/launch`, { result: 'maybe' })).status,
    400,
  );
});

test('checklist results are per report, not per analysis', async () => {
  const { token } = await newAnalysis();
  await call('POST', `/api/analysis/${token}/reports`, {
    report: report({ capturedAt: '2026-08-14T10:00:00.000Z' }),
  });
  const { body } = await call('GET', `/api/analysis/${token}`);
  const [a, b] = body.session.reports;

  await call('PUT', `/api/analysis/${token}/reports/${a.id}/checklist/launch`, { result: 'pass' });
  const { body: after } = await call('GET', `/api/analysis/${token}`);
  assert.deepEqual(after.session.reports[0].checklist, { launch: 'pass' });
  assert.deepEqual(after.session.reports[1].checklist, {}, `${b.id} must be unaffected`);
});

/* ------------------------------------------------------------- retention -- */

test('an expired analysis is gone, and says so in plain English', async () => {
  const { token } = await newAnalysis();
  const session = store.getSession(token);
  assert.ok(session, 'session should exist before expiry');

  // Absolute expiry: reach into the store rather than waiting an hour.
  session.expiresAt = Date.now() - 1;

  const { status, body } = await call('GET', `/api/analysis/${token}`);
  assert.equal(status, 410);
  assert.equal(body.error.code, 'SESSION_EXPIRED');
  assert.match(body.error.message, /deleted automatically/i);
  assert.equal(store.getSession(token), null, 'the expired session must be dropped');
});

test('the sweeper removes expired analyses without anyone asking', async () => {
  const { token } = await newAnalysis();
  store.getSession(token).expiresAt = Date.now() - 1;
  const removed = store.sweep();
  assert.ok(removed >= 1);
  assert.equal(store.getSession(token), null);
});

test('expiry is absolute — reading an analysis does not extend its life', async () => {
  const { token } = await newAnalysis();
  const first = store.getSession(token).expiresAt;
  await call('GET', `/api/analysis/${token}`);
  await call('GET', `/api/analysis/${token}`);
  assert.equal(store.getSession(token).expiresAt, first, 'TTL must not slide on access');
});

test('an analysis can be deleted on demand, immediately', async () => {
  const { token } = await newAnalysis();
  assert.equal((await call('DELETE', `/api/analysis/${token}`)).status, 200);
  assert.equal(store.getSession(token), null);
  assert.equal((await call('GET', `/api/analysis/${token}`)).status, 410);
  // Deleting twice is not a server error.
  assert.equal((await call('DELETE', `/api/analysis/${token}`)).status, 410);
});

test('an unknown token leaks nothing about whether it ever existed', async () => {
  const a = await call('GET', '/api/analysis/definitelyNotARealTokenAtAll');
  const { token } = await newAnalysis();
  await call('DELETE', `/api/analysis/${token}`);
  const b = await call('GET', `/api/analysis/${token}`);
  assert.equal(a.status, b.status);
  assert.equal(a.body.error.code, b.body.error.code);
});

/* ---------------------------------------------------------------- output -- */

test('the public flow exposes no raw-JSON or Excel export', async () => {
  const { token, reportId } = await newAnalysis({ capturedAt: '2026-07-07T00:00:00.000Z' });
  // PDF is the only user-facing export; these were removed in the UX pass and
  // must not reappear as an unadvertised endpoint.
  for (const path of [
    `/api/analysis/${token}/export.xlsx`,
    `/api/analysis/${token}/reports/${reportId}/raw`,
    `/api/analysis/${token}/reports/${reportId}/raw?download=true`,
  ]) {
    const { status } = await call('GET', path);
    assert.equal(status, 404, `${path} must not be exposed`);
  }
});

/* -------------------------------------------------------------- security -- */

test('security headers are present on every response', async () => {
  const { headers } = await call('GET', '/api/health');
  assert.match(headers.get('content-security-policy') ?? '', /default-src 'self'/);
  assert.match(headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.equal(headers.get('referrer-policy'), 'no-referrer');
  assert.match(headers.get('strict-transport-security') ?? '', /max-age=\d+/);
  assert.equal(headers.get('x-powered-by'), null);
});

test('report pages are marked no-index so temporary links never get crawled', async () => {
  const { token } = await newAnalysis();
  const { headers } = await call('GET', `/api/analysis/${token}`);
  assert.match(headers.get('x-robots-tag') ?? '', /noindex/);
});

test('CORS allows the configured origin and refuses everything else', async () => {
  const allowed = await call('GET', '/api/health', undefined, { Origin: 'https://allowed.example.com' });
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://allowed.example.com');
  assert.equal(allowed.headers.get('vary'), 'Origin');

  const evil = await call('GET', '/api/health', undefined, { Origin: 'https://evil.example.com' });
  assert.equal(evil.headers.get('access-control-allow-origin'), null,
    'a non-allowlisted origin must never receive CORS approval');

  // Preflight
  const okPreflight = await call('OPTIONS', '/api/analyze', undefined, {
    Origin: 'https://allowed.example.com',
    'Access-Control-Request-Method': 'POST',
  });
  assert.equal(okPreflight.status, 204);
  const badPreflight = await call('OPTIONS', '/api/analyze', undefined, {
    Origin: 'https://evil.example.com',
    'Access-Control-Request-Method': 'POST',
  });
  assert.equal(badPreflight.status, 403);
});

test('the Unity package (no Origin header) is unaffected by CORS', async () => {
  const { status } = await call('POST', '/api/analyze', report({ capturedAt: '2026-03-03T00:00:00.000Z' }));
  assert.equal(status, 201);
});

test('operational stats expose counts only, never a token or a report', async () => {
  await newAnalysis({ capturedAt: '2026-04-04T00:00:00.000Z' });
  const { status, body, text } = await call('GET', '/api/analysis-stats');
  assert.equal(status, 200);
  assert.equal(typeof body.sessions, 'number');
  assert.equal(typeof body.reports, 'number');
  assert.equal(body.ttlMinutes, 60);
  assert.ok(!/token|projectName|Nebula/i.test(text), 'stats must not leak session contents');
});
