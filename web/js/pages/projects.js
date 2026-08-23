import api from '../api.js';
import { esc, r1, int, fmtRelative, gradeBadge, judgementPill, platformPill } from '../ui.js';
import { loadingState, emptyState, errorState, EMPTY } from '../states.js';
import { dataTable, wireTable, sortRows, nextSort } from '../table.js';
import { openProjectForm } from './forms.js';

const NUMERIC = new Set(['studentCount', 'targetFps', 'latestScore', 'sessionCount']);

// Filter state persists while the user is in the session, but never in storage.
const filters = { q: '', platform: '', status: 'active' };
let sort = { key: 'projectName', dir: 'asc' };
let cache = [];

export async function renderProjects(main) {
  main.innerHTML = loadingState({ rows: 8, label: 'Loading applications' });

  try {
    cache = (await api.projects(true)).projects;
  } catch (err) {
    main.innerHTML = errorState(err, { retryId: 'retry' });
    main.querySelector('#retry')?.addEventListener('click', () => renderProjects(main));
    return;
  }

  main.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">Registry</div>
        <h1>Applications</h1>
        <div class="meta"><span class="muted">Every XR application under test</span></div>
      </div>
      <div class="actions">
        <button type="button" class="btn primary" id="btnNew">New Application</button>
        <a class="btn" href="#/import">Import Report</a>
      </div>
    </div>

    <section class="section">
      <div class="toolbar">
        <div class="field-inline grow">
          <label for="fq">Search</label>
          <input class="search" id="fq" type="search" placeholder="Application name…" value="${esc(filters.q)}">
        </div>
        <div class="field-inline">
          <label for="fplat">Platform</label>
          <select class="selectbox" id="fplat">
            <option value="">All</option>
            <option value="VR">VR</option>
            <option value="AR">AR</option>
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

  main.querySelector('#fplat').value = filters.platform;
  main.querySelector('#fstat').value = filters.status;

  main.querySelector('#btnNew').addEventListener('click', () =>
    openProjectForm(null, () => renderProjects(main)),
  );
  main.querySelector('#fq').addEventListener('input', (e) => {
    filters.q = e.target.value;
    draw(main);
  });
  main.querySelector('#fplat').addEventListener('change', (e) => {
    filters.platform = e.target.value;
    draw(main);
  });
  main.querySelector('#fstat').addEventListener('change', (e) => {
    filters.status = e.target.value;
    draw(main);
  });

  draw(main);
}

function visible() {
  const q = filters.q.trim().toLowerCase();
  return cache.filter(
    (p) =>
      (!q || p.projectName.toLowerCase().includes(q)) &&
      (!filters.platform || p.platform === filters.platform) &&
      (!filters.status || p.status === filters.status),
  );
}

function draw(main) {
  const wrap = main.querySelector('#tableWrap');
  const rows = visible();

  if (!rows.length) {
    const filtered = filters.q || filters.platform || filters.status !== 'active';
    wrap.innerHTML = emptyState(
      filtered
        ? EMPTY.projectsFiltered
        : { ...EMPTY.projects, actions: ['<a class="btn primary" href="#/import">Import Report</a>'] },
    );
    return;
  }

  wrap.innerHTML = dataTable({
    caption: 'Applications with their latest test result',
    sort,
    columns: [
      {
        key: 'projectName',
        label: 'Application',
        render: (r) =>
          `<span class="cell-strong">${esc(r.projectName)}</span>` +
          (r.status === 'archived' ? ' <span class="pill archived">Archived</span>' : ''),
      },
      { key: 'studentCount', label: 'Testers', num: true, render: (r) => r.studentCount },
      { key: 'platform', label: 'Platform', render: (r) => platformPill(r.platform) },
      { key: 'targetFps', label: 'Target FPS', num: true, render: (r) => `${r.targetFps} Hz` },
      { key: 'latestCapturedAt', label: 'Latest Test', render: (r) => fmtRelative(r.latestCapturedAt) },
      { key: 'latestScore', label: 'Grade', render: (r) => gradeBadge(r.latestGrade, r.latestScore) },
      {
        key: 'latestStatus',
        label: 'Status',
        render: (r) => (r.latestSessionId ? judgementPill(r.latestCaptureStatus, r.latestStatus) : '<span class="pill none">—</span>'),
      },
      { key: 'sessionCount', label: 'Tests', num: true, render: (r) => r.sessionCount },
    ],
    rows: sortRows(rows, sort).map((p) => ({ ...p, __label: `Open ${p.projectName}` })),
    rowHref: (r) => `#/projects/${r.id}`,
    rowClass: (r) => (r.status === 'archived' ? 'row-archived' : ''),
  });

  wireTable(wrap, (key) => {
    sort = nextSort(sort, key, NUMERIC);
    draw(main);
  });
}
