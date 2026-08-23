/**
 * The four states every API-driven view must handle: loading, empty, error and
 * success. Centralised so they look and read the same everywhere.
 */
import { esc } from './ui.js';
import { icons } from './icons.js';

const ICON = {
  projects: () => icons.layers(34),
  students: () => icons.users(34),
  sessions: () => icons.clock(34),
  bugs: () => icons.check(34),
  search: () => icons.search(34),
  alert: () => icons.alert(34),
};

/** Skeleton placeholder — shown immediately so no view is ever blank. */
export function loadingState({ cards = 0, rows = 5, label = 'Loading' } = {}) {
  const cardBlock = cards
    ? `<div class="skeleton-grid">${'<div class="skeleton tall"></div>'.repeat(cards)}</div>`
    : '';
  return `<div role="status" aria-live="polite" aria-busy="true">
      <span class="sr-only">${esc(label)}…</span>
      ${cardBlock}
      <div class="section">${'<div class="skeleton"></div>'.repeat(rows)}</div>
    </div>`;
}

/**
 * Empty state. Always says what the user can do next rather than just
 * reporting absence.
 */
export function emptyState({ icon = 'search', title, message, actions = [], tone = '' }) {
  const glyph = (ICON[icon] ?? ICON.search)();
  return `<div class="state ${tone}">
      <div class="state-icon" aria-hidden="true">${glyph}</div>
      <div class="state-title">${esc(title)}</div>
      <p class="state-msg">${esc(message)}</p>
      ${actions.length ? `<div class="state-actions">${actions.join('')}</div>` : ''}
    </div>`;
}

/**
 * Error state. `err.userMessage` is set by the API client and is always plain
 * English; technical detail stays in the console.
 */
export function errorState(err, { retryId } = {}) {
  return `<div class="state error" role="alert">
      <div class="state-icon" aria-hidden="true">${ICON.alert()}</div>
      <div class="state-title">Something went wrong</div>
      <p class="state-msg">${esc(err.userMessage ?? err.message ?? 'Unexpected error.')}</p>
      ${retryId ? `<div class="state-actions"><button class="btn" id="${retryId}">Try again</button></div>` : ''}
    </div>`;
}

/** Empty-state copy, kept in one place so terminology stays consistent. */
export const EMPTY = {
  projects: {
    icon: 'projects',
    title: 'No applications yet',
    message: 'Import your first XR test report to begin building your testing history.',
  },
  projectsFiltered: {
    icon: 'search',
    title: 'No applications match your filters',
    message: 'Try a different search term, or clear the platform and status filters.',
  },
  students: {
    icon: 'students',
    title: 'No testers recorded yet',
    message: 'A tester is created automatically when an imported report names one. Tester details are always optional.',
  },
  studentsFiltered: {
    icon: 'search',
    title: 'No testers match your filters',
    message: 'Try a different search term or clear the filters.',
  },
  sessions: {
    icon: 'sessions',
    title: 'No test sessions have been recorded',
    message: 'Import a profiler report from Unity to record the first test session.',
  },
  projectSessions: {
    icon: 'sessions',
    title: 'No test sessions for this application',
    message: 'Import a profiler report captured from this project to start its testing history.',
  },
  studentSessions: {
    icon: 'sessions',
    title: 'No test sessions for this tester',
    message: 'Sessions appear here once a report captured by this tester is imported.',
  },
  bugs: {
    icon: 'bugs',
    tone: 'ok',
    title: 'No open defects. Nice work.',
    message: 'Defects you log against an application will appear here.',
  },
  bugsFiltered: {
    icon: 'search',
    title: 'No defects match your filters',
    message: 'Try clearing the severity, status or project filter.',
  },
  projectStudents: {
    icon: 'students',
    title: 'No testers linked yet',
    message: 'Importing a report links its tester to this application automatically.',
  },
};
