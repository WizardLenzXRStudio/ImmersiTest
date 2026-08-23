/**
 * XR Health, Fix First, XR Doctor, Recommendations, Comparison and Trend.
 *
 * Pure markup builders over the shared evaluation module, so the hosted report,
 * the local report and the PDF all describe a capture the same way. Nothing
 * here invents a conclusion: every line traces back to a captured number or a
 * recorded validation result.
 */
import { esc, r1, r2 } from './ui.js';
import {
  xrHealth, xrDoctor, fixFirst, recommendations, areaBreakdown,
  compareReports, HEALTH_LABEL, badFramePct,
} from '/shared/xr-metrics/index.js';

/**
 * Ranks the already-generated findings for display: Fix First is 01, and the
 * remaining recommendations follow as 02, 03. This is presentation only — it
 * re-orders existing strings and never derives a new conclusion.
 */
function priorityQueue(report, ctx, primary) {
  const recs = recommendations(report, ctx).filter((r) => r.severity !== 'info');
  const seen = primary ? primary.title.toLowerCase() : '';
  const rest = recs.filter((r) => !seen || !r.title.toLowerCase().includes(seen.split(' ').slice(-2).join(' ')));
  return rest.slice(0, 2);
}

/* ------------------------------------------------------------- xr health -- */

export function xrHealthHTML(report) {
  const health = xrHealth(report, { checklist: report.checklist ?? {} });
  const rows = [...health.rows, health.overall];

  return `
    <section class="section" aria-labelledby="health-h">
      <h3 id="health-h">XR Health
        <span class="scan-tag" aria-hidden="true">Health Status</span>
        <span class="hint">condition by area, from this capture only</span></h3>
      <div class="health-grid">
        ${rows
          .map(
            (r) => `<div class="health-row ${r.state}${r.id === 'overall' ? ' overall' : ''}">
              <div class="h-label">${esc(r.label)}</div>
              <div class="h-state"><span class="dot" aria-hidden="true"></span>${esc(HEALTH_LABEL[r.state])}</div>
              <div class="h-detail">${esc(r.detail)}</div>
            </div>`,
          )
          .join('')}
      </div>
    </section>`;
}

/* ------------------------------------------------------------- fix first -- */

export function fixFirstHTML(report) {
  const fix = fixFirst(report, { checklist: report.checklist ?? {} });

  if (!fix) {
    return `
      <section class="section" aria-labelledby="fix-h">
        <h3 id="fix-h">Fix First</h3>
        <div class="fixfirst clear">
          <div class="ff-head">
            <span class="ff-tag">Nothing blocking</span>
            <span class="ff-title">No priority issue in this capture</span>
          </div>
          <p class="ff-evidence">Every scored metric and every assessed validation item passed. Re-test on target
            hardware, and with a longer session, to confirm the result holds.</p>
        </div>
      </section>`;
  }

  const next = priorityQueue(report, { checklist: report.checklist ?? {} }, fix);

  return `
    <section class="section" aria-labelledby="fix-h">
      <h3 id="fix-h">Fix First <span class="hint">work down this list, in order</span></h3>
      <div class="fixfirst ${fix.severity}" data-rank="01">
        <div class="ff-head">
          <span class="ff-tag">${fix.severity === 'critical' ? 'Critical' : 'Needs attention'}</span>
          <span class="ff-title">${esc(fix.title)}</span>
        </div>

        <div class="ff-block">
          <div class="ff-label">Evidence</div>
          <p class="ff-evidence">${esc(fix.evidence)}</p>
        </div>

        ${
          fix.investigate?.length
            ? `<div class="ff-block">
                <div class="ff-label">Recommended investigation</div>
                <ul class="ff-list">${fix.investigate.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
                <p class="ff-caveat">These are possible areas to investigate, not confirmed causes. This profiler
                  measures frame timing and memory from inside the application; it cannot attribute a spike to a
                  specific system.</p>
              </div>`
            : ''
        }
        ${fix.note ? `<p class="ff-caveat">${esc(fix.note)}</p>` : ''}
      </div>

      ${next.length
        ? `<ol class="ff-next">${next
            .map(
              (r, i) => `<li class="ffn ${r.severity}">
                <span class="ffn-n">${String(i + 2).padStart(2, '0')}</span>
                <span class="ffn-body"><b>${esc(r.title)}</b><span>${esc(r.detail)}</span></span>
              </li>`,
            )
            .join('')}</ol>`
        : ''}
    </section>`;
}

/* ------------------------------------------------------------- xr doctor -- */

export function xrDoctorHTML(report) {
  const rows = xrDoctor(report, { checklist: report.checklist ?? {} });
  const recs = recommendations(report, { checklist: report.checklist ?? {} });

  return `
    <section class="section" aria-labelledby="doc-h">
      <h3 id="doc-h">XR Doctor <span class="hint">developer-facing readout</span></h3>

      <div class="doc-legend" aria-hidden="true">
        <span>Observation</span><i>→</i><span>Likely investigation area</span><i>→</i><span>Recommended next step</span>
      </div>

      <div class="doctor">
        ${rows
          .map(
            (r) => `<div class="doc-row ${r.state}">
              <span class="doc-area">${esc(r.label)}</span>
              <span class="doc-verdict"><span class="dot" aria-hidden="true"></span>${esc(HEALTH_LABEL[r.state])}</span>
              <span class="doc-detail">${esc(r.detail)}</span>
            </div>`,
          )
          .join('')}
      </div>

      <h4 class="sub-h">Recommendations</h4>
      <ul class="reco">
        ${recs
          .map(
            (r) => `<li class="reco-${r.severity}">
              <b>${esc(r.title)}</b>
              <span>${esc(r.detail)}</span>
            </li>`,
          )
          .join('')}
      </ul>
    </section>`;
}

/* --------------------------------------------------------- area breakdown -- */

export function areaBreakdownHTML(report) {
  const areas = areaBreakdown(report, { checklist: report.checklist ?? {} });
  if (!areas) return '';

  return `
    <section class="section" aria-labelledby="area-h">
      <h3 id="area-h">Evaluation Areas
        <span class="hint">how the same 100 marks group by theme — not a second score</span></h3>
      <div class="area-grid">
        ${areas
          .map(
            (a) => `<div class="area">
              <div class="a-top">
                <span class="a-label">${esc(a.label)}</span>
                <span class="a-marks">${a.earned}<small>/${a.max}</small></span>
              </div>
              <div class="a-bar"><span style="width:${a.pct}%"></span></div>
              <div class="a-blurb">${esc(a.blurb)}</div>
            </div>`,
          )
          .join('')}
      </div>
      <p class="muted area-note">
        Technical Performance is the 60-mark Performance Score (the four measured metrics).
        The remaining 40 marks are the eight XR Validation items, grouped above by theme.
        These buckets classify the same 100 marks — they do not add to them.
      </p>
    </section>`;
}

/* ------------------------------------------------------------ comparison -- */

const DIRECTION_LABEL = {
  improved: 'Improved',
  regressed: 'Regressed',
  unchanged: 'Unchanged',
  unknown: '—',
};

const fmtCompare = (v, f) => {
  if (v == null || Number.isNaN(v)) return '—';
  const n = Number(v).toFixed(f.dp);
  return f.unit === '/100' ? `${n}/100` : `${n}${f.unit ? ` ${f.unit}` : ''}`;
};

/**
 * Compares the newest report against the one before it.
 * Renders nothing when a session holds a single report.
 */
export function comparisonHTML(reports, gradeOf) {
  if (!reports || reports.length < 2) return '';

  const current = reports[reports.length - 1];
  const baseline = reports[reports.length - 2];

  const withGrade = (r) => ({ ...r, metrics: r, grade: gradeOf(r) });
  const rows = compareReports(withGrade(baseline), withGrade(current));

  const label = (r, i) =>
    `${esc(r.projectName)} · ${new Date(r.capturedAt).toLocaleDateString()} (test ${i + 1})`;

  return `
    <section class="section" aria-labelledby="cmp-h">
      <h3 id="cmp-h">Test Comparison
        <span class="hint">newest against the previous report in this analysis</span></h3>
      <div class="cmp-meta">
        <span>Baseline <b>${label(baseline, reports.length - 2)}</b></span>
        <span>Current <b>${label(current, reports.length - 1)}</b></span>
      </div>
      <div class="ctable-wrap">
        <table class="ctable">
          <caption class="sr-only">Metric comparison between the two most recent reports</caption>
          <thead><tr>
            <th scope="col"><span class="sortbtn">Metric</span></th>
            <th scope="col" class="num"><span class="sortbtn">Baseline</span></th>
            <th scope="col" class="num"><span class="sortbtn">Current</span></th>
            <th scope="col" class="num"><span class="sortbtn">Change</span></th>
            <th scope="col"><span class="sortbtn">Result</span></th>
          </tr></thead>
          <tbody>
            ${rows
              .map((row) => {
                const delta =
                  row.delta == null
                    ? '—'
                    : `${row.delta > 0 ? '+' : ''}${Number(row.delta).toFixed(row.dp)}`;
                return `<tr>
                  <td><span class="cell-strong">${esc(row.label)}</span></td>
                  <td class="num">${fmtCompare(row.from, row)}</td>
                  <td class="num">${fmtCompare(row.to, row)}</td>
                  <td class="num">${delta}</td>
                  <td><span class="trend ${row.direction}">${DIRECTION_LABEL[row.direction]}</span></td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    </section>`;
}

/* ----------------------------------------------------------------- trend -- */

/**
 * Performance trend across every valid report of the SAME application held in
 * this analysis. Nothing is persisted to produce it.
 */
export function trendHTML(reports) {
  const valid = reports.filter((r) => r.captureStatus !== 'invalid');
  if (valid.length < 2) return '';

  return `
    <section class="section" aria-labelledby="trend-h">
      <h3 id="trend-h">Performance Trend
        <span class="hint">${valid.length} valid captures in this analysis, oldest first</span></h3>
      <div class="chartwrap"><canvas id="trendChart" role="img"
        aria-label="Average FPS and 1% low FPS across ${valid.length} captures"></canvas></div>
    </section>`;
}

/** Compact per-report strip used above the trend chart. */
export function reportStripHTML(reports, activeId) {
  if (reports.length < 2) return '';
  return `<div class="chip-row report-strip">
    ${reports
      .map((r, i) => {
        const drop = badFramePct(r);
        return `<button type="button" class="entity-chip${r.id === activeId ? ' on' : ''}"
            data-report="${esc(r.id)}" aria-pressed="${r.id === activeId}">
          <b>Test ${i + 1} · ${esc(r.projectName)}</b>
          <span class="muted">${
            r.captureStatus === 'invalid'
              ? 'invalid capture'
              : `${r1(r.avgFps)} FPS · ${drop == null ? '—' : `${r2(drop)}% bad`}`
          }</span>
        </button>`;
      })
      .join('')}
  </div>`;
}
