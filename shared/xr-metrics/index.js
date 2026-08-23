/**
 * XR evaluation core — THE single source of truth.
 *
 * Imported by the Express server, the browser dashboard, the PDF builder and
 * the Excel exporter. Keeping one copy is the point: a quality score whose
 * client and server disagree would be a correctness bug.
 *
 * This is a GENERAL XR application quality model, not an academic grading
 * scheme. The score is Performance (60) + XR Validation (40) = 100, computed
 * only in computeGrade(). EVALUATION_AREAS regroups that same 100 by theme for
 * presentation and can never change it. See docs/SCORING.md.
 */

/* ------------------------------------------------------------------ judge --
   Judges captured numbers against VR/AR comfort targets. Thresholds are
   unchanged from v1.0 and are documented in docs/SCORING.md. */

export function judgeFps(avg, target) {
  if (avg == null) return 'neutral';
  if (avg >= target * 0.97) return 'pass';
  if (avg >= target * 0.85) return 'warn';
  return 'fail';
}

/**
 * Retained for the stored `onePercentLowFps` field and diagnostics.
 * NOT part of the score — see GRADE_CONFIG.
 */
export function judgeOnePctLow(low, target) {
  if (low == null) return 'neutral';
  if (low >= target * 0.85) return 'pass'; // stutter is what makes people sick
  if (low >= target * 0.70) return 'warn';
  return 'fail';
}

export function judgeDropped(dropped, total) {
  if (total == null || total === 0) return 'neutral';
  const pct = (dropped / total) * 100;
  if (pct <= 1) return 'pass';
  if (pct <= 5) return 'warn';
  return 'fail';
}

export function judgeMemory(mb, platform) {
  if (mb == null || mb <= 0) return 'neutral';
  const cap = platform === 'AR' ? 1500 : 2800; // rough mobile/standalone budgets
  if (mb <= cap * 0.7) return 'pass';
  if (mb <= cap) return 'warn';
  return 'fail';
}

export function judgeFrameMs(ms, target) {
  if (ms == null || ms <= 0) return 'neutral';
  const budget = 1000 / target;
  if (ms <= budget * 1.03) return 'pass';
  if (ms <= budget * 1.18) return 'warn';
  return 'fail';
}

/** Memory ceiling used by judgeMemory, exposed so the UI can show the budget. */
export const memoryCap = (platform) => (platform === 'AR' ? 1500 : 2800);

/* ---------------------------------------------------------------- capture --
   A capture that recorded no frames is a BROKEN PROFILER RUN, not a failing
   application. Such reports are surfaced as "INVALID CAPTURE" and are
   deliberately left ungraded. */

export function isInvalidCapture(s) {
  return !!s && !(s.totalFrames > 0);
}

/* ------------------------------------------------------------------ grade --
   Final score = Performance (60) + XR Checklist (40) = 100.

   Performance uses four scored metrics, each worth 15 marks, awarded purely
   from the PASS/WARN/FAIL judgement functions above. No separate scoring
   thresholds are introduced.

   Minimum FPS, 1% Low FPS, Draw Calls, Triangles and Battery are NOT scored —
   a single abnormal frame must not dominate a result. They remain in the
   profiler JSON and are reported as diagnostics. */

export const GRADE_CONFIG = {
  /** Marks per scored performance metric (4 metrics x 15 = 60). */
  performance: { pass: 15, warn: 10, fail: 0, neutral: 0 },
  /** Marks per checklist item (8 items x 5 = 40). */
  checklist: { pass: 5, warn: 3, fail: 0 },
  maxPerformance: 60,
  maxChecklist: 40,
  /** Final score -> quality classification. Evaluated top-down; first row wins. */
  scale: [
    { grade: 'A', min: 90 },
    { grade: 'B', min: 80 },
    { grade: 'C', min: 70 },
    { grade: 'D', min: 60 },
    { grade: 'F', min: 0 },
  ],
  /** Final score -> overall status. */
  statusScale: [
    { status: 'pass', min: 70 },
    { status: 'warn', min: 60 },
    { status: 'fail', min: 0 },
  ],
};

/**
 * How the score is presented. It is an internal quality classification for the
 * application under test, never an academic grade for a person.
 */
export const SCORE_LABEL = 'ImmersiTest Quality Score';

/** Plain-language meaning of each classification band. */
export const GRADE_MEANING = {
  A: 'Excellent — meets XR quality expectations across the board',
  B: 'Good — minor issues worth addressing',
  C: 'Acceptable — noticeable issues to resolve before release',
  D: 'Weak — significant issues affecting the experience',
  F: 'Poor — the experience needs substantial work',
};

/** The four metrics that carry marks, in report order. */
export function scoredMetrics(s) {
  return {
    avgFps: judgeFps(s.avgFps, s.targetFps),
    badFrames: judgeDropped(s.droppedFrames, s.totalFrames),
    frameTime: judgeFrameMs(s.avgFrameMs, s.targetFps),
    memory: judgeMemory(s.memoryMB, s.platform),
  };
}

/**
 * @param {object} s      report metrics
 * @param {object} [ctx]  { checklist: {itemId: 'pass'|'warn'|'fail'} }
 * @returns {object|null} null when the capture is invalid (score/grade = N/A)
 */
export function computeGrade(s, ctx = {}) {
  if (!s) return null;
  // A broken capture carries no evidence either way: N/A, never a failure.
  if (isInvalidCapture(s)) return null;

  const cfg = GRADE_CONFIG;

  const metrics = scoredMetrics(s);
  const metricMarks = {};
  let performanceScore = 0;
  for (const [key, judgement] of Object.entries(metrics)) {
    const marks = cfg.performance[judgement] ?? 0;
    metricMarks[key] = marks;
    performanceScore += marks;
  }

  const results = ctx.checklist ?? {};
  const checklistMarks = {};
  let checklistScore = 0;
  const counts = { pass: 0, warn: 0, fail: 0, notAssessed: 0 };
  for (const item of CHECKLIST) {
    const result = results[item.id];
    const marks = cfg.checklist[result] ?? 0;
    checklistMarks[item.id] = marks;
    checklistScore += marks;
    if (result === 'pass' || result === 'warn' || result === 'fail') counts[result]++;
    else counts.notAssessed++;
  }

  const score = Math.max(0, Math.min(100, performanceScore + checklistScore));
  const grade = cfg.scale.find((r) => score >= r.min).grade;
  const status = cfg.statusScale.find((r) => score >= r.min).status;

  return {
    grade,
    score,
    status,
    meaning: GRADE_MEANING[grade],
    performanceScore,
    checklistScore,
    metrics,
    metricMarks,
    checklistMarks,
    checklistCounts: counts,
  };
}

/**
 * Overall status for a report. Derived from the final score band
 * (70+ pass, 60+ warn, else fail); an invalid capture has no status.
 */
export function performanceStatus(s, ctx = {}) {
  if (!s || isInvalidCapture(s)) return 'neutral';
  return computeGrade(s, ctx)?.status ?? 'neutral';
}

/* -------------------------------------------------------------- checklist --
   Eight general XR validation criteria. The IDs are load-bearing — they are
   stored in checklist_results and appear in existing exports — so the wording
   generalised in v2.0 but the identifiers did not change. */

export const CHECKLIST = [
  {
    id: 'launch',
    n: '01',
    t: 'Application Stability',
    d: 'Application launches and reaches the intended experience without crashing.',
  },
  {
    id: 'fps',
    n: '02',
    t: 'Performance Stability',
    d: 'Application maintains the configured target performance without sustained problematic drops.',
  },
  {
    id: 'track',
    n: '03',
    t: 'Tracking & Input',
    d: 'Controllers, hands, head tracking, touch or AR tracking respond correctly.',
  },
  {
    id: 'interact',
    n: '04',
    t: 'Core Interaction',
    d: 'Primary interaction systems such as grab, point, select, UI interaction, gestures or application-specific interactions work correctly.',
  },
  {
    id: 'comfort',
    n: '05',
    t: 'Comfort & Motion',
    d: 'Locomotion, camera movement and transitions do not introduce obvious uncomfortable or jarring motion.',
  },
  {
    id: 'ui',
    n: '06',
    t: 'UI Readability',
    d: 'Text, controls and panels are readable and positioned appropriately for the XR experience.',
  },
  {
    id: 'audio',
    n: '07',
    t: 'Spatial Audio',
    d: 'Spatial audio behaves correctly without obvious clipping, incorrect positioning or major audio issues.',
  },
  {
    id: 'exit',
    n: '08',
    t: 'Exit / Reset',
    d: 'The application can exit, restart or reset cleanly without hanging.',
  },
];

/* -------------------------------------------------------- evaluation areas --
   Classification buckets, NOT a second scoring system.

   These regroup the SAME 100 marks produced by computeGrade() so a reader can
   see where the marks came from thematically. The totals add up to 100 and are
   derived from computeGrade's own metricMarks / checklistMarks — nothing here
   can change a score.

   "Technical Performance" holds exactly the four measured metrics, so its 60 is
   the same 60 as the Performance Score. The human judgement about sustained
   performance (validation item 02) sits in its own bucket rather than being
   folded in here, so the two cannot be confused. */

export const EVALUATION_AREAS = [
  {
    id: 'performance',
    label: 'Technical Performance',
    blurb: 'The four measured metrics: frame rate, frame time, frame stability and memory. This is the 60-mark Performance Score.',
    metrics: ['avgFps', 'badFrames', 'frameTime', 'memory'],
    checklist: [],
  },
  {
    id: 'functionality',
    label: 'XR Functionality',
    blurb: 'Tracking, input, core interaction and spatial audio behave correctly.',
    metrics: [],
    checklist: ['track', 'interact', 'audio'],
  },
  {
    id: 'comfort',
    label: 'Comfort & Usability',
    blurb: 'Motion comfort and readability of the in-headset interface.',
    metrics: [],
    checklist: ['comfort', 'ui'],
  },
  {
    id: 'stability',
    label: 'Application Stability',
    blurb: 'The application starts, runs and exits without crashing or hanging.',
    metrics: [],
    checklist: ['launch', 'exit'],
  },
  {
    id: 'validation',
    label: 'Other XR Validation',
    blurb: 'Performance Stability: the reviewed judgement that the application held its target throughout, kept separate from the measured metrics.',
    metrics: [],
    checklist: ['fps'],
  },
];

/**
 * Marks earned and available per evaluation area.
 * @returns {Array|null} null for an invalid capture
 */
export function areaBreakdown(s, ctx = {}) {
  const g = computeGrade(s, ctx);
  if (!g) return null;

  return EVALUATION_AREAS.map((area) => {
    let earned = 0;
    let max = 0;
    for (const m of area.metrics) {
      earned += g.metricMarks[m] ?? 0;
      max += GRADE_CONFIG.performance.pass;
    }
    for (const c of area.checklist) {
      earned += g.checklistMarks[c] ?? 0;
      max += GRADE_CONFIG.checklist.pass;
    }
    const pct = max ? Math.round((earned / max) * 100) : 0;
    return { id: area.id, label: area.label, blurb: area.blurb, earned, max, pct };
  });
}

/* --------------------------------------------------------------- xr health --
   Translates the captured evidence into per-area condition. States are
   deliberately coarse: the profiler cannot see CPU/GPU internals, so anything
   finer would be a guess dressed up as a diagnosis. */

/** Condition states, worst first. */
export const HEALTH_STATES = ['critical', 'attention', 'healthy', 'unknown'];

export const HEALTH_LABEL = {
  healthy: 'Healthy',
  attention: 'Needs Attention',
  critical: 'Critical',
  unknown: 'Not Assessed',
};

const STATE_FROM_JUDGEMENT = { pass: 'healthy', warn: 'attention', fail: 'critical' };
const STATE_RANK = { critical: 0, attention: 1, healthy: 2, unknown: 3 };

const stateOf = (judgement) => STATE_FROM_JUDGEMENT[judgement] ?? 'unknown';

/** Worst (most severe) known state in a list; 'unknown' only if nothing known. */
function worstState(states) {
  const known = states.filter((s) => s && s !== 'unknown');
  if (!known.length) return 'unknown';
  return known.sort((a, b) => STATE_RANK[a] - STATE_RANK[b])[0];
}

/** Worst state across a set of checklist items, ignoring unassessed ones. */
function checklistState(itemIds, results) {
  return worstState(itemIds.map((id) => stateOf(results[id])));
}

const pct1 = (v) => `${v.toFixed(1)}%`;
const fixed = (v, d = 1) => (v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(d));

/** Bad-frame percentage, or null when the capture has no frames. */
export function badFramePct(s) {
  if (!s || !(s.totalFrames > 0)) return null;
  return (s.droppedFrames / s.totalFrames) * 100;
}

/**
 * Per-area condition summary.
 *
 * @returns {{rows: Array, overall: object, invalid: boolean}}
 *   rows: [{ id, label, state, detail }]
 */
export function xrHealth(s, ctx = {}) {
  const results = ctx.checklist ?? {};
  const invalid = isInvalidCapture(s);

  if (invalid) {
    const unknownRow = (id, label) => ({
      id,
      label,
      state: 'unknown',
      detail: 'No frames were recorded, so there is no evidence to assess.',
    });
    return {
      invalid: true,
      rows: [
        unknownRow('performance', 'Performance'),
        unknownRow('frameStability', 'Frame Stability'),
        unknownRow('memory', 'Memory'),
        unknownRow('xrFunctionality', 'XR Functionality'),
        unknownRow('comfort', 'Comfort'),
      ],
      overall: {
        id: 'overall',
        label: 'Overall Quality',
        state: 'unknown',
        detail: 'Invalid capture — the test recorded no frames and is not scored.',
      },
    };
  }

  const m = scoredMetrics(s);
  const drop = badFramePct(s);
  const cap = memoryCap(s.platform);

  const performance = {
    id: 'performance',
    label: 'Performance',
    state: stateOf(m.avgFps),
    detail:
      s.avgFps == null
        ? 'No frame rate was reported.'
        : `Averaged ${fixed(s.avgFps)} FPS against a ${s.targetFps} Hz target.`,
  };

  // Frame stability combines bad frames with average frame time: both describe
  // whether frames arrive on schedule.
  const frameStability = {
    id: 'frameStability',
    label: 'Frame Stability',
    state: worstState([stateOf(m.badFrames), stateOf(m.frameTime)]),
    detail:
      drop == null
        ? 'No frame timing was reported.'
        : `${pct1(drop)} of ${Number(s.totalFrames).toLocaleString()} captured frames exceeded the bad-frame threshold; average frame time ${fixed(s.avgFrameMs, 2)} ms against a ${fixed(1000 / s.targetFps, 2)} ms budget.`,
  };

  const memory = {
    id: 'memory',
    label: 'Memory',
    state: stateOf(m.memory),
    detail:
      s.memoryMB > 0
        ? `Peak reported allocation ${fixed(s.memoryMB, 0)} MB against a ${cap} MB ${s.platform} budget.`
        : 'No memory figure was reported.',
  };

  const funcState = checklistState(['track', 'interact', 'audio'], results);
  const xrFunctionality = {
    id: 'xrFunctionality',
    label: 'XR Functionality',
    state: funcState,
    detail: describeChecklistGroup(['track', 'interact', 'audio'], results,
      'Tracking, interaction and audio'),
  };

  const comfortState = checklistState(['comfort', 'ui'], results);
  const comfort = {
    id: 'comfort',
    label: 'Comfort',
    state: comfortState,
    detail: describeChecklistGroup(['comfort', 'ui'], results, 'Motion comfort and UI readability'),
  };

  const g = computeGrade(s, ctx);
  const overall = {
    id: 'overall',
    label: 'Overall Quality',
    state: stateOf(g.status),
    detail: `${g.score}/100 — ${g.grade}. Performance ${g.performanceScore}/${GRADE_CONFIG.maxPerformance}, XR validation ${g.checklistScore}/${GRADE_CONFIG.maxChecklist}.`,
  };

  return {
    invalid: false,
    rows: [performance, frameStability, memory, xrFunctionality, comfort],
    overall,
  };
}

function describeChecklistGroup(ids, results, noun) {
  const assessed = ids.filter((id) => results[id]);
  if (!assessed.length) return `${noun} have not been assessed yet.`;
  const failed = assessed.filter((id) => results[id] === 'fail');
  const warned = assessed.filter((id) => results[id] === 'warn');
  const name = (id) => CHECKLIST.find((c) => c.id === id)?.t ?? id;

  if (failed.length) return `Marked FAIL: ${failed.map(name).join(', ')}.`;
  if (warned.length) return `Marked WARN: ${warned.map(name).join(', ')}.`;
  return `${assessed.length} of ${ids.length} checked, all passing.`;
}

/**
 * XR Doctor — the four condition rows shown as a developer-facing readout.
 * Derived from xrHealth so the two can never disagree.
 */
export function xrDoctor(s, ctx = {}) {
  const health = xrHealth(s, ctx);
  const byId = Object.fromEntries(health.rows.map((r) => [r.id, r]));
  const results = ctx.checklist ?? {};

  // "XR Experience" folds every checklist-derived area into one line.
  const experienceState = health.invalid
    ? 'unknown'
    : checklistState(CHECKLIST.map((c) => c.id), results);

  return [
    byId.performance,
    byId.frameStability,
    byId.memory,
    {
      id: 'xrExperience',
      label: 'XR Experience',
      state: experienceState,
      detail: health.invalid
        ? 'No frames were recorded, so there is no evidence to assess.'
        : describeChecklistGroup(CHECKLIST.map((c) => c.id), results, 'The XR validation items'),
    },
  ];
}

/* ---------------------------------------------------------------- fix first --
   One highest-priority, observable issue. Everything here is grounded in a
   number the profiler actually captured or a checklist result a human
   recorded. Investigation areas are explicitly possibilities, never causes:
   this profiler cannot attribute a spike to a specific system. */

/** Investigation areas per issue. Possibilities to check, not diagnoses. */
const INVESTIGATE = {
  frameStability: [
    'expensive Update/LateUpdate work',
    'garbage collection',
    'synchronous loading',
    'object creation/destruction',
    'physics spikes',
  ],
  avgFps: [
    'draw call count and batching',
    'overdraw and fill rate',
    'shader complexity',
    'scene object and light count',
    'render scale or resolution settings',
  ],
  frameTime: [
    'main-thread script cost',
    'physics timestep configuration',
    'animation and skinning cost',
    'UI canvas rebuilds',
    'expensive per-frame allocations',
  ],
  memory: [
    'texture import sizes and compression',
    'audio clip load types',
    'assets kept alive by lingering references',
    'additive scene loading without unloading',
    'read/write enabled meshes and textures',
  ],
  launch: [
    'exceptions thrown during scene load',
    'missing or unassigned references',
    'XR plug-in and provider initialisation',
    'platform permissions',
  ],
  // The 'fps' validation item is a human judgement about sustained performance,
  // so it points at the same places as the measured frame-rate issues.
  fps: [
    'sustained load in specific scenes or interactions',
    'draw call count and batching',
    'garbage collection during play',
    'expensive Update/LateUpdate work',
    'render scale or resolution settings',
  ],
  track: [
    'XR input action bindings',
    'tracking origin and rig configuration',
    'controller/hand provider setup',
    'AR session and plane detection configuration',
  ],
  interact: [
    'interactor and interactable layer masks',
    'collider setup on interactable objects',
    'event wiring on UI and interaction components',
    'raycast configuration and distances',
  ],
  comfort: [
    'locomotion acceleration and snap-turn settings',
    'camera movement driven by script rather than head pose',
    'vignette or comfort-mode options',
    'transition and fade timing',
  ],
  ui: [
    'canvas distance and scale in world space',
    'font size and dynamic font atlas resolution',
    'text contrast against the environment',
    'panel placement inside the comfortable field of view',
  ],
  audio: [
    'spatial blend settings on audio sources',
    'audio listener placement on the XR camera',
    'clipping from overlapping sources or high gain',
    'rolloff curves and max distance',
  ],
  exit: [
    'work performed in OnApplicationQuit or OnDestroy',
    'threads or coroutines not stopped on shutdown',
    'blocking file or network calls during teardown',
    'scene reset logic leaving objects behind',
  ],
};

/**
 * Highest-priority observable issue, or null when nothing stands out.
 *
 * @returns {{key,title,severity,evidence,investigate:string[]}|null}
 */
export function fixFirst(s, ctx = {}) {
  const results = ctx.checklist ?? {};

  if (isInvalidCapture(s)) {
    return {
      key: 'invalidCapture',
      title: 'Invalid capture',
      severity: 'critical',
      evidence:
        'The profiler ran but recorded zero frames, so this test carries no performance evidence.',
      investigate: [
        'confirm the profiler component is active in the running scene',
        'check the console for "[XRTestProfiler] Session STARTED"',
        'ensure the session ran long enough to record frames',
        'verify the application reached the intended scene',
      ],
      note: 'This is a capture problem, not an application failure.',
    };
  }

  const m = scoredMetrics(s);
  const drop = badFramePct(s);
  const cap = memoryCap(s.platform);
  const candidates = [];

  const push = (key, title, judgement, evidence, rank) => {
    if (judgement !== 'warn' && judgement !== 'fail') return;
    candidates.push({
      key,
      title,
      severity: judgement === 'fail' ? 'critical' : 'attention',
      evidence,
      investigate: INVESTIGATE[key] ?? [],
      rank,
    });
  };

  // A crash outranks every measurement: nothing else matters if it will not run.
  if (results.launch === 'fail' || results.launch === 'warn') {
    candidates.push({
      key: 'launch',
      title: 'Application stability',
      severity: results.launch === 'fail' ? 'critical' : 'attention',
      evidence: `XR validation item 01 (Application Stability) was marked ${results.launch.toUpperCase()}.`,
      investigate: INVESTIGATE.launch,
      rank: 0,
    });
  }

  push('frameStability', 'Frame stability', m.badFrames,
    drop == null
      ? 'Frame timing was not reported.'
      : `${pct1(drop)} of captured frames exceeded the configured bad-frame threshold (${Number(s.droppedFrames).toLocaleString()} of ${Number(s.totalFrames).toLocaleString()}).`,
    1);

  push('avgFps', 'Average frame rate', m.avgFps,
    `Average frame rate was ${fixed(s.avgFps)} FPS against a ${s.targetFps} Hz target.`,
    2);

  push('frameTime', 'Frame time', m.frameTime,
    `Average frame time was ${fixed(s.avgFrameMs, 2)} ms against a ${fixed(1000 / s.targetFps, 2)} ms budget.`,
    3);

  push('memory', 'Memory usage', m.memory,
    `Reported allocation was ${fixed(s.memoryMB, 0)} MB against a ${cap} MB ${s.platform} budget.`,
    4);

  // Checklist-derived issues, in the order a developer would tackle them.
  // 'launch' is handled above (a crash outranks everything); every other item
  // must appear here or a recorded FAIL would never surface as Fix First.
  const checklistOrder = ['fps', 'track', 'interact', 'comfort', 'ui', 'audio', 'exit'];
  checklistOrder.forEach((id, i) => {
    const r = results[id];
    if (r !== 'fail' && r !== 'warn') return;
    const item = CHECKLIST.find((c) => c.id === id);
    candidates.push({
      key: id,
      title: item.t,
      severity: r === 'fail' ? 'critical' : 'attention',
      evidence: `XR validation item ${item.n} (${item.t}) was marked ${r.toUpperCase()}.`,
      investigate: INVESTIGATE[id] ?? [],
      rank: 5 + i,
    });
  });

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
    return a.rank - b.rank;
  });

  const { rank, ...top } = candidates[0];
  return top;
}

/* ----------------------------------------------------------- recommendations --
   Every non-passing signal, expressed as something a developer can act on.
   Evidence-based only: no recommendation appears without a number or a
   recorded checklist result behind it. */

export function recommendations(s, ctx = {}) {
  const results = ctx.checklist ?? {};
  const out = [];

  if (isInvalidCapture(s)) {
    out.push({
      severity: 'critical',
      title: 'Re-run the capture',
      detail:
        'This report recorded zero frames. Confirm the profiler is active in the running scene and that the session lasts long enough to record frames, then test again.',
    });
    return out;
  }

  const m = scoredMetrics(s);
  const drop = badFramePct(s);
  const cap = memoryCap(s.platform);
  const sev = (j) => (j === 'fail' ? 'critical' : 'attention');

  if (m.avgFps !== 'pass' && m.avgFps !== 'neutral') {
    out.push({
      severity: sev(m.avgFps),
      title: 'Raise average frame rate',
      detail: `Averaged ${fixed(s.avgFps)} FPS against a ${s.targetFps} Hz target. Look at ${INVESTIGATE.avgFps.slice(0, 3).join(', ')}.`,
    });
  }
  if (m.badFrames !== 'pass' && m.badFrames !== 'neutral' && drop != null) {
    out.push({
      severity: sev(m.badFrames),
      title: 'Reduce frame spikes',
      detail: `${pct1(drop)} of frames exceeded the bad-frame threshold. Look at ${INVESTIGATE.frameStability.slice(0, 3).join(', ')}.`,
    });
  }
  if (m.frameTime !== 'pass' && m.frameTime !== 'neutral') {
    out.push({
      severity: sev(m.frameTime),
      title: 'Bring frame time inside budget',
      detail: `Average frame time ${fixed(s.avgFrameMs, 2)} ms against a ${fixed(1000 / s.targetFps, 2)} ms budget. Look at ${INVESTIGATE.frameTime.slice(0, 3).join(', ')}.`,
    });
  }
  if (m.memory !== 'pass' && m.memory !== 'neutral') {
    out.push({
      severity: sev(m.memory),
      title: 'Reduce memory footprint',
      detail: `${fixed(s.memoryMB, 0)} MB against a ${cap} MB ${s.platform} budget. Look at ${INVESTIGATE.memory.slice(0, 3).join(', ')}.`,
    });
  }

  for (const item of CHECKLIST) {
    const r = results[item.id];
    if (r !== 'fail' && r !== 'warn') continue;
    const areas = (INVESTIGATE[item.id] ?? []).slice(0, 3);
    out.push({
      severity: sev(r),
      title: `Address ${item.t.toLowerCase()}`,
      // Only promise investigation areas when there are some to name.
      detail: areas.length
        ? `Marked ${r.toUpperCase()} during XR validation. Look at ${areas.join(', ')}.`
        : `Marked ${r.toUpperCase()} during XR validation.`,
    });
  }

  const unassessed = CHECKLIST.filter((c) => !results[c.id]);
  if (unassessed.length) {
    out.push({
      severity: 'info',
      title: `Complete the XR validation checklist (${unassessed.length} of ${CHECKLIST.length} outstanding)`,
      detail:
        'Unassessed items score zero, so the quality score understates the application until the checklist is completed.',
    });
  }

  if (!out.length) {
    out.push({
      severity: 'info',
      title: 'No blocking issues found in this capture',
      detail:
        'Every scored metric and validation item passed. Re-test on target hardware and with a longer session to confirm the result holds.',
    });
  }

  return out;
}

/* ------------------------------------------------------------- comparison --
   Comparing two reports of the same application. Used when more than one
   report is loaded into a single analysis session; never required. */

/** Fields compared, with the direction that counts as an improvement. */
export const COMPARISON_FIELDS = [
  { key: 'avgFps', label: 'Average FPS', better: 'higher', dp: 1, unit: '' },
  { key: 'badFramePct', label: 'Bad Frame %', better: 'lower', dp: 2, unit: '%' },
  { key: 'avgFrameMs', label: 'Average Frame Time', better: 'lower', dp: 2, unit: 'ms' },
  { key: 'memoryMB', label: 'Memory', better: 'lower', dp: 0, unit: 'MB' },
  { key: 'score', label: 'Final Score', better: 'higher', dp: 0, unit: '/100' },
];

/** Relative change below this is reported as Unchanged rather than noise. */
const UNCHANGED_EPSILON = 0.005; // 0.5%

const comparableValue = (report, key) => {
  if (key === 'badFramePct') return badFramePct(report.metrics ?? report);
  if (key === 'score') return report.grade?.score ?? null;
  const src = report.metrics ?? report;
  return src[key] ?? null;
};

/**
 * Compares a report against a baseline.
 * @returns {Array} [{ key, label, from, to, delta, direction, unit, dp }]
 *   direction: 'improved' | 'regressed' | 'unchanged' | 'unknown'
 */
export function compareReports(baseline, current) {
  return COMPARISON_FIELDS.map((f) => {
    const from = comparableValue(baseline, f.key);
    const to = comparableValue(current, f.key);
    if (from == null || to == null || Number.isNaN(from) || Number.isNaN(to)) {
      return { ...f, from, to, delta: null, direction: 'unknown' };
    }
    const delta = to - from;
    const scale = Math.abs(from) > 1e-9 ? Math.abs(from) : 1;
    let direction;
    if (Math.abs(delta) / scale < UNCHANGED_EPSILON) direction = 'unchanged';
    else if (f.better === 'higher') direction = delta > 0 ? 'improved' : 'regressed';
    else direction = delta < 0 ? 'improved' : 'regressed';
    return { ...f, from, to, delta, direction };
  });
}
