import api from '../api.js';
import {
  esc, r1, r2, int, fmtDate, gradeBadge, judgementPill, platformPill, verdictOf,
} from '../ui.js';
import { loadingState, emptyState, errorState, EMPTY } from '../states.js';
import { dataTable, wireTable } from '../table.js';
import { drawTrendChart, destroyAllCharts } from '../charts.js';
import { openProjectForm, confirmProjectRemoval } from './forms.js';
import { openBugForm, bugListHTML, wireBugList } from './bugs.js';

export async function renderProject(main, id) {
  destroyAllCharts();
  main.innerHTML = loadingState({ cards: 0, rows: 8, label: 'Loading application' });

  let project;
  try {
    project = (await api.project(id)).project;
  } catch (err) {
    main.innerHTML = errorState(err, { retryId: 'retry' });
    main.querySelector('#retry')?.addEventListener('click', () => renderProject(main, id));
    return;
  }

  const sessions = project.sessions ?? [];
  const latest = sessions.length ? sessions[sessions.length - 1] : null;
  const v = verdictOf(latest);
  const validCount = sessions.filter((s) => s.captureStatus !== 'invalid').length;
  const openBugs = project.bugs.filter((b) => b.status === 'open' || b.status === 'in_progress');

  main.innerHTML = `
    <nav class="crumb" aria-label="Breadcrumb"><a href="#/projects">← Applications</a></nav>

    <div class="page-head">
      <div>
        <div class="eyebrow">Application</div>
        <h1>${esc(project.projectName)}
          ${project.status === 'archived' ? '<span class="pill archived">Archived</span>' : ''}</h1>
        <div class="meta">
          <span>${platformPill(project.platform)}</span>
          <span>Target <b>${project.targetFps} Hz</b></span>
          <span>Testers <b>${project.students.length}</b></span>
          <span>Test sessions <b>${sessions.length}</b></span>
          <span>Open defects <b>${openBugs.length}</b></span>
        </div>
        ${project.description ? `<p class="muted" style="margin-top:8px;font-size:13px">${esc(project.description)}</p>` : ''}
      </div>
      <div class="actions">
        <button type="button" class="btn" id="btnEdit">Edit</button>
        <button type="button" class="btn danger" id="btnRemove">Remove</button>
      </div>
    </div>

    ${
      latest
        ? `<div class="verdict ${v.key}">
            <div class="v-main">
              <div>
                <span class="v-label">Latest Result</span>
                <span class="v-status">${v.label}</span>
              </div>
              ${latest.gradeLetter ? gradeBadge(latest.gradeLetter, latest.gradeScore, 'lg') : ''}
            </div>
            <div class="v-sep" aria-hidden="true"></div>
            <div class="v-note">
              Captured ${fmtDate(latest.capturedAt)} by <b>${esc(latest.studentName)}</b>.
              ${latest.captureStatus === 'invalid'
                ? 'This capture recorded no frames, so it is not graded.'
                : `Average ${r1(latest.avgFps)} FPS against a ${latest.targetFps} Hz target.`}
            </div>
          </div>`
        : ''
    }

    <section class="section" aria-labelledby="stu-h">
      <h3 id="stu-h">Testers <span class="hint">${project.students.length} on this application</span></h3>
      ${
        project.students.length
          ? `<div class="chip-row">${project.students
              .map(
                (s) => `<a class="entity-chip" href="#/students/${s.id}">
                    <b>${esc(s.studentName)}</b>
                    <span class="muted">${s.sessionCount} test(s)</span>
                  </a>`,
              )
              .join('')}</div>`
          : emptyState(EMPTY.projectStudents)
      }
    </section>

    ${
      validCount >= 2
        ? `<section class="section" aria-labelledby="trend-h">
            <h3 id="trend-h">Performance Trend <span class="hint">${validCount} valid captures, oldest first</span></h3>
            <div class="chartwrap"><canvas id="trendChart" role="img"
              aria-label="Average FPS and 1% low FPS across ${validCount} test sessions"></canvas></div>
          </section>`
        : ''
    }

    <section class="section" aria-labelledby="hist-h">
      <h3 id="hist-h">Test History
        <span class="hint">${sessions.length} session(s) · oldest first · nothing is overwritten</span></h3>
      <div id="histWrap"></div>
    </section>

    <section class="section" aria-labelledby="bug-h">
      <h3 id="bug-h">Defects <span class="hint">${project.bugs.length} logged</span>
        <span class="h3-actions"><button type="button" class="btn sm" id="btnAddBug">Log Defect</button></span></h3>
      <div id="bugWrap">${project.bugs.length ? bugListHTML(project.bugs) : emptyState(EMPTY.bugs)}</div>
    </section>`;

  const histWrap = main.querySelector('#histWrap');
  if (!sessions.length) {
    histWrap.innerHTML = emptyState({
      ...EMPTY.projectSessions,
      actions: ['<a class="btn primary" href="#/import">Import Report</a>'],
    });
  } else {
    histWrap.innerHTML = dataTable({
      caption: `Test history for ${project.projectName}`,
      columns: [
        { key: 'n', label: 'Test', sortable: false, render: (r) => `<span class="cell-strong">#${r.__n}</span>` },
        { key: 'studentName', label: 'Tester', sortable: false, render: (r) => esc(r.studentName) },
        { key: 'capturedAt', label: 'Date', sortable: false, render: (r) => fmtDate(r.capturedAt) },
        { key: 'platform', label: 'Platform', sortable: false, render: (r) => platformPill(r.platform) },
        { key: 'avgFps', label: 'Avg FPS', num: true, sortable: false, render: (r) => (r.captureStatus === 'invalid' ? '—' : r1(r.avgFps)) },
        { key: 'ms', label: 'Frame Time', num: true, sortable: false, render: (r) => (r.captureStatus === 'invalid' ? '—' : `${r2(r.avgFrameMs)} ms`) },
        { key: 'mem', label: 'Memory', num: true, sortable: false, render: (r) => (r.memoryMB > 0 ? `${int(r.memoryMB)} MB` : '—') },
        { key: 'grade', label: 'Grade', sortable: false, render: (r) => gradeBadge(r.gradeLetter, r.gradeScore) },
        { key: 'status', label: 'Status', sortable: false, render: (r) => judgementPill(r.captureStatus, r.performanceStatus) },
      ],
      rows: sessions.map((s, i) => ({ ...s, __n: i + 1, __label: `Open test #${i + 1}` })),
      rowHref: (r) => `#/sessions/${r.id}`,
    });
    wireTable(histWrap);
  }

  if (validCount >= 2) drawTrendChart(sessions, project.targetFps);

  const reload = () => renderProject(main, id);
  main.querySelector('#btnEdit').addEventListener('click', () => openProjectForm(project, reload));
  main.querySelector('#btnRemove').addEventListener('click', () =>
    confirmProjectRemoval(project, (kind) => {
      if (kind === 'permanent') location.hash = '#/projects';
      else reload();
    }),
  );
  main.querySelector('#btnAddBug').addEventListener('click', () =>
    openBugForm({ projectId: project.id, students: project.students }, reload),
  );
  wireBugList(main.querySelector('#bugWrap'), reload);
}
