/**
 * The local dashboard's XR test report.
 *
 * Same body as the hosted report — verdict, metrics, evaluation areas,
 * XR Health, Fix First, XR Doctor, charts, XR validation — plus the things
 * only a persistent local instance has: defect tracking and permanent delete.
 */
import api from '../api.js';
import { esc, fmtDate, toast, confirmDanger, openModal } from '../ui.js';
import { loadingState, emptyState, errorState, EMPTY } from '../states.js';
import { drawFpsChart, drawFrameTimeChart, drawMemoryChart, destroyAllCharts } from '../charts.js';
import { drawRings, countUp, revealStagger } from '../motion.js';
import { openBugForm, bugListHTML, wireBugList } from './bugs.js';
import {
  verdictHTML, metricsHTML, deviceStripHTML, chartsHTML, checklistHTML,
  refreshChecklist, reportMetaHTML,
} from '../report-view.js';
import { xrHealthHTML, fixFirstHTML, xrDoctorHTML, areaBreakdownHTML } from '../analysis.js';
import { computeGrade, isInvalidCapture } from '/shared/xr-metrics/index.js';

export async function renderSession(main, id) {
  destroyAllCharts();
  main.innerHTML = loadingState({ cards: 4, rows: 6, label: 'Loading XR test report' });

  let s;
  try {
    s = (await api.session(id)).session;
  } catch (err) {
    main.innerHTML = errorState(err, { retryId: 'retry' });
    main.querySelector('#retry')?.addEventListener('click', () => renderSession(main, id));
    return;
  }

  // Tester name is optional metadata; the shared view reads it.
  s.testerName = s.studentName;

  draw(main, id, s);
}

function draw(main, id, s) {
  const invalid = isInvalidCapture(s);
  const g = computeGrade(s, { checklist: s.checklist });
  const assessed = Object.keys(s.checklist).length;

  // Built once; where it is placed depends on whether the capture is valid.
  const verdict = verdictHTML(s, g, invalid);

  main.innerHTML = `
    <nav class="crumb" aria-label="Breadcrumb">
      <a href="#/projects/${s.projectId}">${esc(s.projectName)}</a>
      <span class="muted"> / </span>
      <a href="#/students/${s.studentRowId}">${esc(s.studentName)}</a>
    </nav>

    <div class="page-head">
      <div>
        <div class="eyebrow"><b>ImmersiTest</b> · XR Application Test Report</div>
        <h1>${esc(s.projectName)}</h1>
        <div class="meta">${reportMetaHTML(s)}</div>
      </div>
      <div class="actions">
        <button type="button" class="btn primary" id="btnPdf">Download PDF Report</button>
        <a class="btn" href="${api.rawUrl(id, true)}" download>Download JSON</a>
        <button type="button" class="btn" id="btnRaw">View Raw</button>
        <button type="button" class="btn danger" id="btnDel">Delete Report</button>
      </div>
    </div>

    ${deviceStripHTML(s, [['Report ID', s.id]])}

    <!-- Same reading order as the hosted report: profiler measures ->
         human validates -> score -> diagnose -> charts. An INVALID CAPTURE
         verdict leads instead, because it explains the missing measurements. -->
    ${invalid ? verdict : ''}

    ${invalid ? '' : metricsHTML(s)}

    ${checklistHTML(s, s.checklistItems, g)}

    ${invalid ? '' : verdict}

    ${invalid ? '' : areaBreakdownHTML(s)}

    ${xrHealthHTML(s)}
    ${fixFirstHTML(s)}
    ${xrDoctorHTML(s)}

    ${invalid ? '' : chartsHTML(s)}

    <section class="section" aria-labelledby="bug-h">
      <h3 id="bug-h">Defects <span class="hint">${s.bugs.length} on this application</span>
        <span class="h3-actions"><button type="button" class="btn sm" id="btnAddBug">Log Defect</button></span></h3>
      <div id="bugWrap">${s.bugs.length ? bugListHTML(s.bugs, { highlightSession: id }) : emptyState(EMPTY.bugs)}</div>
    </section>`;

  if (!invalid && s.series.length) {
    drawFpsChart(s.series, s.targetFps);
    drawFrameTimeChart(s.series, s.targetFps);
    drawMemoryChart(s.series);
  }

  revealStagger(main);
  countUp(main);
  drawRings(main);

  const reload = () => renderSession(main, id);

  main.querySelectorAll('[data-check]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const itemId = btn.dataset.check;
      const next = s.checklist[itemId] === btn.dataset.val ? null : btn.dataset.val;
      btn.disabled = true;
      try {
        const res = await api.setCheck(id, itemId, next);
        s.checklist = res.checklist;
        const next_g = computeGrade(s, { checklist: s.checklist });
        refreshChecklist(main, s, s.checklistItems, next_g);
        // Score, health, Fix First and Doctor all move with the checklist, so
        // the report is redrawn rather than patched in six places.
        destroyAllCharts();
        draw(main, id, s);
      } catch (err) {
        toast(err.userMessage ?? err.message, 'error');
        btn.disabled = false;
      }
    }),
  );

  main.querySelector('#btnPdf').addEventListener('click', async () => {
    const btn = main.querySelector('#btnPdf');
    btn.disabled = true;
    btn.textContent = 'Building PDF…';
    try {
      const { downloadReportPdf } = await import('../pdf.js');
      // Recomputed from the same shared module, so the PDF can never disagree
      // with what is on screen.
      await downloadReportPdf(s, computeGrade(s, { checklist: s.checklist }));
      toast('PDF report downloaded', 'success');
    } catch (err) {
      console.error('[pdf]', err);
      toast('Could not build the PDF report.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Download PDF Report';
    }
  });

  main.querySelector('#btnRaw').addEventListener('click', async () => {
    try {
      const text = await (await fetch(api.rawUrl(id))).text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch { /* show as-is */ }
      openModal({
        title: `Original Report — ${s.originalFilename ?? 'report.json'}`,
        wide: true,
        body: `<pre class="rawjson" tabindex="0">${esc(pretty)}</pre>`,
        footer: `<a class="btn" href="${api.rawUrl(id, true)}" download>Download</a>
                 <button type="button" class="btn ghost" data-close>Close</button>`,
      });
    } catch (err) {
      toast('Could not load the original report.', 'error');
      console.error(err);
    }
  });

  main.querySelector('#btnAddBug').addEventListener('click', () =>
    openBugForm(
      { projectId: s.projectId, sessionId: id, students: [{ id: s.studentRowId, studentName: s.studentName }] },
      reload,
    ),
  );
  wireBugList(main.querySelector('#bugWrap'), reload);

  main.querySelector('#btnDel').addEventListener('click', () =>
    confirmDanger({
      title: 'Delete This Test Report Permanently?',
      intro:
        'This will remove the saved metrics, charts, validation results, defects linked exclusively to this test, and the original JSON report from this PC.',
      lines: [
        ['Test session', 1],
        ['Performance samples', s.series.length],
        ['Validation results', assessed],
        ['Original JSON report', 1],
      ],
      confirmLabel: 'Delete Permanently',
      onConfirm: () => api.deleteSession(id),
      onDone: (res) => {
        toast(`Report deleted — ${res.samples} sample(s) and the original JSON removed`, 'success');
        location.hash = `#/projects/${s.projectId}`;
      },
    }),
  );
}
