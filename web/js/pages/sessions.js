import api from '../api.js';
import { esc, r1, r2, int, fmtDate, gradeBadge, judgementPill, platformPill } from '../ui.js';
import { loadingState, emptyState, errorState, EMPTY } from '../states.js';
import { dataTable, wireTable, sortRows, nextSort } from '../table.js';

const NUMERIC = new Set(['avgFps', 'avgFrameMs', 'memoryMB', 'gradeScore']);
const filters = { q: '', platform: '', status: '', projectId: '' };
let sort = { key: 'capturedAt', dir: 'desc' };
let cache = [];
let projects = [];

export async function renderSessions(main) {
  main.innerHTML = loadingState({ rows: 9, label: 'Loading test sessions' });

  try {
    // The list endpoint deliberately excludes series[] — charts load only when
    // a single report is opened.
    [cache, projects] = await Promise.all([
      api.sessions().then((r) => r.sessions),
      api.projects(true).then((r) => r.projects),
    ]);
  } catch (err) {
    main.innerHTML = errorState(err, { retryId: 'retry' });
    main.querySelector('#retry')?.addEventListener('click', () => renderSessions(main));
    return;
  }

  main.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">Telemetry Archive</div>
        <h1>Test Sessions</h1>
        <div class="meta"><span class="muted">Every performance report imported on this PC</span></div>
      </div>
      <div class="actions"><a class="btn primary" href="#/import">Import Report</a></div>
    </div>

    <section class="section">
      <div class="toolbar">
        <div class="field-inline grow">
          <label for="fq">Search</label>
          <input class="search" id="fq" type="search" placeholder="Application or tester…" value="${esc(filters.q)}">
        </div>
        <div class="field-inline">
          <label for="fproj">Application</label>
          <select class="selectbox" id="fproj">
            <option value="">All</option>
            ${projects.map((p) => `<option value="${esc(p.id)}">${esc(p.projectName)}</option>`).join('')}
          </select>
        </div>
        <div class="field-inline">
          <label for="fplat">Platform</label>
          <select class="selectbox" id="fplat">
            <option value="">All</option><option value="VR">VR</option><option value="AR">AR</option>
          </select>
        </div>
        <div class="field-inline">
          <label for="fstat">Result</label>
          <select class="selectbox" id="fstat">
            <option value="">All</option>
            <option value="pass">Pass</option>
            <option value="warn">Warn</option>
            <option value="fail">Fail</option>
            <option value="invalid">Invalid capture</option>
          </select>
        </div>
      </div>
      <div id="tableWrap" aria-live="polite"></div>
    </section>`;

  for (const [id, key] of [['fproj', 'projectId'], ['fplat', 'platform'], ['fstat', 'status']]) {
    const el = main.querySelector(`#${id}`);
    el.value = filters[key];
    el.addEventListener('change', (e) => {
      filters[key] = e.target.value;
      draw(main);
    });
  }
  main.querySelector('#fq').addEventListener('input', (e) => {
    filters.q = e.target.value;
    draw(main);
  });

  draw(main);
}

function visible() {
  const q = filters.q.trim().toLowerCase();
  return cache.filter((s) => {
    if (q && !s.projectName.toLowerCase().includes(q) && !s.studentName.toLowerCase().includes(q)) return false;
    if (filters.projectId && s.projectId !== filters.projectId) return false;
    if (filters.platform && s.platform !== filters.platform) return false;
    if (filters.status === 'invalid') return s.captureStatus === 'invalid';
    if (filters.status) return s.captureStatus !== 'invalid' && s.performanceStatus === filters.status;
    return true;
  });
}

function draw(main) {
  const wrap = main.querySelector('#tableWrap');
  const rows = visible();

  if (!rows.length) {
    const filtered = filters.q || filters.projectId || filters.platform || filters.status;
    wrap.innerHTML = emptyState(
      filtered
        ? { icon: '⌕', title: 'No test sessions match your filters', message: 'Try clearing the application, platform or result filter.' }
        : { ...EMPTY.sessions, actions: ['<a class="btn primary" href="#/import">Import Report</a>'] },
    );
    return;
  }

  wrap.innerHTML = dataTable({
    caption: 'All imported test sessions',
    sort,
    columns: [
      { key: 'projectName', label: 'Application', render: (r) => `<span class="cell-strong">${esc(r.projectName)}</span>` },
      { key: 'studentName', label: 'Tester', render: (r) => esc(r.studentName) },
      { key: 'capturedAt', label: 'Test Date', render: (r) => fmtDate(r.capturedAt) },
      { key: 'platform', label: 'Platform', render: (r) => platformPill(r.platform) },
      { key: 'device', label: 'Device', render: (r) => esc(r.device ?? '—') },
      { key: 'avgFps', label: 'Avg FPS', num: true, render: (r) => (r.captureStatus === 'invalid' ? '—' : r1(r.avgFps)) },
      { key: 'memoryMB', label: 'Memory', num: true, render: (r) => (r.memoryMB > 0 ? `${int(r.memoryMB)} MB` : '—') },
      { key: 'gradeScore', label: 'Grade', render: (r) => gradeBadge(r.gradeLetter, r.gradeScore) },
      { key: 'performanceStatus', label: 'Status', render: (r) => judgementPill(r.captureStatus, r.performanceStatus) },
    ],
    rows: sortRows(rows, sort).map((s) => ({ ...s, __label: `Open report for ${s.projectName}, ${s.studentName}` })),
    rowHref: (r) => `#/sessions/${r.id}`,
  });

  wireTable(wrap, (key) => {
    sort = nextSort(sort, key, NUMERIC);
    draw(main);
  });
}
