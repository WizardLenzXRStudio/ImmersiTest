/**
 * End-to-end API tests against a throwaway SQLite database.
 *
 * A temp DB file + temp reports dir are used, so the suite can never touch
 * data/xr-test-lab.db. Everything runs over real HTTP through the real app.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'xrlab-test-'));
process.env.XRLAB_DB = join(tmp, 'test.db');

const { paths } = await import('../src/config.js');
// Redirect report storage at the temp dir before the DB (and its mkdir) runs.
paths.dataDir = tmp;
paths.reportsDir = join(tmp, 'reports');

const { initDb, closeDb, getDb } = await import('../src/db/index.js');
const { createApp } = await import('../src/app.js');

initDb();
const server = await new Promise((r) => {
  const s = createApp().listen(0, () => r(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;

test.after(() => {
  server.close();
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

const call = async (method, path, body) => {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

/** Builds a report in the exact XRTestProfiler contract. */
function report(o = {}) {
  const n = o.samples ?? 10;
  const series = Array.from({ length: n }, (_, i) => ({
    t: +(i * 0.5).toFixed(1), fps: 70, frameMs: 14.28, memMB: 900 + i,
  }));
  return JSON.stringify({
    schema: 'xr-test-profile-v1',
    projectName: o.projectName ?? 'Anatomy VR Explorer',
    studentName: o.studentName ?? 'Priya Kannan',
    studentId: o.studentId ?? '21BCE1042',
    platform: o.platform ?? 'VR',
    capturedAt: o.capturedAt ?? '2026-08-01T10:15:30.1234567+05:30',
    durationSec: 30.0, targetFps: o.targetFps ?? 72,
    avgFps: o.avgFps ?? 71.4, minFps: 48, onePercentLowFps: o.low ?? 55,
    avgFrameMs: 14.01, droppedFrames: o.dropped ?? 9, totalFrames: o.total ?? 1440,
    memoryMB: 1180.4, drawCalls: -1, triangles: -1, batteryLevel: -1.0,
    batteryStatus: 'Unknown', device: 'Quest 3', gpu: 'Adreno 740', os: 'Android 14',
    series: o.series !== undefined ? o.series : series,
  });
}

/* --------------------------------------------------------------- basics -- */

test('health reports ok with a live database', async () => {
  const { status, body } = await call('GET', '/api/health');
  assert.equal(status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.database, 'ok');
});

test('unknown api route returns JSON 404', async () => {
  const { status, body } = await call('GET', '/api/nope');
  assert.equal(status, 404);
  assert.equal(body.error.code, 'NOT_FOUND');
});

test('checklist exposes exactly the original eight items', async () => {
  const { body } = await call('GET', '/api/checklist-items');
  assert.equal(body.items.length, 8);
  assert.deepEqual(
    body.items.map((i) => i.id),
    ['launch', 'fps', 'track', 'interact', 'comfort', 'ui', 'audio', 'exit'],
  );
});

/* ----------------------------------------------------------------- CRUD -- */

test('project CRUD round-trips and validates input', async () => {
  const bad = await call('POST', '/api/projects', { projectName: '', platform: 'VR', targetFps: 72 });
  assert.equal(bad.status, 400);

  const badPlatform = await call('POST', '/api/projects', { projectName: 'X', platform: 'XR', targetFps: 72 });
  assert.equal(badPlatform.status, 400);

  const made = await call('POST', '/api/projects', { projectName: 'CRUD Project', platform: 'AR', targetFps: 60 });
  assert.equal(made.status, 201);
  const id = made.body.project.id;

  const patched = await call('PATCH', `/api/projects/${id}`, { projectName: 'CRUD Renamed' });
  assert.equal(patched.body.project.projectName, 'CRUD Renamed');
  // Renaming must move the normalized key or the next import creates a twin.
  assert.equal(getDb().prepare('SELECT normalizedName n FROM projects WHERE id=?').get(id).n, 'crud renamed');

  const dupe = await call('POST', '/api/projects', { projectName: 'crud   RENAMED', platform: 'AR', targetFps: 60 });
  assert.equal(dupe.status, 409, 'normalized name must be unique');

  await call('DELETE', `/api/projects/${id}`);
});

test('student CRUD allows many code-less students', async () => {
  const a = await call('POST', '/api/students', { studentName: 'No Code A' });
  const b = await call('POST', '/api/students', { studentName: 'No Code B' });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201, 'blank studentId must not collide');

  const dup = await call('POST', '/api/students', { studentName: 'X', studentId: '21BCE1042' });
  await call('POST', '/api/students', { studentName: 'Y', studentId: 'DUPCODE' });
  const dup2 = await call('POST', '/api/students', { studentName: 'Z', studentId: 'DUPCODE' });
  assert.equal(dup2.status, 409, 'duplicate studentId must be rejected');
  assert.ok([201, 409].includes(dup.status));
});

/* --------------------------------------------------------------- import -- */

test('import stores the session, samples and the original file', async () => {
  const content = report();
  const { status, body } = await call('POST', '/api/reports/import', {
    files: [{ filename: 'xrtest_a.json', content }],
  });
  assert.equal(status, 201);
  assert.equal(body.summary.imported, 1);

  const r = body.results[0];
  const ses = (await call('GET', `/api/sessions/${r.sessionId}`)).body.session;
  assert.equal(ses.avgFps, 71.4);
  assert.equal(ses.series.length, 10);
  assert.equal(ses.captureStatus, 'valid');
  // All four scored metrics PASS = 60/60; 0/40 checklist on a fresh import.
  assert.equal(ses.gradeScore, 60);
  assert.equal(ses.gradeLetter, 'D');

  // The unscored metrics are still imported and stored.
  assert.equal(ses.minFps, 48);
  assert.equal(ses.onePercentLowFps, 55);

  // The original document is retained verbatim and served back byte-identical.
  const raw = await fetch(`${BASE}/api/sessions/${r.sessionId}/raw`);
  assert.equal(await raw.text(), content);

  const file = getDb().prepare('SELECT reportFile f FROM test_sessions WHERE id=?').get(r.sessionId).f;
  assert.ok(existsSync(resolve(paths.reportsDir, file)), 'original JSON must exist on disk');
});

test('re-importing identical bytes is rejected as a duplicate', async () => {
  const content = report({ capturedAt: '2026-08-09T10:00:00.0000000+05:30' });
  const first = await call('POST', '/api/reports/import', { files: [{ filename: 'd.json', content }] });
  assert.equal(first.body.summary.imported, 1);

  const second = await call('POST', '/api/reports/import', { files: [{ filename: 'd.json', content }] });
  assert.equal(second.body.summary.duplicate, 1);
  assert.equal(second.body.summary.imported, 0);
});

test('preview detects duplicates within a single batch', async () => {
  const content = report({ capturedAt: '2026-08-11T10:00:00.0000000+05:30' });
  const { body } = await call('POST', '/api/reports/preview', {
    files: [
      { filename: 'a.json', content },
      { filename: 'b.json', content },
    ],
  });
  assert.equal(body.summary.valid, 1);
  assert.equal(body.summary.duplicate, 1);
});

test('invalid JSON, wrong schema and missing fields are rejected individually', async () => {
  const { body } = await call('POST', '/api/reports/import', {
    files: [
      { filename: 'bad.json', content: '{ not json' },
      { filename: 'future.json', content: '{"schema":"xr-test-profile-v9","projectName":"F"}' },
      { filename: 'missing.json', content: '{"schema":"xr-test-profile-v1"}' },
      { filename: 'good.json', content: report({ capturedAt: '2026-08-12T10:00:00.0000000+05:30' }) },
    ],
  });
  assert.equal(body.summary.invalid, 3);
  assert.equal(body.summary.imported, 1, 'one bad file must not block the batch');
  assert.equal(body.results[0].errorCode, 'INVALID_JSON');
  assert.equal(body.results[1].errorCode, 'UNSUPPORTED_SCHEMA');
  assert.equal(body.results[2].errorCode, 'MISSING_REQUIRED_FIELD');
});

test('zero-frame capture is stored as INVALID and never graded', async () => {
  const { body } = await call('POST', '/api/reports/import', {
    files: [{
      filename: 'zero.json',
      content: report({
        projectName: 'Zero Frame App', capturedAt: '2026-08-13T10:00:00.0000000+05:30',
        avgFps: 0, low: 0, dropped: 0, total: 0, series: [],
      }),
    }],
  });
  const ses = (await call('GET', `/api/sessions/${body.results[0].sessionId}`)).body.session;
  assert.equal(ses.captureStatus, 'invalid');
  assert.equal(ses.gradeLetter, null);
  assert.equal(ses.gradeScore, null);
  assert.equal(ses.performanceStatus, 'neutral');
});

test('malformed series points are dropped but the session survives', async () => {
  const { body } = await call('POST', '/api/reports/import', {
    files: [{
      filename: 'badseries.json',
      content: report({
        projectName: 'Bad Series App', capturedAt: '2026-08-14T10:00:00.0000000+05:30',
        series: [{ t: 0, fps: 70, frameMs: 14, memMB: 900 }, 'garbage', { nope: true }, { t: 0.5, fps: 71, frameMs: 14, memMB: 901 }],
      }),
    }],
  });
  assert.equal(body.results[0].status, 'imported');
  assert.match(body.results[0].warnings.join(' '), /Dropped 2 malformed/);
  const ses = (await call('GET', `/api/sessions/${body.results[0].sessionId}`)).body.session;
  assert.equal(ses.series.length, 2);
});

test('missing optional fields still import (sentinels become null)', async () => {
  const minimal = JSON.stringify({
    schema: 'xr-test-profile-v1', projectName: 'Minimal App', studentName: 'Min Student',
    studentId: '', platform: 'VR', capturedAt: '2026-08-15T10:00:00.0000000+05:30',
    targetFps: 72, avgFps: 70, droppedFrames: 5, totalFrames: 1000,
    drawCalls: -1, triangles: -1, batteryLevel: -1,
  });
  const { body } = await call('POST', '/api/reports/import', { files: [{ filename: 'min.json', content: minimal }] });
  assert.equal(body.summary.imported, 1);
  const ses = (await call('GET', `/api/sessions/${body.results[0].sessionId}`)).body.session;
  assert.equal(ses.drawCalls, null);
  assert.equal(ses.triangles, null);
  assert.equal(ses.batteryLevel, null);
  assert.equal(ses.series.length, 0);
});

/* ------------------------------------------------------ history + grading */

test('multiple imports build history without overwriting', async () => {
  const p = 'History App';
  for (const [i, day] of ['16', '17', '18'].entries()) {
    await call('POST', '/api/reports/import', {
      files: [{
        filename: `h${i}.json`,
        content: report({ projectName: p, studentName: 'Hist Student', studentId: 'HIST1', capturedAt: `2026-08-${day}T10:00:00.0000000+05:30` }),
      }],
    });
  }
  const project = (await call('GET', '/api/projects')).body.projects.find((x) => x.projectName === p);
  const detail = (await call('GET', `/api/projects/${project.id}`)).body.project;
  assert.equal(detail.sessions.length, 3);
  assert.deepEqual(
    detail.sessions.map((s) => s.capturedAt.slice(0, 10)),
    ['2026-08-16', '2026-08-17', '2026-08-18'],
  );
});

test('score is performance (60) + checklist (40), applied end to end', async () => {
  const { body } = await call('POST', '/api/reports/import', {
    files: [{ filename: 'g.json', content: report({ projectName: 'Grade App', studentName: 'Grade Student', studentId: 'GR1', capturedAt: '2026-08-19T10:00:00.0000000+05:30' }) }],
  });
  const id = body.results[0].sessionId;

  // Fixture judgements: avgFps PASS, bad frames PASS, frame time PASS,
  // memory PASS  ->  15 + 15 + 15 + 15 = 60. (1% low is NOT scored.)
  let ses = (await call('GET', `/api/sessions/${id}`)).body.session;
  assert.equal(ses.gradeScore, 60, 'no checklist assessed yet, so checklist contributes 0');
  assert.equal(ses.gradeLetter, 'D');
  assert.equal(ses.performanceStatus, 'warn', 'status follows the score band');

  // Each Pass is worth 5.
  await call('PUT', `/api/sessions/${id}/checklist/launch`, { result: 'pass' });
  ses = (await call('GET', `/api/sessions/${id}`)).body.session;
  assert.equal(ses.gradeScore, 65);
  assert.equal(ses.gradeLetter, 'D');

  // Warn is worth 3, Fail 0.
  await call('PUT', `/api/sessions/${id}/checklist/fps`, { result: 'warn' });
  ses = (await call('GET', `/api/sessions/${id}`)).body.session;
  assert.equal(ses.gradeScore, 68);

  await call('PUT', `/api/sessions/${id}/checklist/track`, { result: 'fail' });
  ses = (await call('GET', `/api/sessions/${id}`)).body.session;
  assert.equal(ses.gradeScore, 68, 'a failed checklist item adds 0 and subtracts nothing');

  // Clearing an item removes only its own marks.
  await call('PUT', `/api/sessions/${id}/checklist/launch`, { result: null });
  ses = (await call('GET', `/api/sessions/${id}`)).body.session;
  assert.equal(ses.gradeScore, 63);
});

test('18. a legacy report carrying minFps and onePercentLowFps still imports', async () => {
  // Exactly the shape XRTestProfiler.cs writes — both fields present.
  const content = report({
    projectName: 'Legacy Fields App', studentName: 'LF', studentId: 'LF1',
    capturedAt: '2026-08-25T10:00:00.0000000+05:30',
    avgFps: 71.4, low: 7, // a catastrophic 1% low that must NOT drag the score down
  });
  assert.ok(content.includes('"minFps"'), 'fixture must carry minFps');
  assert.ok(content.includes('"onePercentLowFps"'), 'fixture must carry onePercentLowFps');

  const { status, body } = await call('POST', '/api/reports/import', {
    files: [{ filename: 'legacy-fields.json', content }],
  });
  assert.equal(status, 201);
  assert.equal(body.summary.imported, 1);

  const ses = (await call('GET', `/api/sessions/${body.results[0].sessionId}`)).body.session;
  assert.equal(ses.minFps, 48, 'minFps still stored');
  assert.equal(ses.onePercentLowFps, 7, 'onePercentLowFps still stored');
  // A 7 FPS 1% low no longer costs marks: all four scored metrics still PASS.
  assert.equal(ses.gradeScore, 60);
  assert.equal(ses.gradeLetter, 'D');

  // And the original document is returned byte-identical.
  const raw = await fetch(`${BASE}/api/sessions/${body.results[0].sessionId}/raw`);
  assert.equal(await raw.text(), content);
});

test('defects never change the numeric score', async () => {
  const { body } = await call('POST', '/api/reports/import', {
    files: [{ filename: 'nb.json', content: report({ projectName: 'No Bug Penalty App', studentName: 'NB', studentId: 'NB1', capturedAt: '2026-08-22T10:00:00.0000000+05:30' }) }],
  });
  const id = body.results[0].sessionId;
  const before = (await call('GET', `/api/sessions/${id}`)).body.session;

  const bug = (await call('POST', '/api/bugs', {
    projectId: before.projectId, sessionId: id, title: 'critical defect', severity: 'critical',
  })).body.bug;
  await call('POST', '/api/bugs', { projectId: before.projectId, title: 'another critical', severity: 'critical' });
  await call('POST', '/api/bugs', { projectId: before.projectId, title: 'high one', severity: 'high' });

  let after = (await call('GET', `/api/sessions/${id}`)).body.session;
  assert.equal(after.gradeScore, before.gradeScore, 'two critical defects must not reduce the score');
  assert.equal(after.gradeLetter, before.gradeLetter);

  // Resolving, closing or deleting them must not change it either.
  await call('PATCH', `/api/bugs/${bug.id}`, { status: 'closed' });
  after = (await call('GET', `/api/sessions/${id}`)).body.session;
  assert.equal(after.gradeScore, before.gradeScore);

  await call('DELETE', `/api/bugs/${bug.id}`);
  after = (await call('GET', `/api/sessions/${id}`)).body.session;
  assert.equal(after.gradeScore, before.gradeScore);

  // The defects themselves are still tracked.
  assert.equal((await call('GET', `/api/bugs?projectId=${before.projectId}`)).body.bugs.length, 2);
});

test('checklist results are per-session, not per-project', async () => {
  const project = (await call('GET', '/api/projects')).body.projects.find((x) => x.projectName === 'History App');
  const detail = (await call('GET', `/api/projects/${project.id}`)).body.project;
  const [first, second] = detail.sessions;

  await call('PUT', `/api/sessions/${first.id}/checklist/fps`, { result: 'fail' });
  const s1 = (await call('GET', `/api/sessions/${first.id}`)).body.session;
  const s2 = (await call('GET', `/api/sessions/${second.id}`)).body.session;
  assert.equal(s1.checklist.fps, 'fail');
  assert.equal(s2.checklist.fps, undefined, 'Test 2 must have an independent checklist');
});

/* ------------------------------------------------------------- deletion -- */

test('deleting a session removes its rows AND its report file', async () => {
  const { body } = await call('POST', '/api/reports/import', {
    files: [{ filename: 'del.json', content: report({ projectName: 'Delete App', studentName: 'Del Student', studentId: 'DEL1', capturedAt: '2026-08-20T10:00:00.0000000+05:30' }) }],
  });
  const id = body.results[0].sessionId;
  await call('PUT', `/api/sessions/${id}/checklist/ui`, { result: 'pass' });

  const db = getDb();
  const file = db.prepare('SELECT reportFile f FROM test_sessions WHERE id=?').get(id).f;
  const full = resolve(paths.reportsDir, file);
  assert.ok(existsSync(full));

  const res = await call('DELETE', `/api/sessions/${id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.fileRemoved, true);

  assert.equal((await call('GET', `/api/sessions/${id}`)).status, 404);
  assert.ok(!existsSync(full), 'original report file must be gone');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM performance_samples WHERE sessionId=?').get(id).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM checklist_results WHERE sessionId=?').get(id).n, 0);
});

test('archive keeps history; permanent delete removes rows and files', async () => {
  const project = (await call('GET', '/api/projects')).body.projects.find((x) => x.projectName === 'History App');

  await call('DELETE', `/api/projects/${project.id}`); // archive (default)
  const active = (await call('GET', '/api/projects')).body.projects.map((p) => p.projectName);
  assert.ok(!active.includes('History App'), 'archived project is hidden from the active list');
  const withArchived = (await call('GET', '/api/projects?includeArchived=true')).body.projects;
  assert.equal(withArchived.find((p) => p.id === project.id).status, 'archived');

  const detail = (await call('GET', `/api/projects/${project.id}`)).body.project;
  assert.equal(detail.sessions.length, 3, 'archived project keeps its history');

  const impact = (await call('GET', `/api/projects/${project.id}/deletion-impact`)).body.impact;
  assert.equal(impact.sessions, 3);

  const files = getDb()
    .prepare('SELECT reportFile f FROM test_sessions WHERE projectId=?')
    .all(project.id)
    .map((r) => resolve(paths.reportsDir, r.f));

  const del = await call('DELETE', `/api/projects/${project.id}?permanent=true`);
  assert.equal(del.body.deleted, 'permanent');
  assert.equal(del.body.filesRemoved, 3);
  assert.equal((await call('GET', `/api/projects/${project.id}`)).status, 404);
  for (const f of files) assert.ok(!existsSync(f), 'report files must be removed');
});

test('no orphan rows or files remain after all deletions', async () => {
  const db = getDb();
  const orphan = (sql) => db.prepare(sql).get().n;
  assert.equal(orphan('SELECT COUNT(*) n FROM performance_samples WHERE sessionId NOT IN (SELECT id FROM test_sessions)'), 0);
  assert.equal(orphan('SELECT COUNT(*) n FROM checklist_results WHERE sessionId NOT IN (SELECT id FROM test_sessions)'), 0);
  assert.equal(orphan('SELECT COUNT(*) n FROM bugs WHERE projectId NOT IN (SELECT id FROM projects)'), 0);
  assert.equal(orphan('SELECT COUNT(*) n FROM test_sessions WHERE projectId NOT IN (SELECT id FROM projects)'), 0);

  const known = new Set(db.prepare('SELECT reportFile f FROM test_sessions WHERE reportFile IS NOT NULL').all().map((r) => r.f));
  const onDisk = readdirSync(paths.reportsDir).filter((f) => f.endsWith('.json'));
  assert.deepEqual(onDisk.filter((f) => !known.has(f)), [], 'no orphaned report files');
  assert.deepEqual([...known].filter((f) => !onDisk.includes(f)), [], 'no missing report files');
});

/* ------------------------------------------------------------ migration -- */

test('localStorage payload migrates into SQLite', async () => {
  const legacy = {
    projects: [{
      projectName: 'Legacy App', studentName: 'Legacy Student', studentId: 'LEG1',
      platform: 'VR', targetFps: 72,
      checklist: { launch: 'pass', fps: 'fail' },
      // The legacy dashboard's vocabulary — must be mapped, not written as-is.
      bugs: [
        { sev: 'critical', text: 'legacy crit' },
        { sev: 'major', text: 'legacy major' },
        { sev: 'minor', text: 'legacy minor' },
        { sev: 'nonsense', text: 'legacy unknown severity' },
      ],
      sessions: [
        { capturedAt: '2026-07-01T10:00:00.000Z', targetFps: 72, avgFps: 66.2, minFps: 41, onePercentLowFps: 52, avgFrameMs: 15.1, droppedFrames: 30, totalFrames: 1500, memoryMB: 1200, series: [{ t: 0, fps: 66, frameMs: 15.1, memMB: 1100 }] },
        { capturedAt: '2026-07-08T10:00:00.000Z', targetFps: 72, avgFps: 70.5, minFps: 55, onePercentLowFps: 61, avgFrameMs: 14.2, droppedFrames: 11, totalFrames: 1500, memoryMB: 1150, series: [] },
      ],
    }],
  };
  const { status, body } = await call('POST', '/api/migrate/localstorage', legacy);
  assert.equal(status, 201);
  assert.equal(body.migrated.projects, 1);
  assert.equal(body.migrated.sessions, 2);
  assert.equal(body.migrated.bugs, 4);

  const project = (await call('GET', '/api/projects')).body.projects.find((p) => p.projectName === 'Legacy App');
  const detail = (await call('GET', `/api/projects/${project.id}`)).body.project;
  assert.equal(detail.sessions.length, 2, 'both legacy sessions preserved');
  assert.equal(detail.bugs.length, 4);

  // Legacy severities must land on the current vocabulary.
  const sevOf = (t) => detail.bugs.find((b) => b.title === t)?.severity;
  assert.equal(sevOf('legacy crit'), 'critical');
  assert.equal(sevOf('legacy major'), 'high');
  assert.equal(sevOf('legacy minor'), 'medium');
  assert.equal(sevOf('legacy unknown severity'), 'medium');

  // The legacy per-project checklist lands on the latest session.
  const latest = detail.sessions[detail.sessions.length - 1];
  const ses = (await call('GET', `/api/sessions/${latest.id}`)).body.session;
  assert.equal(ses.checklist.launch, 'pass');
  assert.equal(ses.checklist.fps, 'fail');
  assert.equal(ses.schemaVersion, 'legacy-localstorage-v1');
});

/* --------------------------------------------------------------- defects -- */

test('defect vocabulary is Critical/High/Medium/Low and Open..Closed', async () => {
  const p = (await call('POST', '/api/projects', { projectName: 'Defect Vocab App', platform: 'VR', targetFps: 72 }))
    .body.project;

  for (const severity of ['critical', 'high', 'medium', 'low']) {
    const r = await call('POST', '/api/bugs', { projectId: p.id, title: `bug ${severity}`, severity });
    assert.equal(r.status, 201, `${severity} must be accepted`);
  }
  const rejected = await call('POST', '/api/bugs', { projectId: p.id, title: 'x', severity: 'major' });
  assert.equal(rejected.status, 400, 'the retired "major" severity must be rejected');

  const bugs = (await call('GET', `/api/bugs?projectId=${p.id}`)).body.bugs;
  assert.equal(bugs.length, 4);

  for (const status of ['open', 'in_progress', 'resolved', 'closed']) {
    const r = await call('PATCH', `/api/bugs/${bugs[0].id}`, { status });
    assert.equal(r.status, 200, `${status} must be accepted`);
  }
  const badStatus = await call('PATCH', `/api/bugs/${bugs[0].id}`, { status: 'wont_fix' });
  assert.equal(badStatus.status, 400, 'the retired "wont_fix" status must be rejected');
});

test('a single defect can be fetched without listing them all', async () => {
  const bugs = (await call('GET', '/api/bugs')).body.bugs;
  const one = await call('GET', `/api/bugs/${bugs[0].id}`);
  assert.equal(one.status, 200);
  assert.equal(one.body.bug.id, bugs[0].id);
  assert.equal((await call('GET', '/api/bugs/does-not-exist')).status, 404);
});

test('defects can be searched, filtered and sorted', async () => {
  const bySeverity = (await call('GET', '/api/bugs?severity=critical')).body.bugs;
  assert.ok(bySeverity.every((b) => b.severity === 'critical'));

  const search = (await call('GET', '/api/bugs?q=bug%20low')).body.bugs;
  assert.ok(search.length >= 1);
  assert.ok(search.every((b) => /bug low/i.test(b.title)));

  const sorted = (await call('GET', '/api/bugs?sort=severity')).body.bugs;
  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(rank[sorted[i - 1].severity] <= rank[sorted[i].severity], 'critical defects must sort first');
  }
});

/* --------------------------------------------------------- import reasons -- */

test('every rejection carries a plain-English reason', async () => {
  const { body } = await call('POST', '/api/reports/preview', {
    files: [
      { filename: 'bad.json', content: '{ not json' },
      { filename: 'future.json', content: '{"schema":"xr-test-profile-v9","projectName":"F"}' },
      { filename: 'missing.json', content: '{"schema":"xr-test-profile-v1"}' },
    ],
  });
  for (const r of body.results) {
    assert.equal(r.status, 'invalid');
    assert.ok(r.reason && r.reason.length > 20, `${r.errorCode} needs a human explanation`);
    assert.ok(!/undefined|\[object/.test(r.reason));
  }
  assert.equal(body.results[2].errorCode, 'MISSING_REQUIRED_FIELD');
});

/* ------------------------------------------------------- data management -- */

test('data summary reports locations, counts and storage size', async () => {
  const { status, body } = await call('GET', '/api/data/summary');
  assert.equal(status, 200);
  assert.ok(body.location.database.endsWith('.db'));
  assert.ok(body.counts.sessions > 0);
  assert.ok(body.storage.totalBytes > 0);
  assert.equal(typeof body.schemaVersion, 'string');
  // Must not leak internals.
  assert.ok(!JSON.stringify(body).includes('CREATE TABLE'));
});

test('export bundle contains everything needed to rebuild the archive', async () => {
  const res = await fetch(`${BASE}/api/data/export`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename="xr-test-lab-backup-/);

  const bundle = JSON.parse(await res.text());
  assert.equal(bundle.format, 'xr-test-lab-export-v1');
  assert.ok(bundle.projects.length > 0);
  assert.ok(bundle.sessions.length > 0);

  // Pick a genuine profiler capture — the bundle also contains legacy-migrated
  // sessions whose rawReport is the old localStorage object, not a report.
  const profilerSession = bundle.sessions.find(
    (s) => s.schemaVersion === 'xr-test-profile-v1' && s.samples.length,
  );
  assert.ok(profilerSession, 'exported sessions must carry their performance samples');
  assert.equal(profilerSession.rawReport.schema, 'xr-test-profile-v1', 'original report is embedded');
  assert.equal(bundle.checklistItems.length, 8);
});

/* ---------------------------------------------------------- excel export -- */

const headersOf = (sheet) => sheet.getRow(1).values.slice(1).map(String);

async function loadWorkbook() {
  const res = await fetch(`${BASE}/api/data/export.xlsx`);
  assert.equal(res.status, 200);
  const buf = Buffer.from(await res.arrayBuffer());
  // A real xlsx is a ZIP: check the magic bytes before parsing.
  assert.equal(buf.subarray(0, 2).toString('latin1'), 'PK', 'output must be a valid zip container');
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return { wb, res };
}

test('Excel export is a single worksheet with the specified columns', async () => {
  const { wb, res } = await loadWorkbook();

  assert.match(res.headers.get('content-type') ?? '', /spreadsheetml\.sheet/);
  assert.match(
    res.headers.get('content-disposition') ?? '',
    /attachment; filename="XR_Test_Lab_Overall_Report_/,
  );

  assert.equal(wb.worksheets.length, 1, 'exactly one worksheet');
  const sheet = wb.worksheets[0];
  assert.equal(sheet.name, 'ImmersiTest - Overall Report');

  assert.deepEqual(headersOf(sheet), [
    'Application Name', 'Application Platform', 'Target FPS', 'Application Status',
    'Total Test Sessions',
    'Tester Name', 'Tester Email',
    'Session Number', 'Test Date', 'Test Duration (s)', 'Device', 'GPU', 'OS', 'Platform',
    'Average FPS', 'Bad Frames %', 'Average Frame Time (ms)', 'Memory (MB)',
    'Draw Calls', 'Triangles', 'Battery Level', 'Battery Status',
    'Minimum FPS (diagnostic)', '1% Low FPS (diagnostic)',
    'Application Stability', 'Performance Stability', 'Tracking & Input',
    'Core Interaction', 'Comfort & Motion', 'UI Readability',
    'Spatial Audio', 'Exit / Reset',
    'XR Validation Score / 40',
    'Performance Score / 60', 'Final Score / 100', 'Grade', 'Overall Status',
    'Total Defects', 'Critical Defects', 'High Defects', 'Medium Defects', 'Low Defects',
    'Open Defects', 'Resolved Defects',
  ]);

  // Terminology must stay product-general: no student/university framing.
  for (const h of headersOf(sheet)) {
    assert.ok(!/student|university|college|marks/i.test(h), `"${h}" must use general terminology`);
  }

  // Usability: frozen header, filters on, no internal identifiers.
  assert.deepEqual(sheet.views?.[0], { state: 'frozen', ySplit: 1, ...sheet.views[0] });
  assert.equal(sheet.views[0].state, 'frozen');
  assert.equal(sheet.views[0].ySplit, 1);
  assert.ok(sheet.autoFilter, 'header row must be filterable');
  assert.equal(sheet.getRow(1).font.bold, true);
  assert.ok(headersOf(sheet).every((h) => !/\bid\b/i.test(h) || h === 'Tester ID'));
});

test('Excel export has one row per test session, numbered within its project', async () => {
  const { wb } = await loadWorkbook();
  const sheet = wb.worksheets[0];
  const head = headersOf(sheet);
  const col = (name) => head.indexOf(name) + 1;

  const dbSessions = (await call('GET', '/api/sessions')).body.sessions;
  assert.equal(sheet.rowCount - 1, dbSessions.length, 'one row per session, plus the header');
  assert.ok(dbSessions.length > 1, 'fixture should exercise several sessions');

  const rows = [];
  sheet.eachRow((row, i) => { if (i > 1) rows.push(row); });

  // Session Number must run 1..N within each project, and Total Sessions for
  // Project must equal that project's real session count on every row.
  const byProject = new Map();
  for (const row of rows) {
    const name = String(row.getCell(col('Application Name')).value);
    if (!byProject.has(name)) byProject.set(name, []);
    byProject.get(name).push(row);
  }
  for (const [name, projRows] of byProject) {
    const numbers = projRows.map((r) => r.getCell(col('Session Number')).value);
    assert.deepEqual(
      numbers,
      projRows.map((_, i) => i + 1),
      `${name} sessions must be numbered 1..N`,
    );
    for (const r of projRows) {
      assert.equal(
        r.getCell(col('Total Test Sessions')).value,
        projRows.length,
        `${name} must report its full session count on every row`,
      );
    }
  }

  // Multiple sessions for one project appear as separate rows.
  assert.ok([...byProject.values()].some((r) => r.length > 1), 'repeat testing must produce repeat rows');
});

test('Excel rows carry scores, checklist results and defect counts', async () => {
  const { wb } = await loadWorkbook();
  const sheet = wb.worksheets[0];
  const head = headersOf(sheet);
  const col = (name) => head.indexOf(name) + 1;
  const CHECK_VALUES = new Set(['PASS', 'WARN', 'FAIL', 'NOT ASSESSED']);

  const rows = [];
  sheet.eachRow((row, i) => { if (i > 1) rows.push(row); });

  for (const row of rows) {
    const status = String(row.getCell(col('Overall Status')).value);
    const final = row.getCell(col('Final Score / 100')).value;
    const perf = row.getCell(col('Performance Score / 60')).value;
    const check = row.getCell(col('XR Validation Score / 40')).value;

    if (status === 'INVALID CAPTURE') {
      assert.equal(final, 'N/A', 'an invalid capture must never export a numeric score');
      assert.equal(perf, 'N/A');
      assert.equal(row.getCell(col('Average FPS')).value, 'N/A');
      assert.equal(row.getCell(col('Grade')).value, 'N/A');
    } else {
      assert.equal(typeof final, 'number');
      assert.equal(typeof perf, 'number');
      assert.ok(final >= 0 && final <= 100);
      assert.ok(perf >= 0 && perf <= 60);
      assert.ok(check >= 0 && check <= 40);
      assert.equal(perf + check, final, 'performance + checklist must equal the final score');
    }

    // All eight checklist columns carry a readable verdict.
    for (const h of ['Application Stability', 'Performance Stability', 'Tracking & Input',
      'Core Interaction', 'Comfort & Motion', 'UI Readability',
      'Spatial Audio', 'Exit / Reset']) {
      assert.ok(CHECK_VALUES.has(String(row.getCell(col(h)).value)), `${h} must be PASS/WARN/FAIL/NOT ASSESSED`);
    }

    // Defect counts are whole numbers and internally consistent.
    const total = row.getCell(col('Total Defects')).value;
    const bySeverity = ['Critical Defects', 'High Defects', 'Medium Defects', 'Low Defects']
      .reduce((a, h) => a + row.getCell(col(h)).value, 0);
    assert.equal(bySeverity, total, 'severity counts must sum to the total');
    assert.ok(row.getCell(col('Open Defects')).value <= total);
    assert.ok(row.getCell(col('Resolved Defects')).value <= total);

    // Test Date must be a real date, not text.
    assert.ok(row.getCell(col('Test Date')).value instanceof Date);
  }
});

/* ---------------------------------------------------------------- stats -- */

test('dashboard stats aggregate correctly', async () => {
  const { body } = await call('GET', '/api/dashboard/stats');
  assert.ok(body.totals.projects > 0);
  assert.ok(body.totals.sessions > 0);
  assert.equal(typeof body.distributionPct.pass, 'number');
  assert.ok(Array.isArray(body.recentSessions));
  const sum = body.distributionPct.pass + body.distributionPct.warn + body.distributionPct.fail;
  assert.ok(sum === 0 || Math.abs(sum - 100) <= 2, 'percentages should total ~100');
});
