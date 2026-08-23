/**
 * XR Health, Fix First, XR Doctor, recommendations, area breakdown and
 * comparison — the interpretation layer.
 *
 * These are the parts of the product that make claims about an application, so
 * the tests care as much about what they REFUSE to say (no invented causes, no
 * assessment without evidence) as about what they report.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  xrHealth, xrDoctor, fixFirst, recommendations, areaBreakdown,
  compareReports, computeGrade, badFramePct, memoryCap,
  CHECKLIST, EVALUATION_AREAS, GRADE_CONFIG, HEALTH_LABEL, SCORE_LABEL,
} from '../../shared/xr-metrics/index.js';

/** Every scored metric PASS at a 72 Hz target. */
const healthy = (o = {}) => ({
  targetFps: 72, platform: 'VR',
  avgFps: 72, droppedFrames: 0, totalFrames: 1440,
  avgFrameMs: 13.0, memoryMB: 1000,
  minFps: 40, onePercentLowFps: 70,
  ...o,
});

/** Every scored metric FAIL. */
const unhealthy = (o = {}) => ({
  targetFps: 72, platform: 'VR',
  avgFps: 10, droppedFrames: 1440, totalFrames: 1440,
  avgFrameMs: 100, memoryMB: 3000,
  minFps: 1, onePercentLowFps: 1,
  ...o,
});

const allChecks = (result) => Object.fromEntries(CHECKLIST.map((c) => [c.id, result]));

/* --------------------------------------------------------- general model -- */

test('the evaluation model contains no student or academic framing', () => {
  const text = JSON.stringify({ CHECKLIST, EVALUATION_AREAS, SCORE_LABEL });
  for (const word of ['student', 'university', 'college', 'project guide', 'marks out of', 'academic']) {
    assert.ok(!new RegExp(word, 'i').test(text), `"${word}" must not appear in the evaluation model`);
  }
  assert.equal(SCORE_LABEL, 'ImmersiTest Quality Score');
});

test('the eight validation items keep their stored ids but read generally', () => {
  assert.deepEqual(
    CHECKLIST.map((c) => c.id),
    ['launch', 'fps', 'track', 'interact', 'comfort', 'ui', 'audio', 'exit'],
    'ids are a storage contract and must not change',
  );
  assert.deepEqual(CHECKLIST.map((c) => c.n), ['01', '02', '03', '04', '05', '06', '07', '08']);
  assert.deepEqual(CHECKLIST.map((c) => c.t), [
    'Application Stability', 'Performance Stability', 'Tracking & Input', 'Core Interaction',
    'Comfort & Motion', 'UI Readability', 'Spatial Audio', 'Exit / Reset',
  ]);
});

test('evaluation areas classify the same 100 marks without adding a second scale', () => {
  const areas = areaBreakdown(healthy(), { checklist: allChecks('pass') });
  assert.equal(areas.length, 5);
  assert.deepEqual(areas.map((a) => a.label), [
    'Technical Performance', 'XR Functionality', 'Comfort & Usability',
    'Application Stability', 'Other XR Validation',
  ]);

  // The bucket named for performance must equal the Performance Score exactly,
  // so '60' can never read as a different number from '65' anywhere in the UI.
  const g = computeGrade(healthy(), { checklist: allChecks('pass') });
  const technical = areas.find((a) => a.id === 'performance');
  assert.equal(technical.max, GRADE_CONFIG.maxPerformance, 'Technical Performance max must be 60');
  assert.equal(technical.earned, g.performanceScore, 'Technical Performance must equal the Performance Score');
  assert.deepEqual(technical.checklist ?? [], [], 'no validation item may be folded into it');
  assert.equal(areas.reduce((n, a) => n + a.max, 0), 100);
  assert.equal(areas.reduce((n, a) => n + a.earned, 0), 100);

  // Every checklist item belongs to exactly one area.
  const assigned = EVALUATION_AREAS.flatMap((a) => a.checklist);
  assert.equal(assigned.length, CHECKLIST.length);
  assert.equal(new Set(assigned).size, CHECKLIST.length);
});

test('area breakdown is N/A for an invalid capture', () => {
  assert.equal(areaBreakdown(healthy({ totalFrames: 0 }), { checklist: {} }), null);
});

/* ------------------------------------------------------------- xr health -- */

test('XR Health reports healthy areas as healthy', () => {
  const h = xrHealth(healthy(), { checklist: allChecks('pass') });
  assert.equal(h.invalid, false);
  const byId = Object.fromEntries(h.rows.map((r) => [r.id, r]));
  assert.equal(byId.performance.state, 'healthy');
  assert.equal(byId.frameStability.state, 'healthy');
  assert.equal(byId.memory.state, 'healthy');
  assert.equal(byId.xrFunctionality.state, 'healthy');
  assert.equal(byId.comfort.state, 'healthy');
  assert.equal(h.overall.state, 'healthy');
});

test('XR Health escalates to critical on failing evidence', () => {
  const h = xrHealth(unhealthy(), { checklist: allChecks('fail') });
  for (const row of h.rows) assert.equal(row.state, 'critical', `${row.id} should be critical`);
  assert.equal(h.overall.state, 'critical');
});

test('XR Health never assesses an area with no evidence', () => {
  const h = xrHealth(healthy(), { checklist: {} });
  const byId = Object.fromEntries(h.rows.map((r) => [r.id, r]));
  assert.equal(byId.xrFunctionality.state, 'unknown');
  assert.equal(byId.comfort.state, 'unknown');
  assert.match(byId.comfort.detail, /not been assessed/i);
  // Measured areas still report, because those do have evidence.
  assert.equal(byId.performance.state, 'healthy');
});

test('an invalid capture yields no health verdict at all', () => {
  const h = xrHealth(healthy({ totalFrames: 0 }), { checklist: allChecks('pass') });
  assert.equal(h.invalid, true);
  for (const row of h.rows) assert.equal(row.state, 'unknown');
  assert.equal(h.overall.state, 'unknown');
  assert.match(h.overall.detail, /not scored/i);
});

test('health details quote the numbers they are based on', () => {
  const h = xrHealth(healthy({ avgFps: 58.4, droppedFrames: 43, totalFrames: 1440 }), { checklist: {} });
  const byId = Object.fromEntries(h.rows.map((r) => [r.id, r]));
  assert.match(byId.performance.detail, /58\.4 FPS/);
  assert.match(byId.performance.detail, /72 Hz/);
  assert.match(byId.frameStability.detail, /3\.0%/);
  assert.match(byId.memory.detail, /1000 MB.*2800 MB/);
});

test('frame stability takes the worse of bad frames and frame time', () => {
  // Bad frames pass, frame time fails.
  const s = healthy({ droppedFrames: 0, avgFrameMs: 100 });
  const byId = Object.fromEntries(xrHealth(s, { checklist: {} }).rows.map((r) => [r.id, r]));
  assert.equal(byId.frameStability.state, 'critical');
});

/* ------------------------------------------------------------- xr doctor -- */

test('XR Doctor reports the four developer-facing areas', () => {
  const rows = xrDoctor(healthy(), { checklist: allChecks('pass') });
  assert.deepEqual(rows.map((r) => r.label), [
    'Performance', 'Frame Stability', 'Memory', 'XR Experience',
  ]);
  for (const r of rows) assert.ok(['Healthy', 'Needs Attention', 'Critical', 'Not Assessed'].includes(HEALTH_LABEL[r.state]));
});

test('XR Doctor and XR Health cannot disagree', () => {
  const s = healthy({ avgFps: 62, droppedFrames: 100, memoryMB: 2900 });
  const ctx = { checklist: { launch: 'pass', track: 'fail' } };
  const health = Object.fromEntries(xrHealth(s, ctx).rows.map((r) => [r.id, r.state]));
  const doctor = Object.fromEntries(xrDoctor(s, ctx).map((r) => [r.id, r.state]));
  assert.equal(doctor.performance, health.performance);
  assert.equal(doctor.frameStability, health.frameStability);
  assert.equal(doctor.memory, health.memory);
});

/* ------------------------------------------------------------- fix first -- */

test('Fix First stays silent when nothing is wrong', () => {
  assert.equal(fixFirst(healthy(), { checklist: allChecks('pass') }), null);
});

test('Fix First puts a crash above every measurement', () => {
  const fix = fixFirst(unhealthy(), { checklist: { launch: 'fail' } });
  assert.equal(fix.key, 'launch');
  assert.equal(fix.severity, 'critical');
  assert.match(fix.evidence, /Application Stability/);
});

test('Fix First picks frame stability over a lesser issue, with evidence', () => {
  const fix = fixFirst(healthy({ droppedFrames: 300, totalFrames: 1440 }), { checklist: {} });
  assert.equal(fix.key, 'frameStability');
  assert.equal(fix.severity, 'critical');
  assert.match(fix.evidence, /20\.8% of captured frames/);
  assert.match(fix.evidence, /300 of 1,440/);
  assert.ok(fix.investigate.includes('garbage collection'));
});

test('Fix First prefers a critical issue over an attention-level one', () => {
  // Memory fails; average FPS only warns.
  const fix = fixFirst(healthy({ avgFps: 63, memoryMB: 3000 }), { checklist: {} });
  assert.equal(fix.key, 'memory');
  assert.equal(fix.severity, 'critical');
});

test('Fix First treats an invalid capture as a capture problem', () => {
  const fix = fixFirst(healthy({ totalFrames: 0 }), { checklist: {} });
  assert.equal(fix.key, 'invalidCapture');
  assert.match(fix.note, /not an application failure/i);
  assert.match(fix.evidence, /zero frames/i);
});

test('every Fix First issue offers investigation areas, never a diagnosis', () => {
  const cases = [
    [healthy({ droppedFrames: 300 }), {}],
    [healthy({ avgFps: 40 }), {}],
    [healthy({ memoryMB: 3000 }), {}],
    [healthy({ avgFrameMs: 100 }), {}],
    ...CHECKLIST.map((c) => [healthy(), { [c.id]: 'fail' }]),
  ];
  for (const [s, checklist] of cases) {
    const fix = fixFirst(s, { checklist });
    assert.ok(fix, 'a failing signal must produce a Fix First');
    assert.ok(fix.investigate.length > 0, `${fix.key} must suggest where to look`);
    for (const line of fix.investigate) {
      assert.ok(line.length > 3);
      // Investigation areas are places to look, not assertions of cause.
      assert.ok(!/\bis caused by\b|\bthe cause is\b/i.test(line), `"${line}" must not assert a cause`);
    }
  }
});

/* -------------------------------------------------------- recommendations -- */

test('recommendations are evidence-backed and never trail off', () => {
  const recs = recommendations(
    healthy({ avgFps: 40, droppedFrames: 300, avgFrameMs: 100, memoryMB: 3000 }),
    { checklist: allChecks('warn') },
  );
  assert.ok(recs.length >= 4);
  for (const r of recs) {
    assert.ok(r.title.length > 5, 'every recommendation needs a title');
    assert.ok(r.detail.length > 20, 'every recommendation needs substance');
    // Regression guard: an empty investigation list once produced "Look at ."
    assert.ok(!/Look at \.\s*$/.test(r.detail), `"${r.detail}" has an empty investigation list`);
    assert.ok(!/\s,\s|,\s*\./.test(r.detail), `"${r.detail}" has a malformed list`);
  }
});

test('every checklist item can produce a well-formed recommendation', () => {
  for (const item of CHECKLIST) {
    const recs = recommendations(healthy(), { checklist: { [item.id]: 'warn' } });
    const mine = recs.find((r) => r.title.toLowerCase().includes(item.t.toLowerCase()));
    assert.ok(mine, `${item.id} should produce a recommendation`);
    assert.ok(!/Look at \.\s*$/.test(mine.detail), `${item.id}: "${mine.detail}"`);
  }
});

test('an unassessed checklist is called out as understating the score', () => {
  const recs = recommendations(healthy(), { checklist: {} });
  const note = recs.find((r) => /outstanding/i.test(r.title));
  assert.ok(note);
  assert.match(note.title, /8 of 8/);
  assert.match(note.detail, /understates/i);
});

test('a clean capture still says something useful', () => {
  const recs = recommendations(healthy(), { checklist: allChecks('pass') });
  assert.equal(recs.length, 1);
  assert.match(recs[0].title, /No blocking issues/i);
});

test('an invalid capture recommends re-running, nothing else', () => {
  const recs = recommendations(healthy({ totalFrames: 0 }), { checklist: allChecks('fail') });
  assert.equal(recs.length, 1);
  assert.match(recs[0].title, /Re-run/i);
});

/* ------------------------------------------------------------ comparison -- */

const withGrade = (s, checklist = {}) => ({ ...s, metrics: s, grade: computeGrade(s, { checklist }) });

test('comparison labels each metric improved, regressed or unchanged', () => {
  const before = withGrade(healthy({ avgFps: 55, droppedFrames: 200, avgFrameMs: 20, memoryMB: 2400 }));
  const after = withGrade(healthy({ avgFps: 71, droppedFrames: 10, avgFrameMs: 13.5, memoryMB: 1200 }));

  const rows = compareReports(before, after);
  assert.deepEqual(rows.map((r) => r.label), [
    'Average FPS', 'Bad Frame %', 'Average Frame Time', 'Memory', 'Final Score',
  ]);
  for (const r of rows) assert.equal(r.direction, 'improved', `${r.label} should read improved`);
});

test('comparison knows which direction is better for each metric', () => {
  const before = withGrade(healthy({ avgFps: 71, droppedFrames: 10, memoryMB: 1200 }));
  const after = withGrade(healthy({ avgFps: 55, droppedFrames: 200, memoryMB: 2400 }));
  const rows = Object.fromEntries(compareReports(before, after).map((r) => [r.key, r.direction]));

  assert.equal(rows.avgFps, 'regressed', 'lower FPS is worse');
  assert.equal(rows.badFramePct, 'regressed', 'more bad frames is worse');
  assert.equal(rows.memoryMB, 'regressed', 'more memory is worse');
});

test('comparison calls insignificant movement unchanged', () => {
  const a = withGrade(healthy({ avgFps: 71.40 }));
  const b = withGrade(healthy({ avgFps: 71.41 }));
  const row = compareReports(a, b).find((r) => r.key === 'avgFps');
  assert.equal(row.direction, 'unchanged');
});

test('comparison reports unknown rather than guessing when data is missing', () => {
  const a = withGrade(healthy({ totalFrames: 0 }));
  const b = withGrade(healthy());
  const row = compareReports(a, b).find((r) => r.key === 'score');
  assert.equal(row.direction, 'unknown');
  assert.equal(row.delta, null);
});

/* ---------------------------------------------------------------- basics -- */

test('helpers agree with the scoring model', () => {
  assert.equal(badFramePct(healthy({ droppedFrames: 72, totalFrames: 1440 })), 5);
  assert.equal(badFramePct(healthy({ totalFrames: 0 })), null);
  assert.equal(memoryCap('AR'), 1500);
  assert.equal(memoryCap('VR'), 2800);
  assert.equal(GRADE_CONFIG.maxPerformance + GRADE_CONFIG.maxChecklist, 100);
});

test('a grade carries a plain-language meaning', () => {
  const g = computeGrade(healthy(), { checklist: allChecks('pass') });
  assert.equal(g.score, 100);
  assert.equal(g.grade, 'A');
  assert.ok(g.meaning.length > 10);
  assert.ok(!/student|academic/i.test(g.meaning));
});
