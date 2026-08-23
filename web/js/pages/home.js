import api from '../api.js';
import { esc, r1, int, fmtRelative, gradeBadge, judgementPill, platformPill } from '../ui.js';
import { loadingState, emptyState, errorState, EMPTY } from '../states.js';
import { dataTable, wireTable, sortRows, nextSort } from '../table.js';

const NUMERIC = new Set(['studentCount', 'latestAvgFps', 'latestMemoryMB', 'latestScore', 'sessionCount']);
let sort = { key: 'projectName', dir: 'asc' };

export async function renderHome(main) {
  main.innerHTML = loadingState({ cards: 4, rows: 6, label: 'Loading command centre' });

  let stats;
  let projects;
  try {
    [stats, projects] = await Promise.all([api.stats(), api.projects(false)]);
  } catch (err) {
    main.innerHTML = errorState(err, { retryId: 'retry' });
    main.querySelector('#retry')?.addEventListener('click', () => renderHome(main));
    return;
  }

  const t = stats.totals;
  const d = stats.distribution;
  const p = stats.distributionPct;
  const live = stats.recentSessions.length > 0;

  main.innerHTML = `
    <section class="hero" aria-labelledby="hero-h">
      <div class="hero-inner">
        <div>
          <h1 id="hero-h">ImmersiTest</h1>
          <p class="tagline">Test the Experience. Trust the Immersion.</p>
          <div class="pipeline" aria-hidden="true">
            <span class="on"><i></i>Focus</span><span class="sep">/</span>
            <span class="on"><i></i>Inspect</span><span class="sep">/</span>
            <span class="on"><i></i>Diagnose</span>
          </div>
        </div>
        <div class="actions" style="display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn primary" href="#/import">Import Test Report</a>
          <a class="btn" href="#/projects">Applications</a>
        </div>
      </div>
    </section>

    <div class="stat-grid">
      ${stat('Applications', t.projects, t.archivedProjects ? `${t.archivedProjects} archived` : 'under test', 'accent')}
      ${stat('Testers', t.students, 'with test records')}
      ${stat('Test Sessions', t.sessions, 'full history retained')}
      ${stat('Open Defects', t.openBugs, t.criticalBugs ? `${t.criticalBugs} critical` : 'none critical', t.openBugs ? 'warnish' : '')}
    </div>

    <section class="section" aria-labelledby="dist-h">
      <h3 id="dist-h">Quality Pulse
        <span class="hint">latest verdict per application${live ? ' · <span class="livedot"></span> live' : ''}</span></h3>
      ${distribution(d, p)}
    </section>

    <section class="section" aria-labelledby="recent-h">
      <h3 id="recent-h">Recent Testing Activity
        <span class="hint">${stats.recentSessions.length} most recent</span></h3>
      <div id="recentWrap"></div>
    </section>

    <section class="section" aria-labelledby="apps-h">
      <h3 id="apps-h">Tested Applications <span class="hint">${projects.projects.length} active</span></h3>
      <div id="appsWrap"></div>
    </section>`;

  renderRecent(main, stats.recentSessions);
  renderApps(main, projects.projects);
}

function stat(label, value, sub, tone = '') {
  return `<div class="stat ${tone}">
    <div class="stat-label">${esc(label)}</div>
    <div class="stat-value"><span data-count="${Number(value) || 0}">0</span></div>
    <div class="stat-sub">${esc(sub)}</div>
  </div>`;
}

function distribution(d, pct) {
  const total = d.pass + d.warn + d.fail + d.invalid;
  if (!total) {
    return `<p class="muted" style="font-size:12.5px">No test sessions recorded yet — the pass, warn and fail breakdown appears once you import a report.</p>`;
  }
  const w = (n) => (n / total) * 100;
  const cell = (kind, label, n, showPct) => `
    <div class="dist-cell ${kind}">
      <div class="k">${label}</div>
      <div class="v"><span data-count="${n}">0</span></div>
      <div class="p">${showPct ? `${showPct}% of graded` : 'not graded'}</div>
    </div>`;

  return `
    <div class="dist-rail">
      ${cell('pass', 'Pass', d.pass, d.counted ? pct.pass : null)}
      ${cell('warn', 'Warn', d.warn, d.counted ? pct.warn : null)}
      ${cell('fail', 'Fail', d.fail, d.counted ? pct.fail : null)}
      ${cell('invalid', 'Invalid / No Data', d.invalid, null)}
    </div>
    <div class="dist-bar" role="img"
      aria-label="Pass ${d.pass}, Warn ${d.warn}, Fail ${d.fail}, Invalid capture ${d.invalid}">
      ${d.pass ? `<span class="seg-pass" style="width:${w(d.pass)}%"></span>` : ''}
      ${d.warn ? `<span class="seg-warn" style="width:${w(d.warn)}%"></span>` : ''}
      ${d.fail ? `<span class="seg-fail" style="width:${w(d.fail)}%"></span>` : ''}
      ${d.invalid ? `<span class="seg-invalid" style="width:${w(d.invalid)}%"></span>` : ''}
    </div>`;
}

function renderRecent(main, sessions) {
  const wrap = main.querySelector('#recentWrap');
  if (!sessions.length) {
    wrap.innerHTML = emptyState(EMPTY.sessions);
    return;
  }
  wrap.innerHTML = dataTable({
    caption: 'Most recently imported test sessions',
    columns: [
      { key: 'projectName', label: 'Application', sortable: false, render: (r) => `<span class="cell-strong">${esc(r.projectName)}</span>` },
      { key: 'studentName', label: 'Tester', sortable: false, render: (r) => esc(r.studentName) },
      { key: 'capturedAt', label: 'Date', sortable: false, render: (r) => fmtRelative(r.capturedAt) },
      { key: 'platform', label: 'Platform', sortable: false, render: (r) => platformPill(r.platform) },
      { key: 'avgFps', label: 'Avg FPS', num: true, sortable: false, render: (r) => (r.captureStatus === 'invalid' ? '—' : r1(r.avgFps)) },
      { key: 'gradeLetter', label: 'Grade', sortable: false, render: (r) => gradeBadge(r.gradeLetter) },
      { key: 'status', label: 'Status', sortable: false, render: (r) => judgementPill(r.captureStatus, r.performanceStatus) },
    ],
    rows: sessions.map((s) => ({ ...s, __label: `Open report for ${s.projectName}, ${s.studentName}` })),
    rowHref: (r) => `#/sessions/${r.id}`,
  });
  wireTable(wrap);
}

function renderApps(main, projects) {
  const wrap = main.querySelector('#appsWrap');
  if (!projects.length) {
    wrap.innerHTML = emptyState({
      ...EMPTY.projects,
      actions: ['<a class="btn primary" href="#/import">Import Report</a>'],
    });
    return;
  }

  wrap.innerHTML = dataTable({
    caption: 'All active applications with their latest test result',
    sort,
    columns: [
      { key: 'projectName', label: 'Application', render: (r) => `<span class="cell-strong">${esc(r.projectName)}</span>` },
      { key: 'studentCount', label: 'Testers', num: true, render: (r) => r.studentCount },
      { key: 'platform', label: 'Platform', render: (r) => platformPill(r.platform) },
      { key: 'latestCapturedAt', label: 'Latest Test', render: (r) => fmtRelative(r.latestCapturedAt) },
      // An invalid capture recorded no frames — showing its 0.0 as a reading
      // would misrepresent a broken run as a terrible result.
      { key: 'latestAvgFps', label: 'Avg FPS', num: true, render: (r) => (r.latestCaptureStatus === 'invalid' || r.latestAvgFps == null ? '—' : r1(r.latestAvgFps)) },
      { key: 'latestMemoryMB', label: 'Memory', num: true, render: (r) => (r.latestMemoryMB > 0 ? `${int(r.latestMemoryMB)} MB` : '—') },
      { key: 'latestScore', label: 'Score', num: true, render: (r) => (r.latestScore == null ? '—' : r.latestScore) },
      { key: 'latestGrade', label: 'Grade', sortable: false, render: (r) => gradeBadge(r.latestGrade, r.latestScore) },
      { key: 'latestStatus', label: 'Status', render: (r) => (r.latestSessionId ? judgementPill(r.latestCaptureStatus, r.latestStatus) : '<span class="pill none">—</span>') },
      { key: 'sessionCount', label: 'Tests', num: true, render: (r) => r.sessionCount },
    ],
    rows: sortRows(projects, sort).map((p) => ({ ...p, __label: `Open ${p.projectName}` })),
    rowHref: (r) => `#/projects/${r.id}`,
  });

  wireTable(wrap, (key) => {
    sort = nextSort(sort, key, NUMERIC);
    renderApps(main, projects);
  });
}
