/**
 * The report body, shared by the hosted analysis view and the local dashboard.
 *
 * Both render the same evidence in the same order — verdict, metrics, device,
 * charts, evaluation areas, XR Health, Fix First, XR Doctor, XR validation —
 * so a report looks identical whether it came from a temporary hosted session
 * or the local database.
 */
import { esc, r1, r2, int, fmtDate, gradeBadge, platformPill } from './ui.js';
import { scoreRingHTML } from './motion.js';
import {
  judgeFps, judgeDropped, judgeMemory, judgeFrameMs, badFramePct,
  GRADE_CONFIG, SCORE_LABEL, CHECKLIST,
} from '/shared/xr-metrics/index.js';

export const CHECK_STATE = { pass: 'Pass', warn: 'Warn', fail: 'Fail' };
export const STATUS_WORD = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' };

/** Marks a validation result is worth, shown next to each item. */
export const checkMarks = (v) => GRADE_CONFIG.checklist[v] ?? 0;

/* --------------------------------------------------------------- verdict -- */

export function verdictHTML(report, g, invalid) {
  const v = invalid
    ? { key: 'invalid', label: 'INVALID CAPTURE' }
    : { key: g.status, label: STATUS_WORD[g.status] };

  return `
    <div class="verdict framed ${v.key}">
      <span class="v-bracket tl" aria-hidden="true"></span>
      <span class="v-bracket tr" aria-hidden="true"></span>
      <span class="v-bracket bl" aria-hidden="true"></span>
      <span class="v-bracket br" aria-hidden="true"></span>
      <div class="v-main">
        ${g ? scoreRingHTML(g.score, g.status, { label: '/ 100' }) : ''}
        <div class="focus-frame">
          <span class="v-label">${esc(SCORE_LABEL)}</span>
          <span class="v-status">${v.label}</span>
        </div>
        ${g ? gradeBadge(g.grade, g.score, 'lg') : ''}
      </div>
      <div class="v-sep" aria-hidden="true"></div>
      <div class="v-note" id="scoreNote">
        ${invalid ? invalidNoteHTML() : scoreNoteHTML(g, report.targetFps)}
      </div>
    </div>`;
}

export const invalidNoteHTML = () =>
  `The profiler ran but recorded no frames, so this test carries no performance evidence.
   Score and status are <b>N/A</b> — this is a capture problem, not an application failure.
   Check the Unity console for <code>[XRTestProfiler] Session STARTED</code> and run the test again.`;

export function scoreNoteHTML(g, targetFps) {
  if (!g) return `Judged against a ${targetFps} Hz comfort target.`;
  return `Judged against a ${targetFps} Hz comfort target.
    <b>Score ${g.score}/100 · ${g.grade}</b> — performance ${g.performanceScore}/${GRADE_CONFIG.maxPerformance},
    XR validation ${g.checklistScore}/${GRADE_CONFIG.maxChecklist}.
    <span class="muted">${esc(g.meaning ?? '')}</span>`;
}

/* --------------------------------------------------------------- metrics -- */

export function metricsHTML(report) {
  const drop = badFramePct(report);

  // Scored tiles animate their value; diagnostic tiles are visually quieter so
  // the four that carry marks read first.
  const cell = (label, num, dec, unit, judge, note, info) => {
    const has = num != null && !Number.isNaN(num);
    const val = has ? `<span data-count="${num}" data-dec="${dec}">0</span>` : '—';
    return `<div class="metric ${judge} ${info ? 'info' : ''}">
      <div class="m-ticks" aria-hidden="true"></div>
      <div class="label">${esc(label)}</div>
      <div class="val">${val}<span class="unit"> ${esc(unit ?? '')}</span></div>
      <div class="judge">${esc(note ?? { pass: 'Within target', warn: 'Borderline', fail: 'Below target', neutral: 'No data' }[judge])}</div>
      <div class="bar"></div>
    </div>`;
  };

  return `<div class="grid-metrics">
    ${cell('Average FPS', report.avgFps, 1, '', judgeFps(report.avgFps, report.targetFps), `Target ${report.targetFps} Hz`)}
    ${cell('Bad Frames', drop, 1, '%', judgeDropped(report.droppedFrames, report.totalFrames), `${int(report.droppedFrames)} of ${int(report.totalFrames)}`)}
    ${cell('Avg Frame Time', report.avgFrameMs, 2, 'ms', judgeFrameMs(report.avgFrameMs, report.targetFps), `Budget ${r2(1000 / report.targetFps)} ms`)}
    ${cell('Memory', report.memoryMB > 0 ? report.memoryMB : null, 1, 'MB', judgeMemory(report.memoryMB, report.platform), `${report.platform} budget`)}
  </div>
  <div class="grid-metrics">
    ${cell('Draw Calls', report.drawCalls ?? null, 0, '', 'neutral', report.drawCalls != null ? 'Editor capture' : 'Build run', true)}
    ${cell('Triangles', report.triangles ?? null, 0, '', 'neutral', report.triangles != null ? 'Editor capture' : 'Build run', true)}
    ${cell('Battery', report.batteryLevel != null ? report.batteryLevel * 100 : null, 0, '%', 'neutral', report.batteryStatus ?? 'Not reported', true)}
    ${cell('Minimum FPS', report.minFps, 1, '', 'neutral', 'Worst frame · diagnostic', true)}
    ${cell('1% Low FPS', report.onePercentLowFps, 1, '', 'neutral', 'Diagnostic only', true)}
  </div>`;
}

/* ---------------------------------------------------------------- device -- */

/**
 * Capture context, shown near the TOP of the report: a reader should not have
 * to scroll to find out which device and target the numbers came from.
 */
export function deviceStripHTML(report, extra = []) {
  const rows = [
    ['Platform', report.platform],
    ['Device', report.device ?? '—'],
    ['OS', report.os ?? '—'],
    ['GPU', report.gpu ?? '—'],
    ['Target FPS', `${report.targetFps} Hz`],
    ['Test Date', fmtDate(report.capturedAt)],
    ['Duration', `${r1(report.durationSec)}s`],
    ...extra,
  ];
  return `
    <section class="section capture" aria-labelledby="dev-h">
      <h3 id="dev-h">Device &amp; Capture</h3>
      <div class="infostrip">
        ${rows.map(([k, v]) => `<span>${esc(k)} <b>${esc(String(v))}</b></span>`).join('')}
      </div>
    </section>`;
}

/* ---------------------------------------------------------------- charts -- */

export function chartsHTML(report) {
  if (!report.series?.length) {
    return `<section class="section" aria-labelledby="ch-h">
      <h3 id="ch-h">Performance Over Time</h3>
      <div class="chart-empty">
        <div>No time-series data in this report</div>
        <div class="muted" style="font-size:12px">The profiler recorded summary metrics but no sample points.</div>
      </div>
    </section>`;
  }
  return `
    <section class="section" aria-labelledby="fps-h">
      <h3 id="fps-h">Frame Rate Over Time <span class="hint">${report.series.length} samples · FPS</span></h3>
      <div class="chartwrap"><canvas id="fpsChart" role="img"
        aria-label="Frames per second across the session against a ${report.targetFps} hertz target"></canvas></div>
    </section>
    <section class="section" aria-labelledby="ft-h">
      <h3 id="ft-h">Frame Time Over Time <span class="hint">milliseconds · budget ${r2(1000 / report.targetFps)} ms</span></h3>
      <div class="chartwrap"><canvas id="frameChart" role="img"
        aria-label="Frame time in milliseconds against a ${r2(1000 / report.targetFps)} millisecond budget"></canvas></div>
    </section>
    <section class="section" aria-labelledby="mem-h">
      <h3 id="mem-h">Memory Over Time <span class="hint">megabytes allocated</span></h3>
      <div class="chartwrap"><canvas id="memChart" role="img"
        aria-label="Allocated memory in megabytes across the session"></canvas></div>
    </section>`;
}

/* ------------------------------------------------------------- checklist -- */

export function checkRow(c, value, index) {
  const n = c.n ?? String(index + 1).padStart(2, '0');
  return `<div class="check-row ${value ? 'done' : 'todo'}">
    <div class="check-idx" aria-hidden="true">${n}</div>
    <div class="ctext">${esc(c.t)}<small>${esc(c.d)}</small></div>
    <div class="check-state ${value ?? 'unassessed'}">${
      value ? `${CHECK_STATE[value]} · ${checkMarks(value)}/5` : 'Unassessed · 0/5'
    }</div>
    <div class="seg-wrap">
      <span class="seg-caption" aria-hidden="true">${value ? 'Result' : 'Select result'}</span>
      <div class="seg" role="group" aria-label="${esc(c.t)} — select result">
        ${['pass', 'warn', 'fail']
          .map(
            (k) => `<button type="button" class="${value === k ? 'on ' + k : ''}"
              data-check="${esc(c.id)}" data-val="${k}"
              aria-pressed="${value === k}">${CHECK_STATE[k]}</button>`,
          )
          .join('')}
      </div>
    </div>
  </div>`;
}

export function checklistHint(assessed, total, g) {
  const marks = g ? ` · ${g.checklistScore}/${GRADE_CONFIG.maxChecklist} marks` : '';
  return `${assessed} of ${total} assessed${marks}`;
}

/** Unassessed items score zero, so the user has to be told before they export. */
export function unassessedCount(report, items = CHECKLIST) {
  const results = report.checklist ?? {};
  return items.filter((c) => !results[c.id]).length;
}

export function checklistHTML(report, items = CHECKLIST, g = null) {
  const assessed = Object.keys(report.checklist ?? {}).length;
  const outstanding = items.length - assessed;
  const pct = Math.round((assessed / items.length) * 100);

  return `
    <section class="section validation ${outstanding ? 'incomplete' : 'complete'}" aria-labelledby="chk-h">
      <div class="human-divider" aria-hidden="true">
        <span class="hd-side">Profiler · measures the machine</span>
        <span class="hd-rule"></span>
        <span class="hd-side accent">XR Validation · evaluates the experience</span>
      </div>
      <h3 id="chk-h">XR Validation
        <span class="chk-progress ${outstanding ? 'incomplete' : 'complete'}">${assessed} / ${items.length} complete</span>
        <span class="hint">${checklistHint(assessed, items.length, g)}</span></h3>
      <p class="chk-sub">Eight checks your profiler cannot measure.</p>

      <div class="validation-lead">
        <p class="vl-text">
          ${
            outstanding
              ? `<b>Complete the XR validation checklist before downloading your report.</b>
                 These checks cover aspects a performance profiler cannot measure.
                 <span class="vl-warn">${outstanding} of ${items.length} still unassessed — each scores 0 until you set it.</span>`
              : `<b>All ${items.length} checks assessed.</b>
                 These are the judgements a profiler cannot make, and they carry
                 ${GRADE_CONFIG.maxChecklist} of the 100 marks.`
          }
        </p>
        <div class="vl-progress" role="img" aria-label="${assessed} of ${items.length} checks assessed">
          <span style="width:${pct}%"></span>
        </div>
      </div>

      ${items.map((c, i) => checkRow(c, report.checklist?.[c.id], i)).join('')}
    </section>`;
}

/** Re-renders just the validation section after a result changes. */
export function refreshChecklist(root, report, items, g) {
  const section = root.querySelector('#chk-h')?.closest('.section');
  if (!section) return;
  const assessed = Object.keys(report.checklist ?? {}).length;
  section.querySelector('.hint').textContent = checklistHint(assessed, items.length, g);
  section.querySelectorAll('.check-row').forEach((row, i) => {
    const c = items[i];
    const value = report.checklist?.[c.id];
    row.classList.toggle('done', !!value);
    row.classList.toggle('todo', !value);
    const state = row.querySelector('.check-state');
    state.className = `check-state ${value ?? 'unassessed'}`;
    state.textContent = value ? `${CHECK_STATE[value]} · ${checkMarks(value)}/5` : 'Unassessed · 0/5';
    const caption = row.querySelector('.seg-caption');
    if (caption) caption.textContent = value ? 'Result' : 'Select result';
    row.querySelectorAll('[data-check]').forEach((b) => {
      const on = value === b.dataset.val;
      b.className = on ? `on ${b.dataset.val}` : '';
      b.setAttribute('aria-pressed', String(on));
      b.disabled = false;
    });
  });
}

/* ---------------------------------------------------------------- header -- */

/** Identification line. Tester fields appear only when the profiler sent them. */
export function reportMetaHTML(report) {
  const bits = [
    report.testerName ? `<span>Tester <b>${esc(report.testerName)}</b></span>` : '',
    `<span>${platformPill(report.platform)}</span>`,
    `<span>Device <b>${esc(report.device ?? '—')}</b></span>`,
    `<span>Captured <b>${fmtDate(report.capturedAt)}</b></span>`,
  ];
  return bits.filter(Boolean).join('');
}
