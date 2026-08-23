import api from '../api.js';
import { esc, r1, fmtRelative, fmtDate, gradeBadge, judgementPill, platformPill, verdictOf } from '../ui.js';
import { loadingState, emptyState, errorState, EMPTY } from '../states.js';
import { dataTable, wireTable, sortRows, nextSort } from '../table.js';
import { openStudentForm, confirmStudentRemoval } from './forms.js';
import { drawTrendChart, destroyAllCharts } from '../charts.js';

const NUMERIC = new Set(['projectCount', 'sessionCount', 'latestAvgFps']);
const filters = { q: '', projectId: '', status: 'active' };
let sort = { key: 'studentName', dir: 'asc' };
let cache = [];
let projects = [];

/* ------------------------------------------------------------- list ----- */

export async function renderStudents(main) {
  main.innerHTML = loadingState({ rows: 8, label: 'Loading testers' });

  try {
    [cache, projects] = await Promise.all([
      api.students(true).then((r) => r.students),
      api.projects(true).then((r) => r.projects),
    ]);
  } catch (err) {
    main.innerHTML = errorState(err, { retryId: 'retry' });
    main.querySelector('#retry')?.addEventListener('click', () => renderStudents(main));
    return;
  }

  // Which students belong to which application — used by the project filter.
  const membership = new Map();
  await Promise.all(
    (filters.projectId ? [filters.projectId] : []).map(async (pid) => {
      try {
        const p = (await api.project(pid)).project;
        membership.set(pid, new Set(p.students.map((s) => s.id)));
      } catch { /* filter falls back to showing everyone */ }
    }),
  );

  main.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">Directory</div>
        <h1>Testers</h1>
        <div class="meta"><span class="muted">Everyone who has captured a test</span></div>
      </div>
      <div class="actions"><button type="button" class="btn primary" id="btnNew">New Tester</button></div>
    </div>

    <section class="section">
      <div class="toolbar">
        <div class="field-inline grow">
          <label for="fq">Search</label>
          <input class="search" id="fq" type="search" placeholder="Tester name…" value="${esc(filters.q)}">
        </div>
        <div class="field-inline">
          <label for="fproj">Application</label>
          <select class="selectbox" id="fproj">
            <option value="">All</option>
            ${projects.map((p) => `<option value="${esc(p.id)}">${esc(p.projectName)}</option>`).join('')}
          </select>
        </div>
        <div class="field-inline">
          <label for="fstat">Status</label>
          <select class="selectbox" id="fstat">
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="">All</option>
          </select>
        </div>
      </div>
      <div id="tableWrap" aria-live="polite"></div>
    </section>`;

  main.querySelector('#fproj').value = filters.projectId;
  main.querySelector('#fstat').value = filters.status;

  main.querySelector('#btnNew').addEventListener('click', () => openStudentForm(null, () => renderStudents(main)));
  main.querySelector('#fq').addEventListener('input', (e) => {
    filters.q = e.target.value;
    draw(main, membership);
  });
  main.querySelector('#fproj').addEventListener('change', (e) => {
    filters.projectId = e.target.value;
    renderStudents(main);
  });
  main.querySelector('#fstat').addEventListener('change', (e) => {
    filters.status = e.target.value;
    draw(main, membership);
  });

  draw(main, membership);
}

function draw(main, membership) {
  const wrap = main.querySelector('#tableWrap');
  const q = filters.q.trim().toLowerCase();
  const inProject = filters.projectId ? membership.get(filters.projectId) : null;

  const rows = cache.filter(
    (s) =>
      (!q || s.studentName.toLowerCase().includes(q)) &&
      (!filters.status || s.status === filters.status) &&
      (!inProject || inProject.has(s.id)),
  );

  if (!rows.length) {
    const filtered = q || filters.projectId || filters.status !== 'active';
    wrap.innerHTML = emptyState(filtered ? EMPTY.studentsFiltered : EMPTY.students);
    return;
  }

  wrap.innerHTML = dataTable({
    caption: 'Testers and their latest test result',
    sort,
    columns: [
      {
        key: 'studentName',
        label: 'Tester',
        render: (r) =>
          `<span class="cell-strong">${esc(r.studentName)}</span>` +
          (r.status === 'archived' ? ' <span class="pill archived">Archived</span>' : ''),
      },
      { key: 'projectCount', label: 'Applications', num: true, render: (r) => r.projectCount },
      { key: 'sessionCount', label: 'Test Sessions', num: true, render: (r) => r.sessionCount },
      { key: 'latestGrade', label: 'Latest Grade', render: (r) => gradeBadge(r.latestGrade) },
      { key: 'latestCapturedAt', label: 'Latest Test', render: (r) => fmtRelative(r.latestCapturedAt) },
      { key: 'latestStatus', label: 'Status', render: (r) => (r.latestSessionId ? judgementPill(null, r.latestStatus) : '<span class="pill none">—</span>') },
    ],
    rows: sortRows(rows, sort).map((s) => ({ ...s, __label: `Open ${s.studentName}` })),
    rowHref: (r) => `#/students/${r.id}`,
    rowClass: (r) => (r.status === 'archived' ? 'row-archived' : ''),
  });

  wireTable(wrap, (key) => {
    sort = nextSort(sort, key, NUMERIC);
    draw(main, membership);
  });
}

/* ----------------------------------------------------------- detail ----- */

export async function renderStudent(main, id) {
  destroyAllCharts();
  main.innerHTML = loadingState({ rows: 7, label: 'Loading tester' });

  let s;
  try {
    s = (await api.student(id)).student;
  } catch (err) {
    main.innerHTML = errorState(err, { retryId: 'retry' });
    main.querySelector('#retry')?.addEventListener('click', () => renderStudent(main, id));
    return;
  }

  const sessions = s.sessions ?? [];
  const latest = sessions.length ? sessions[sessions.length - 1] : null;
  const v = verdictOf(latest);
  const validCount = sessions.filter((x) => x.captureStatus !== 'invalid').length;

  // Group sessions by application so multi-project students stay readable.
  const byProject = new Map();
  for (const x of sessions) {
    if (!byProject.has(x.projectRowId)) byProject.set(x.projectRowId, { name: x.projectName, items: [] });
    byProject.get(x.projectRowId).items.push(x);
  }

  main.innerHTML = `
    <nav class="crumb" aria-label="Breadcrumb"><a href="#/students">← Testers</a></nav>

    <div class="page-head">
      <div>
        <div class="eyebrow">Tester</div>
        <h1>${esc(s.studentName)}
          ${s.status === 'archived' ? '<span class="pill archived">Archived</span>' : ''}</h1>
        <div class="meta">
          ${s.email ? `<span>Email <b>${esc(s.email)}</b></span>` : ''}
          <span>Applications <b>${s.projects.length}</b></span>
          <span>Test sessions <b>${sessions.length}</b></span>
        </div>
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
              <div><span class="v-label">Latest Result</span><span class="v-status">${v.label}</span></div>
              ${latest.gradeLetter ? gradeBadge(latest.gradeLetter, latest.gradeScore, 'lg') : ''}
            </div>
            <div class="v-sep" aria-hidden="true"></div>
            <div class="v-note">${esc(latest.projectName)} · captured ${fmtDate(latest.capturedAt)}</div>
          </div>`
        : ''
    }

    <section class="section" aria-labelledby="app-h">
      <h3 id="app-h">Applications <span class="hint">${s.projects.length}</span></h3>
      ${
        s.projects.length
          ? `<div class="chip-row">${s.projects
              .map(
                (p) => `<a class="entity-chip" href="#/projects/${p.id}">
                  <b>${esc(p.projectName)}</b>
                  <span class="muted">${p.platform} · ${p.targetFps} Hz · ${p.sessionCount} test(s)</span></a>`,
              )
              .join('')}</div>`
          : `<p class="muted" style="font-size:13px">Not linked to an application yet.</p>`
      }
    </section>

    ${
      validCount >= 2
        ? `<section class="section" aria-labelledby="ph-h">
            <h3 id="ph-h">Performance History <span class="hint">across all applications</span></h3>
            <div class="chartwrap"><canvas id="trendChart" role="img"
              aria-label="Average FPS and 1% low across ${validCount} sessions"></canvas></div>
          </section>`
        : ''
    }

    <div id="sessionGroups"></div>`;

  const groups = main.querySelector('#sessionGroups');
  if (!sessions.length) {
    groups.innerHTML = `<section class="section">${emptyState(EMPTY.studentSessions)}</section>`;
  } else {
    groups.innerHTML = [...byProject.entries()]
      .map(
        ([pid, g], gi) => `<section class="section" aria-labelledby="g-${gi}">
          <h3 id="g-${gi}">${esc(g.name)} <span class="hint">${g.items.length} test session(s)</span>
            <span class="h3-actions"><a class="btn sm" href="#/projects/${pid}">Open Application</a></span></h3>
          <div data-group="${gi}"></div>
        </section>`,
      )
      .join('');

    [...byProject.values()].forEach((g, gi) => {
      const host = groups.querySelector(`[data-group="${gi}"]`);
      host.innerHTML = dataTable({
        caption: `Test sessions for ${g.name}`,
        columns: [
          { key: 'n', label: 'Test', sortable: false, render: (r) => `<span class="cell-strong">#${r.__n}</span>` },
          { key: 'capturedAt', label: 'Date', sortable: false, render: (r) => fmtDate(r.capturedAt) },
          { key: 'platform', label: 'Platform', sortable: false, render: (r) => platformPill(r.platform) },
          { key: 'avgFps', label: 'Avg FPS', num: true, sortable: false, render: (r) => (r.captureStatus === 'invalid' ? '—' : r1(r.avgFps)) },
          { key: 'grade', label: 'Grade', sortable: false, render: (r) => gradeBadge(r.gradeLetter, r.gradeScore) },
          { key: 'status', label: 'Status', sortable: false, render: (r) => judgementPill(r.captureStatus, r.performanceStatus) },
        ],
        rows: g.items.map((x, i) => ({ ...x, __n: i + 1, __label: `Open test #${i + 1}` })),
        rowHref: (r) => `#/sessions/${r.id}`,
      });
      wireTable(host);
    });
  }

  if (validCount >= 2) drawTrendChart(sessions, sessions[sessions.length - 1].targetFps);

  main.querySelector('#btnEdit').addEventListener('click', () => openStudentForm(s, () => renderStudent(main, id)));
  main.querySelector('#btnRemove').addEventListener('click', () =>
    confirmStudentRemoval(s, (kind) => {
      if (kind === 'permanent') location.hash = '#/students';
      else renderStudent(main, id);
    }),
  );
}
