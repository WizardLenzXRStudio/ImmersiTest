/**
 * ImmersiTest — application entry point.
 *
 * The same bundle serves two deployments:
 *
 *   hosted  the public service. A temporary analysis token is the only state;
 *           there is no login, no database and no stored history.
 *   local   a development / offline instance that additionally mounts the
 *           SQLite dashboard for applications, testers, sessions and defects.
 *
 * Which one is running is read from /api/health at boot, so nothing about the
 * deployment is hard-coded into the client.
 */
import api from './js/api.js';
import { toast, openModal, closeModal, esc, int } from './js/ui.js';
import { destroyAllCharts } from './js/charts.js';
import { errorState } from './js/states.js';
import { renderLanding, renderAnalyze, renderDocs } from './js/pages/landing.js';
import { renderReport, disposeReport } from './js/pages/report.js';
import { pageEnter, revealStagger, countUp, drawRings } from './js/motion.js';
import { initField } from './js/field.js';
import { PRODUCT, TAGLINE, VENDOR_LEGAL, COMPANY_URL, currentYear } from './js/brand.js';

const LEGACY_KEY = 'xrtestlab.v1';
const main = () => document.getElementById('main');

/** Filled from /api/health before the first route runs. */
let env = { mode: 'hosted', ttlMinutes: 60, version: '', vendor: 'Wizardlenz XR Studio' };

/* -------------------------------------------------------------- routing -- */

/** Routes available in both deployments. */
const COMMON_ROUTES = [
  [/^#\/r\/([A-Za-z0-9_-]+)$/, 'report', 'XR Test Report', (m) => renderReport(main(), m[1])],
  [/^#\/analyze$/, 'analyze', 'New Test', () => renderAnalyze(main())],
  [/^#\/docs$/, 'docs', 'Help', () => renderDocs(main(), env)],
];

/** The local SQLite dashboard. Loaded on demand so hosted never fetches it. */
const LOCAL_ROUTES = [
  [/^#?\/?$/, 'dashboard', 'Dashboard', async () => (await import('./js/pages/home.js')).renderHome(main())],
  [/^#\/projects$/, 'projects', 'Applications', async () => (await import('./js/pages/projects.js')).renderProjects(main())],
  [/^#\/projects\/([^/]+)$/, 'projects', 'Application', async (m) => (await import('./js/pages/project.js')).renderProject(main(), m[1])],
  [/^#\/students$/, 'students', 'Testers', async () => (await import('./js/pages/students.js')).renderStudents(main())],
  [/^#\/students\/([^/]+)$/, 'students', 'Tester', async (m) => (await import('./js/pages/students.js')).renderStudent(main(), m[1])],
  [/^#\/sessions$/, 'sessions', 'Test Sessions', async () => (await import('./js/pages/sessions.js')).renderSessions(main())],
  [/^#\/sessions\/([^/]+)$/, 'sessions', 'XR Test Report', async (m) => (await import('./js/pages/session.js')).renderSession(main(), m[1])],
  [/^#\/bugs$/, 'bugs', 'Defects', async () => (await import('./js/pages/bugs.js')).renderBugs(main())],
  [/^#\/import$/, 'import', 'Import Report', async () => (await import('./js/pages/import.js')).renderImport(main())],
  [/^#\/data$/, 'data', 'Data Management', async () => (await import('./js/pages/data.js')).renderData(main())],
];

/** Hosted home is the product landing page. */
const HOSTED_HOME = [/^#?\/?$/, 'home', 'ImmersiTest', () => renderLanding(main(), env)];

const routes = () =>
  env.mode === 'local' ? [...COMMON_ROUTES, ...LOCAL_ROUTES] : [...COMMON_ROUTES, HOSTED_HOME];

let currentToken = 0;

async function route() {
  const hash = location.hash || '#/';
  closeModal();
  destroyAllCharts();
  disposeReport();

  const match = routes().find(([re]) => re.test(hash));
  if (!match) {
    location.hash = '#/';
    return;
  }

  const [re, navKey, title, handler] = match;
  document.title = title === 'ImmersiTest' ? title : `${title} · ImmersiTest`;
  syncNav(navKey);

  // Guards against a slow request from a previous route painting over a newer one.
  const token = ++currentToken;
  try {
    await handler(hash.match(re));
  } catch (err) {
    if (token !== currentToken) return;
    console.error('[route]', hash, err);
    main().innerHTML = errorState(err);
  }
  if (token !== currentToken) return;

  // Entrance choreography, applied once the view has painted. Routes that open
  // a single object get the "focus acquisition" settle instead of a plain fade.
  const el = main();
  const isDetail = /^#\/(projects|students|sessions)\/[^/]+$/.test(hash) || /^#\/r\//.test(hash);
  pageEnter(el, isDetail);
  revealStagger(el);
  countUp(el);
  drawRings(el);
  window.scrollTo(0, 0);
}

/* ------------------------------------------------------------------ nav -- */

/**
 * The hosted tool is an instant diagnostic, not an administration dashboard.
 * Navigation stays at the minimum a first-time visitor needs: start a test, or
 * find out how. Nothing here implies a stored collection of anything.
 */
const HOSTED_NAV = [
  ['home', '#/', 'Home'],
  ['analyze', '#/analyze', 'New Test'],
  ['docs', '#/docs', 'Help'],
];

const LOCAL_NAV = [
  ['dashboard', '#/', 'Dashboard'],
  ['projects', '#/projects', 'Applications'],
  ['students', '#/students', 'Testers'],
  ['sessions', '#/sessions', 'Test Sessions'],
  ['bugs', '#/bugs', 'Defects'],
  ['data', '#/data', 'Data'],
  ['docs', '#/docs', 'Docs'],
];

function buildChrome() {
  const nav = document.getElementById('mainnav');
  const items = env.mode === 'local' ? LOCAL_NAV : HOSTED_NAV;
  nav.innerHTML = items
    .map(([key, href, label]) => `<a class="navlink" data-nav="${key}" href="${href}">${esc(label)}</a>`)
    .join('');

  document.getElementById('topbarActions').innerHTML =
    env.mode === 'local'
      ? '<a class="btn primary sm" data-nav="import" href="#/import">Import Report</a>'
      : '';

  // Copyright year is evaluated here, at render time, so it never goes stale.
  document.getElementById('sitefoot').innerHTML = `
    <span class="foot-product">
      <span class="foot-brand">${esc(PRODUCT)}</span>
      <span class="foot-tag">${esc(TAGLINE)}</span>
    </span>
    <span class="foot-legal">
      © ${currentYear()}
      <a class="foot-company" href="${COMPANY_URL}" target="_blank" rel="noopener noreferrer">
        ${esc(VENDOR_LEGAL)}<span class="ext" aria-hidden="true">↗</span>
        <span class="sr-only">(opens in a new tab)</span>
      </a>
    </span>
    <span class="foot-mode muted">${
      env.mode === 'local'
        ? `v${env.version} · local development instance`
        : `v${env.version} · analyses expire after ${env.ttlMinutes} min`
    }</span>`;
}

function syncNav(key) {
  document.querySelectorAll('[data-nav]').forEach((el) => {
    if (el.dataset.nav === key) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
}

/* -------------------------------------------- one-time legacy migration -- */

function legacyProjects() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.projects?.length ? parsed.projects : null;
  } catch {
    return null;
  }
}

/** Local instances only: the hosted service has nothing to migrate into. */
async function offerLegacyMigration() {
  if (env.mode !== 'local') return;
  const projects = legacyProjects();
  if (!projects) return;

  const status = await api.migrateStatus().catch(() => null);
  if (status?.alreadyMigrated) return;

  const sessions = projects.reduce((n, p) => n + (p.sessions?.length ?? 0), 0);
  openModal({
    title: 'Import Your Previous Browser Data?',
    body: `
      <p class="danger-intro">This browser still holds data from an older local version of this tool:</p>
      <ul class="danger-list">
        <li><span>Applications</span><b>${int(projects.length)}</b></li>
        <li><span>Test sessions</span><b>${int(sessions)}</b></li>
      </ul>
      <p class="muted" style="font-size:12.5px;margin-top:14px">
        Importing copies it into the local database, where it is stored permanently.
        Your browser data is left untouched, so nothing is lost either way.
      </p>`,
    footer: `<button type="button" class="btn ghost" data-close>Not Now</button>
             <button type="button" class="btn primary" data-migrate>Import Into Database</button>`,
    onMount(root, close) {
      const btn = root.querySelector('[data-migrate]');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Importing…';
        try {
          const m = (await api.migrateLocalStorage(projects)).migrated;
          toast(`Imported ${m.projects} application(s), ${m.students} tester(s), ${m.sessions} session(s)`, 'success');
          close();
          route();
        } catch (err) {
          toast(err.userMessage ?? err.message, 'error');
          btn.disabled = false;
          btn.textContent = 'Retry Import';
        }
      });
    },
  });
}

/* ----------------------------------------------------------------- boot -- */

document.getElementById('overlay').addEventListener('click', (e) => {
  if (e.target.id === 'overlay') closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});
window.addEventListener('hashchange', route);

(async function boot() {
  initField(document.getElementById('field'));

  try {
    const health = await api.health();
    env = {
      mode: health.mode ?? 'hosted',
      ttlMinutes: health.sessionTtlMinutes ?? 60,
      version: health.version ?? '',
      vendor: health.vendor ?? 'Wizardlenz XR Studio',
    };
  } catch (err) {
    // A report link must still render something useful if /health is briefly
    // unavailable; the route itself will surface the real error.
    console.warn('[boot] could not read service mode', err);
  }

  buildChrome();
  await route();

  try {
    await offerLegacyMigration();
  } catch (err) {
    console.warn('[migrate] legacy check failed', err);
  }
})();
