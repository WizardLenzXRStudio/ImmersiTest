/** Shared formatting, badges, toast and dialog plumbing. */

export const esc = (s) =>
  (s == null ? '' : String(s)).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const r1 = (v) => (v == null || isNaN(v) ? '—' : (+v).toFixed(1));
export const r2 = (v) => (v == null || isNaN(v) ? '—' : (+v).toFixed(2));
export const int = (v) => (v == null || isNaN(v) ? '—' : Math.round(+v).toLocaleString());

export function bytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return (
    d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  );
}

export function fmtRelative(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ------------------------------------------------------------ vocabulary --
   One place for every user-facing label, so terminology cannot drift. */

export const SEVERITIES = [
  ['critical', 'Critical'],
  ['high', 'High'],
  ['medium', 'Medium'],
  ['low', 'Low'],
];
export const BUG_STATUSES = [
  ['open', 'Open'],
  ['in_progress', 'In Progress'],
  ['resolved', 'Resolved'],
  ['closed', 'Closed'],
];
export const severityLabel = (v) => SEVERITIES.find(([k]) => k === v)?.[1] ?? v;
export const bugStatusLabel = (v) => BUG_STATUSES.find(([k]) => k === v)?.[1] ?? v;

export const statusLabel = (s) => ({ pass: 'PASS', warn: 'WARN', fail: 'FAIL', neutral: '—' }[s] ?? '—');

/** Verdict for a test, with INVALID CAPTURE treated as its own outcome. */
export function verdictOf(session) {
  if (!session) return { key: 'none', label: '—' };
  if (session.captureStatus === 'invalid') return { key: 'invalid', label: 'INVALID CAPTURE' };
  const s = session.performanceStatus ?? 'neutral';
  return { key: s, label: statusLabel(s) };
}

export function judgementPill(captureStatus, performanceStatus) {
  if (captureStatus === 'invalid') {
    return '<span class="pill invalid" title="The profiler recorded no frames">NO DATA</span>';
  }
  const s = performanceStatus ?? 'neutral';
  if (s === 'neutral') return '<span class="pill none">—</span>';
  return `<span class="pill ${s}">${statusLabel(s)}</span>`;
}

export function gradeBadge(letter, score, size) {
  if (!letter) return '<span class="muted">—</span>';
  // Quality classification for the application under test — never a person's grade.
  const tip = score != null
    ? `ImmersiTest quality score ${score} out of 100, classification ${letter}`
    : `Quality classification ${letter}`;
  return `<span class="grade g-${letter.toLowerCase()} ${size === 'lg' ? 'grade-lg' : ''}"
     title="${esc(tip)}" role="img" aria-label="${esc(tip)}">${esc(letter)}</span>`;
}

export const platformPill = (p) =>
  `<span class="pill ${String(p).toLowerCase()}">${esc(p)}</span>`;

/* ----------------------------------------------------------------- toast -- */
let toastTimer;
export function toast(msg, kind = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), kind === 'error' ? 6000 : 3000);
}

/* ---------------------------------------------------------------- dialog -- */
const overlay = () => document.getElementById('overlay');
let lastFocused = null;

export function closeModal() {
  const o = overlay();
  if (!o.classList.contains('show')) return;
  o.classList.remove('show');
  o.innerHTML = '';
  // Return focus to whatever opened the dialog.
  if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
  lastFocused = null;
}

const FOCUSABLE = 'button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function openModal({ title, body, footer, onMount, wide }) {
  lastFocused = document.activeElement;
  const o = overlay();
  const titleId = 'modal-title';
  o.innerHTML = `<div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
      <h3 id="${titleId}">${esc(title)}</h3>
      <div class="modal-body">${body}</div>
      <div class="modal-actions">${footer ?? '<button type="button" class="btn ghost" data-close>Close</button>'}</div>
    </div>`;
  o.classList.add('show');

  const root = o.querySelector('.modal');
  root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeModal));

  // Focus trap: Tab must cycle inside the dialog, never behind it.
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const items = [...root.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  if (onMount) onMount(root, closeModal);
  (root.querySelector('input, select, textarea') ?? root.querySelector('button'))?.focus();
}

/**
 * Destructive confirmation. `lines` is [label, count] pairs spelling out exactly
 * what will be destroyed — nothing is ever deleted silently.
 */
export function confirmDanger({ title, intro, lines = [], confirmLabel, onConfirm, onDone }) {
  openModal({
    title,
    body: `
      <p class="danger-intro">${intro}</p>
      ${
        lines.length
          ? `<ul class="danger-list">${lines
              .map(([label, count]) => `<li><span>${esc(label)}</span><b>${count == null ? '' : int(count)}</b></li>`)
              .join('')}</ul>`
          : ''
      }
      <p class="muted" style="font-size:12.5px;margin-top:14px">This cannot be undone.</p>`,
    footer: `<button type="button" class="btn ghost" data-close>Cancel</button>
             <button type="button" class="btn danger-solid" data-confirm>${esc(confirmLabel)}</button>`,
    onMount(root, close) {
      const btn = root.querySelector('[data-confirm]');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Working…';
        try {
          const result = await onConfirm();
          close();
          onDone?.(result);
        } catch (err) {
          // Never pretend a failed delete succeeded.
          toast(err.userMessage ?? err.message, 'error');
          btn.disabled = false;
          btn.textContent = confirmLabel;
        }
      });
    },
  });
}

/** Simple required-field validation with inline, accessible messages. */
export function validateFields(root, rules) {
  let ok = true;
  let firstBad = null;
  for (const [id, message] of Object.entries(rules)) {
    const el = root.querySelector(`#${id}`);
    const err = root.querySelector(`#${id}-error`);
    const bad = !el.value.trim();
    el.setAttribute('aria-invalid', bad ? 'true' : 'false');
    if (err) err.classList.toggle('show', bad);
    if (err) err.textContent = bad ? message : '';
    if (bad && !firstBad) firstBad = el;
    if (bad) ok = false;
  }
  firstBad?.focus();
  return ok;
}
