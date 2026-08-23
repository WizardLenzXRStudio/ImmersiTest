/**
 * Scoring formula unit tests.
 *
 * Final score = Performance (60) + XR Checklist (40).
 * Performance = 4 metrics x 15 marks (Average FPS, Bad Frames, Frame Time, Memory).
 * These exercise computeGrade() directly — no database, no HTTP.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeGrade, scoredMetrics, GRADE_CONFIG, CHECKLIST,
} from '../../shared/xr-metrics/index.js';

/** A session where every scored metric judges PASS (target 72 Hz). */
const allPass = (o = {}) => ({
  targetFps: 72,
  avgFps: 72,          // >= 69.84  -> pass
  droppedFrames: 0,
  totalFrames: 1440,   // 0%        -> pass
  avgFrameMs: 13.0,    // <= 14.30  -> pass
  memoryMB: 1000,      // <= 1960   -> pass (VR cap 2800)
  platform: 'VR',
  // Present but not scored:
  minFps: 40,
  onePercentLowFps: 70,
  ...o,
});

/** A session where every scored metric judges FAIL. */
const allFail = (o = {}) => ({
  targetFps: 72,
  avgFps: 10,
  droppedFrames: 1440,
  totalFrames: 1440,   // 100%      -> fail
  avgFrameMs: 100,     // > 16.39   -> fail
  memoryMB: 3000,      // > 2800    -> fail
  platform: 'VR',
  minFps: 1,
  onePercentLowFps: 1,
  ...o,
});

const checklistAll = (result) => Object.fromEntries(CHECKLIST.map((c) => [c.id, result]));
/** First `n` items pass, the rest are left unassessed. */
const checklistPassing = (n) =>
  Object.fromEntries(CHECKLIST.slice(0, n).map((c) => [c.id, 'pass']));

/* ------------------------------------------------------------ 1, 2, 3, 4 -- */

test('1. all 4 performance metrics PASS + all checklist PASS = 100 (A)', () => {
  const g = computeGrade(allPass(), { checklist: checklistAll('pass') });
  assert.equal(g.performanceScore, 60);
  assert.equal(g.checklistScore, 40);
  assert.equal(g.score, 100);
  assert.equal(g.grade, 'A');
  assert.equal(g.status, 'pass');
});

test('2. all 4 performance metrics FAIL + all checklist FAIL = 0 (F)', () => {
  const g = computeGrade(allFail(), { checklist: checklistAll('fail') });
  assert.equal(g.performanceScore, 0);
  assert.equal(g.checklistScore, 0);
  assert.equal(g.score, 0);
  assert.equal(g.grade, 'F');
  assert.equal(g.status, 'fail');
});

test('3. exactly four metrics are scored, at 15 / 10 / 0 each', () => {
  const s = allPass({ droppedFrames: 43, totalFrames: 1440 }); // 2.99% -> warn
  const m = scoredMetrics(s);

  assert.deepEqual(Object.keys(m), ['avgFps', 'badFrames', 'frameTime', 'memory']);
  assert.ok(!('onePctLow' in m), '1% Low must not be a scored metric');
  assert.ok(!('minFps' in m), 'Minimum FPS must not be a scored metric');

  const g = computeGrade(s, { checklist: {} });
  assert.deepEqual(g.metricMarks, { avgFps: 15, badFrames: 10, frameTime: 15, memory: 15 });
  assert.equal(g.performanceScore, 55);
});

test('3b. the documented worked example totals 88 (B)', () => {
  // Avg FPS PASS, Bad Frames WARN, Frame Time PASS, Memory PASS -> 55/60
  const s = allPass({ droppedFrames: 43, totalFrames: 1440 });
  const checklist = {};
  CHECKLIST.forEach((c, i) => {
    checklist[c.id] = i < 6 ? 'pass' : i === 6 ? 'warn' : 'fail';
  });

  const g = computeGrade(s, { checklist });
  assert.equal(g.performanceScore, 55);
  assert.equal(g.checklistScore, 33);
  assert.equal(g.score, 88);
  assert.equal(g.grade, 'B');
  assert.equal(g.status, 'pass');
});

test('4. checklist scores Pass 5 / Warn 3 / Fail 0 / not assessed 0', () => {
  assert.equal(computeGrade(allPass(), { checklist: checklistAll('pass') }).checklistScore, 40);
  assert.equal(computeGrade(allPass(), { checklist: checklistAll('warn') }).checklistScore, 24);
  assert.equal(computeGrade(allPass(), { checklist: checklistAll('fail') }).checklistScore, 0);
  assert.equal(computeGrade(allPass(), { checklist: {} }).checklistScore, 0);

  const g = computeGrade(allPass(), { checklist: checklistAll('warn') });
  assert.deepEqual(g.checklistCounts, { pass: 0, warn: 8, fail: 0, notAssessed: 0 });
  assert.equal(CHECKLIST.length, 8, 'still exactly eight checklist items');
});

/* ----------------------------------------------- 5-9: ignored by scoring -- */

const baseline = () => computeGrade(allPass(), { checklist: checklistAll('pass') }).score;

test('5. Minimum FPS does not affect the score', () => {
  const base = baseline();
  for (const minFps of [0.5, 1, 40, 999]) {
    const g = computeGrade(allPass({ minFps }), { checklist: checklistAll('pass') });
    assert.equal(g.score, base, `minFps ${minFps} must not change the score`);
    assert.equal(g.grade, 'A');
  }
});

test('6. 1% Low FPS does not affect the score', () => {
  const base = baseline();
  for (const onePercentLowFps of [0, 1, 7, 55, 72, 200]) {
    const g = computeGrade(allPass({ onePercentLowFps }), { checklist: checklistAll('pass') });
    assert.equal(g.score, base, `1% low ${onePercentLowFps} must not change the score`);
    assert.equal(g.grade, 'A');
  }
});

test('7. Draw Calls do not affect the score', () => {
  const base = baseline();
  for (const drawCalls of [null, -1, 0, 5000]) {
    assert.equal(computeGrade(allPass({ drawCalls }), { checklist: checklistAll('pass') }).score, base);
  }
});

test('8. Triangles do not affect the score', () => {
  const base = baseline();
  for (const triangles of [null, -1, 0, 9_000_000]) {
    assert.equal(computeGrade(allPass({ triangles }), { checklist: checklistAll('pass') }).score, base);
  }
});

test('9. Battery does not affect the score', () => {
  const base = baseline();
  for (const batteryLevel of [null, -1, 0, 0.03, 1]) {
    assert.equal(computeGrade(allPass({ batteryLevel }), { checklist: checklistAll('pass') }).score, base);
  }
});

test('10/11. defects are not an input to the score at all', () => {
  const base = baseline();
  const withBugs = computeGrade(allPass(), {
    checklist: checklistAll('pass'),
    // Passed deliberately: the formula must ignore it entirely.
    bugs: [{ sev: 'critical' }, { sev: 'critical' }, { sev: 'high' }],
  });
  assert.equal(withBugs.score, base, 'two critical defects must not reduce the score');
  assert.equal(withBugs.grade, 'A');
  assert.ok(!('criticalBugs' in withBugs), 'no bug term should survive in the result');
  assert.ok(!('failedChecks' in withBugs), 'no failed-check penalty term should survive');
});

/* ------------------------------------------------------ 12: invalid N/A -- */

test('12. an invalid capture scores N/A, not zero', () => {
  for (const totalFrames of [0, -1, null, undefined]) {
    const g = computeGrade(allFail({ totalFrames, avgFps: 0, droppedFrames: 0 }), {
      checklist: checklistAll('pass'),
    });
    assert.equal(g, null, `totalFrames ${totalFrames} must produce no score`);
  }
});

/* ------------------------------------------------ 13-17: grade boundaries -- */

test('13-17. grade boundaries: 90 A, 80 B, 70 C, 60 D, 59 F', () => {
  // Performance is a full 60, so checklist marks set the exact total.
  const at = (itemsPassing) => computeGrade(allPass(), { checklist: checklistPassing(itemsPassing) });

  const a = at(6); // 60 + 30 = 90
  assert.equal(a.score, 90);
  assert.equal(a.grade, 'A');

  const b = at(4); // 60 + 20 = 80
  assert.equal(b.score, 80);
  assert.equal(b.grade, 'B');

  const c = at(2); // 60 + 10 = 70
  assert.equal(c.score, 70);
  assert.equal(c.grade, 'C');

  const d = at(0); // 60 + 0 = 60
  assert.equal(d.score, 60);
  assert.equal(d.grade, 'D');

  // 59 = two WARN metrics (15+10+10+15 = 50) + three WARN checklist items (9)
  const f = computeGrade(
    allPass({ droppedFrames: 43, totalFrames: 1440, avgFrameMs: 15.0 }),
    { checklist: { launch: 'warn', fps: 'warn', track: 'warn' } },
  );
  assert.equal(f.performanceScore, 50);
  assert.equal(f.checklistScore, 9);
  assert.equal(f.score, 59);
  assert.equal(f.grade, 'F');
});

test('overall status bands: 70 PASS, 60 WARN, 59 FAIL', () => {
  assert.equal(computeGrade(allPass(), { checklist: checklistPassing(2) }).status, 'pass'); // 70
  assert.equal(computeGrade(allPass(), { checklist: checklistPassing(0) }).status, 'warn'); // 60
  assert.equal(
    computeGrade(
      allPass({ droppedFrames: 43, totalFrames: 1440, avgFrameMs: 15.0 }),
      { checklist: { launch: 'warn', fps: 'warn', track: 'warn' } },
    ).status,
    'fail',
  ); // 59
});

/* ------------------------------------------------------------- integrity -- */

test('score is always a whole number within 0..100', () => {
  const samples = [
    computeGrade(allPass(), { checklist: checklistAll('pass') }),
    computeGrade(allFail(), { checklist: checklistAll('fail') }),
    computeGrade(allPass({ droppedFrames: 43, totalFrames: 1440 }), { checklist: checklistAll('warn') }),
  ];
  for (const g of samples) {
    assert.ok(Number.isInteger(g.score), 'no rounding ambiguity between score and grade');
    assert.ok(g.score >= 0 && g.score <= 100);
    assert.equal(g.score, g.performanceScore + g.checklistScore);
  }
});

test('config matches the specified 4 x 15 + 8 x 5 split', () => {
  assert.deepEqual(GRADE_CONFIG.performance, { pass: 15, warn: 10, fail: 0, neutral: 0 });
  assert.deepEqual(GRADE_CONFIG.checklist, { pass: 5, warn: 3, fail: 0 });
  assert.equal(GRADE_CONFIG.maxPerformance, 60);
  assert.equal(GRADE_CONFIG.maxChecklist, 40);
  assert.equal(Object.keys(scoredMetrics(allPass())).length, 4);
  assert.equal(Object.keys(scoredMetrics(allPass())).length * GRADE_CONFIG.performance.pass, 60);
  assert.equal(CHECKLIST.length * GRADE_CONFIG.checklist.pass, 40);
});
