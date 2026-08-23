/**
 * The hosted ImmersiTest report — the page the Unity package opens.
 *
 * Everything on screen comes from one temporary analysis session addressed by
 * an unguessable token. Nothing is stored on the server beyond that session's
 * expiry, and the page says so plainly rather than burying it.
 */
import api from '../api.js';
import { esc, r1, fmtDate, toast, openModal, confirmDanger } from '../ui.js';
import { loadingState, errorState } from '../states.js';
import { drawFpsChart, drawFrameTimeChart, drawMemoryChart, drawTrendChart, destroyAllCharts } from '../charts.js';
import { drawRings, countUp, revealStagger } from '../motion.js';
import {
  verdictHTML, metricsHTML, deviceStripHTML, chartsHTML, checklistHTML,
  refreshChecklist, reportMetaHTML, unassessedCount,
} from '../report-view.js';
import {
  xrHealthHTML, fixFirstHTML, xrDoctorHTML, areaBreakdownHTML,
  comparisonHTML, trendHTML, reportStripHTML,
} from '../analysis.js';
import { computeGrade, isInvalidCapture } from '/shared/xr-metrics/index.js';

let expiryTimer = null;

export async function renderReport(main, token) {
  destroyAllCharts();
  clearInterval(expiryTimer);
  main.innerHTML = loadingState({ cards: 4, rows: 6, label: 'Loading XR test report' });

  let session;
  try {
    session = (await api.analysis(token)).session;
  } catch (err) {
    main.innerHTML = err.code === 'SESSION_EXPIRED' ? expiredState(err) : errorState(err, { retryId: 'retry' });
    main.querySelector('#retry')?.addEventListener('click', () => renderReport(main, token));
    return;
  }

  if (!session.reports.length) {
    main.innerHTML = expiredState({ userMessage: 'This analysis contains no reports.' });
    return;
  }

  // Newest report is the one under inspection; the strip switches between them.
  const activeId = session.__activeId ?? session.reports[session.reports.length - 1].id;
  draw(main, token, session, activeId);
}

function expiredState(err) {
  return `
    <div class="state error" role="alert">
      <div class="state-title">This analysis has expired</div>
      <p class="state-msg">${esc(err.userMessage ?? 'Temporary reports are deleted automatically.')}</p>
      <p class="state-msg muted">ImmersiTest does not keep your reports. Run the test again from Unity
        (<b>ImmersiTest → Run XR Test</b>) to produce a new analysis.</p>
      <div class="state-actions"><a class="btn primary" href="#/">Back to ImmersiTest</a></div>
    </div>`;
}

function draw(main, token, session, activeId) {
  const reports = session.reports;
  const report = reports.find((r) => r.id === activeId) ?? reports[reports.length - 1];
  const invalid = isInvalidCapture(report);
  const g = computeGrade(report, { checklist: report.checklist });

  // Built once; where it is placed depends on whether the capture is valid.
  const verdict = verdictHTML(report, g, invalid);

  // Trend and comparison only consider the same application.
  const sameApp = reports.filter((r) => r.projectName === report.projectName);
  const gradeOf = (r) => computeGrade(r, { checklist: r.checklist });

  main.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow"><b>ImmersiTest</b> · XR Application Test Report</div>
        <h1>${esc(report.projectName)}</h1>
        <div class="meta">${reportMetaHTML(report)}</div>
      </div>
      <div class="actions">
        <button type="button" class="btn primary" id="btnPdf">Download PDF Report</button>
        <button type="button" class="btn" id="btnAdd">Add Another Report</button>
        <button type="button" class="btn danger" id="btnDelete">Delete Analysis Now</button>
      </div>
    </div>

    <div class="retention" id="retention">
      <span class="ret-dot" aria-hidden="true"></span>
      <span class="ret-text">
        <b>Temporary analysis.</b> This report is held in memory on the server and is deleted
        automatically. Only the generated profiler JSON was uploaded — no project files, source,
        scenes or assets. Download the PDF if you want to keep it.
      </span>
      <span class="ret-timer" id="expiry" aria-live="polite"></span>
    </div>

    ${reportStripHTML(reports, report.id)}

    ${deviceStripHTML(report, [['Report ID', report.id]])}

    <!-- The report tells one story, in this order:
         profiler measures -> human validates -> score -> diagnose -> charts.
         XR Validation carries 40 of the 100 marks, so it is read BEFORE the
         score rather than discovered afterwards.

         An INVALID CAPTURE is the exception: that verdict explains why there
         are no measurements at all, so it has to come first or the checklist
         reads as though the test succeeded. Rendered once either way. -->
    ${invalid ? verdict : ''}

    ${invalid ? '' : metricsHTML(report)}

    ${checklistHTML(report, session.checklistItems, g)}

    ${invalid ? '' : verdict}

    ${invalid ? '' : areaBreakdownHTML(report)}

    ${xrHealthHTML(report)}
    ${fixFirstHTML(report)}
    ${xrDoctorHTML(report)}

    ${invalid ? '' : chartsHTML(report)}

    ${comparisonHTML(sameApp, gradeOf)}
    ${trendHTML(sameApp)}

    ${
      report.warnings?.length
        ? `<section class="section"><h3>Import Notes</h3>
            <ul class="reco">${report.warnings.map((w) => `<li class="reco-info"><span>${esc(w)}</span></li>`).join('')}</ul>
          </section>`
        : ''
    }

    <section class="section finish" aria-labelledby="done-h">
      <h3 id="done-h">Download Your Report</h3>
      <p class="muted" style="font-size:13.5px;line-height:1.6;margin-bottom:14px">
        The PDF carries the whole assessment — score, performance, XR validation, XR Health,
        Fix First, XR Doctor, recommendations and charts. This analysis is temporary, so
        download it if you want to keep it.
      </p>
      <button type="button" class="btn primary" id="btnPdfBottom">Download PDF Report</button>
    </section>`;

  if (!invalid && report.series?.length) {
    drawFpsChart(report.series, report.targetFps);
    drawFrameTimeChart(report.series, report.targetFps);
    drawMemoryChart(report.series);
  }
  if (sameApp.filter((r) => r.captureStatus !== 'invalid').length >= 2) {
    drawTrendChart(sameApp, report.targetFps);
  }

  revealStagger(main);
  countUp(main);
  drawRings(main);

  startExpiryClock(main, session);
  wire(main, token, session, report);
}

/* ----------------------------------------------------------------- wiring -- */

function wire(main, token, session, report) {
  const reload = (activeId = report.id) =>
    api
      .analysis(token)
      .then((r) => draw(main, token, { ...r.session, __activeId: activeId }, activeId))
      .catch((err) => {
        main.innerHTML = err.code === 'SESSION_EXPIRED' ? expiredState(err) : errorState(err);
      });

  main.querySelectorAll('[data-report]').forEach((btn) =>
    btn.addEventListener('click', () => {
      destroyAllCharts();
      draw(main, token, session, btn.dataset.report);
    }),
  );

  main.querySelectorAll('[data-check]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const itemId = btn.dataset.check;
      const next = report.checklist[itemId] === btn.dataset.val ? null : btn.dataset.val;
      btn.disabled = true;
      try {
        const res = await api.setHostedCheck(token, report.id, itemId, next);
        report.checklist = res.checklist;
        const g = computeGrade(report, { checklist: report.checklist });
        refreshChecklist(main, report, session.checklistItems, g);
        // Score, health, Fix First and Doctor all move with the checklist.
        draw(main, token, session, report.id);
      } catch (err) {
        toast(err.userMessage ?? err.message, 'error');
        btn.disabled = false;
      }
    }),
  );

  const buildPdf = async (btn) => {
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'Building PDF…';
    try {
      const { downloadReportPdf } = await import('../pdf.js');
      await downloadReportPdf(report, computeGrade(report, { checklist: report.checklist }));
      toast('PDF report downloaded', 'success');
    } catch (err) {
      console.error('[pdf]', err);
      toast('Could not build the PDF report.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  };

  // Unassessed items score zero, so exporting with gaps understates the result.
  // The user is told, and can still proceed — this warns, it does not block.
  const onExport = (btn) => {
    const outstanding = unassessedCount(report, session.checklistItems);
    if (!outstanding) return buildPdf(btn);
    return confirmIncomplete(outstanding, session.checklistItems.length, () => buildPdf(btn));
  };

  main.querySelectorAll('#btnPdf, #btnPdfBottom').forEach((btn) =>
    btn.addEventListener('click', () => onExport(btn)),
  );

  main.querySelector('#btnAdd').addEventListener('click', () => openAddDialog(token, reload));

  main.querySelector('#btnDelete').addEventListener('click', () =>
    confirmDanger({
      title: 'Delete This Analysis Now?',
      intro:
        'The temporary analysis and every report in it will be removed from the server immediately. Downloaded PDFs and JSON files on your own machine are unaffected.',
      lines: [['Reports in this analysis', session.reports.length]],
      confirmLabel: 'Delete Now',
      onConfirm: () => api.deleteAnalysis(token),
      onDone: () => {
        toast('Analysis deleted', 'success');
        location.hash = '#/';
      },
    }),
  );
}

/**
 * Warns that the XR validation checklist is incomplete before exporting.
 * Deliberately non-blocking: the user may have good reason to export early.
 */
function confirmIncomplete(outstanding, total, proceed) {
  openModal({
    title: 'XR Validation Incomplete',
    body: `
      <p class="danger-intro">
        <b>${outstanding} of ${total}</b> XR validation checks have not been assessed.
      </p>
      <p class="muted" style="font-size:13px;line-height:1.6;margin-top:10px">
        Unassessed items score <b>0</b>, so the quality score in this PDF will understate the
        application. Assessing them takes a moment and makes the report accurate.
      </p>`,
    footer: `<button type="button" class="btn primary" data-close>Go Back and Assess</button>
             <button type="button" class="btn ghost" data-anyway>Download Anyway</button>`,
    onMount(root, close) {
      root.querySelector('[data-anyway]').addEventListener('click', () => {
        close();
        proceed();
      });
    },
  });
}

/** Adds another profiler JSON to this analysis, enabling comparison and trend. */
function openAddDialog(token, reload) {
  openModal({
    title: 'Add Another Report',
    body: `
      <p class="muted" style="font-size:13px;margin-bottom:12px">
        Add another <code>xrtest_*.json</code> to this analysis to compare runs and see a performance trend.
        Reports stay temporary and expire with the rest of the analysis.
      </p>
      <div class="dropzone compact" id="addDrop">
        <p><b>Drop a profiler JSON here</b></p>
        <p class="muted" style="font-size:13px;margin:6px 0 12px">or</p>
        <button type="button" class="btn primary" id="addPick">Choose File</button>
        <label for="addInput" class="sr-only">Choose profiler JSON files</label>
        <input type="file" id="addInput" accept=".json,application/json" multiple hidden>
      </div>
      <div id="addStatus" aria-live="polite"></div>`,
    footer: '<button type="button" class="btn ghost" data-close>Close</button>',
    onMount(root, close) {
      const input = root.querySelector('#addInput');
      const drop = root.querySelector('#addDrop');
      const status = root.querySelector('#addStatus');

      const send = async (files) => {
        const list = [...files].filter((f) => f.name.toLowerCase().endsWith('.json'));
        if (!list.length) {
          status.innerHTML = '<p class="field-error show">Only .json profiler reports can be added.</p>';
          return;
        }
        status.innerHTML = `<p class="muted" style="font-size:13px">Uploading ${list.length} report(s)…</p>`;

        let added = 0;
        const failures = [];
        for (const file of list) {
          try {
            const text = await file.text();
            await api.addAnalysisReport(token, JSON.parse(text), file.name);
            added++;
          } catch (err) {
            failures.push(`${file.name}: ${err.userMessage ?? err.message}`);
          }
        }

        if (added) toast(`${added} report(s) added`, 'success');
        if (failures.length) {
          status.innerHTML = `<ul class="reco">${failures.map((f) => `<li class="reco-critical"><span>${esc(f)}</span></li>`).join('')}</ul>`;
        } else {
          close();
        }
        if (added) reload();
      };

      root.querySelector('#addPick').addEventListener('click', () => input.click());
      input.addEventListener('change', () => {
        send(input.files);
        input.value = '';
      });
      ['dragenter', 'dragover'].forEach((ev) =>
        drop.addEventListener(ev, (e) => {
          e.preventDefault();
          drop.classList.add('over');
        }),
      );
      ['dragleave', 'drop'].forEach((ev) =>
        drop.addEventListener(ev, (e) => {
          e.preventDefault();
          drop.classList.remove('over');
        }),
      );
      drop.addEventListener('drop', (e) => send(e.dataTransfer?.files ?? []));
    },
  });
}

/* ---------------------------------------------------------------- expiry -- */

function startExpiryClock(main, session) {
  const el = main.querySelector('#expiry');
  if (!el) return;
  const expiresAt = new Date(session.expiresAt).getTime();

  const tick = () => {
    const left = Math.max(0, expiresAt - Date.now());
    if (left <= 0) {
      clearInterval(expiryTimer);
      el.textContent = 'Expired';
      el.classList.add('gone');
      main.querySelector('#retention')?.classList.add('expired');
      return;
    }
    const mins = Math.floor(left / 60000);
    const secs = Math.floor((left % 60000) / 1000);
    el.textContent = `Deletes in ${mins}:${String(secs).padStart(2, '0')}`;
  };

  tick();
  clearInterval(expiryTimer);
  expiryTimer = setInterval(tick, 1000);
}

/** Called by the router when leaving the page. */
export function disposeReport() {
  clearInterval(expiryTimer);
  expiryTimer = null;
}

export const _internal = { r1 };
