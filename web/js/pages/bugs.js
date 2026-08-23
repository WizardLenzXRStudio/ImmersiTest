import api from '../api.js';
import {
  esc, fmtDate, openModal, toast, confirmDanger, validateFields,
  SEVERITIES, BUG_STATUSES, severityLabel, bugStatusLabel,
} from '../ui.js';
import { loadingState, emptyState, errorState, EMPTY } from '../states.js';

/** Reusable defect list, shared by the project, session and defects pages. */
export function bugListHTML(bugs, { showProject = false, highlightSession = null } = {}) {
  if (!bugs?.length) return emptyState(EMPTY.bugs);
  return bugs
    .map((b) => {
      const meta = [
        showProject && b.projectName ? esc(b.projectName) : '',
        b.studentName ? esc(b.studentName) : '',
        fmtDate(b.createdAt),
        b.sessionId === highlightSession ? 'found in this session' : b.sessionId ? 'found in a test session' : '',
        b.resolvedAt ? `resolved ${fmtDate(b.resolvedAt)}` : '',
      ].filter(Boolean);

      return `<div class="bug" data-bug="${esc(b.id)}">
        <span class="sev ${esc(b.severity)}">${esc(severityLabel(b.severity))}</span>
        <span class="btext">
          <b>${esc(b.title)}</b>
          ${b.description ? `<small>${esc(b.description)}</small>` : ''}
          <small class="muted">${meta.join(' · ')}</small>
          ${b.resolutionNote ? `<small class="muted">Resolution: ${esc(b.resolutionNote)}</small>` : ''}
        </span>
        <label class="sr-only" for="st-${esc(b.id)}">Status for ${esc(b.title)}</label>
        <select class="bug-status ${esc(b.status)}" id="st-${esc(b.id)}" data-status="${esc(b.id)}">
          ${BUG_STATUSES.map(([v, l]) => `<option value="${v}" ${b.status === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <span class="bug-actions">
          <button type="button" class="btn ghost sm" data-edit-bug="${esc(b.id)}">Edit</button>
          <button type="button" class="btn ghost sm" data-del-bug="${esc(b.id)}"
            aria-label="Delete defect ${esc(b.title)}">✕</button>
        </span>
      </div>`;
    })
    .join('');
}

export function wireBugList(scope, onChange) {
  if (!scope) return;

  scope.querySelectorAll('[data-status]').forEach((sel) =>
    sel.addEventListener('change', async () => {
      const prev = sel.dataset.prev ?? sel.value;
      try {
        await api.updateBug(sel.dataset.status, { status: sel.value });
        sel.className = `bug-status ${sel.value}`;
        toast(`Defect marked ${bugStatusLabel(sel.value)}`, 'success');
        onChange?.();
      } catch (err) {
        sel.value = prev;
        toast(err.userMessage ?? err.message, 'error');
      }
    }),
  );

  scope.querySelectorAll('[data-del-bug]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const row = btn.closest('.bug');
      const title = row?.querySelector('.btext b')?.textContent ?? 'this defect';
      confirmDanger({
        title: 'Delete Defect?',
        intro: `<b>${esc(title)}</b> will be removed from this PC.`,
        lines: [['Defect record', 1]],
        confirmLabel: 'Delete Defect',
        onConfirm: () => api.deleteBug(btn.dataset.delBug),
        onDone: () => {
          toast('Defect deleted', 'success');
          onChange?.();
        },
      });
    }),
  );

  scope.querySelectorAll('[data-edit-bug]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      try {
        // Single fetch — previously this pulled the entire defect list.
        const { bug } = await api.bug(btn.dataset.editBug);
        openBugForm({ bug }, onChange);
      } catch (err) {
        toast(err.userMessage ?? err.message, 'error');
      }
    }),
  );
}

export function openBugForm({ bug, projectId, sessionId, students = [] }, onDone) {
  const editing = !!bug;
  openModal({
    title: editing ? 'Edit Defect' : 'Log Defect',
    body: `
      <div class="field">
        <label for="b_title">Title <span aria-hidden="true">*</span></label>
        <input id="b_title" value="${esc(bug?.title ?? '')}"
          placeholder="Frame rate collapses when 3+ models spawn" aria-describedby="b_title-error">
        <div class="field-error" id="b_title-error" role="alert"></div>
      </div>
      <div class="field">
        <label for="b_desc">Description / repro steps <span class="muted">(optional)</span></label>
        <textarea id="b_desc" rows="3">${esc(bug?.description ?? '')}</textarea>
      </div>
      <div class="field">
        <label for="b_sev">Severity</label>
        <select id="b_sev">${SEVERITIES.map(([v, l]) => `<option value="${v}" ${(bug?.severity ?? 'medium') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div>
      ${
        editing
          ? `<div class="field">
              <label for="b_status">Status</label>
              <select id="b_status">${BUG_STATUSES.map(([v, l]) => `<option value="${v}" ${bug.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
            </div>
            <div class="field">
              <label for="b_res">Resolution note <span class="muted">(optional)</span></label>
              <textarea id="b_res" rows="2">${esc(bug.resolutionNote ?? '')}</textarea>
            </div>`
          : students.length
            ? `<div class="field">
                <label for="b_student">Tester <span class="muted">(optional)</span></label>
                <select id="b_student"><option value="">—</option>
                  ${students.map((s) => `<option value="${esc(s.id)}">${esc(s.studentName)}</option>`).join('')}</select>
              </div>`
            : ''
      }
      <p class="muted" style="font-size:12px">Defects are tracked separately and do not change the numeric score.</p>`,
    footer: `<button type="button" class="btn ghost" data-close>Cancel</button>
             <button type="button" class="btn primary" data-save>${editing ? 'Save Changes' : 'Log Defect'}</button>`,
    onMount(root, close) {
      const btn = root.querySelector('[data-save]');
      btn.addEventListener('click', async () => {
        if (!validateFields(root, { b_title: 'Enter a short title for the defect.' })) return;
        btn.disabled = true;
        try {
          if (editing) {
            await api.updateBug(bug.id, {
              title: root.querySelector('#b_title').value.trim(),
              description: root.querySelector('#b_desc').value.trim() || null,
              severity: root.querySelector('#b_sev').value,
              status: root.querySelector('#b_status').value,
              resolutionNote: root.querySelector('#b_res').value.trim() || null,
            });
          } else {
            await api.createBug({
              projectId,
              sessionId: sessionId ?? null,
              studentId: root.querySelector('#b_student')?.value || null,
              title: root.querySelector('#b_title').value.trim(),
              description: root.querySelector('#b_desc').value.trim() || null,
              severity: root.querySelector('#b_sev').value,
            });
          }
          toast(editing ? 'Defect updated' : 'Defect logged', 'success');
          close();
          onDone?.();
        } catch (err) {
          toast(err.userMessage ?? err.message, 'error');
          btn.disabled = false;
        }
      });
    },
  });
}

/* --------------------------------------------------------- defects page -- */

const filters = { q: '', severity: '', status: '', projectId: '', sort: 'severity' };

export async function renderBugs(main) {
  main.innerHTML = loadingState({ rows: 7, label: 'Loading defects' });

  const qs = new URLSearchParams();
  if (filters.severity) qs.set('severity', filters.severity);
  if (filters.status) qs.set('status', filters.status);
  if (filters.projectId) qs.set('projectId', filters.projectId);
  if (filters.q) qs.set('q', filters.q);
  qs.set('sort', filters.sort);

  let bugs;
  let projects;
  try {
    [bugs, projects] = await Promise.all([
      api.bugs(`?${qs}`).then((r) => r.bugs),
      api.projects(true).then((r) => r.projects),
    ]);
  } catch (err) {
    main.innerHTML = errorState(err, { retryId: 'retry' });
    main.querySelector('#retry')?.addEventListener('click', () => renderBugs(main));
    return;
  }

  const counts = SEVERITIES.map(([k, l]) => [l, bugs.filter((b) => b.severity === k).length]);

  main.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">Incident Log</div>
        <h1>Defects</h1>
        <div class="meta">
          <span>${bugs.length} shown</span>
          ${counts.filter(([, n]) => n).map(([l, n]) => `<span class="muted">${l}: <b>${n}</b></span>`).join('')}
        </div>
      </div>
    </div>

    <section class="section">
      <div class="toolbar">
        <div class="field-inline grow">
          <label for="fq">Search</label>
          <input class="search" id="fq" type="search" placeholder="Title or description…" value="${esc(filters.q)}">
        </div>
        <div class="field-inline">
          <label for="fsev">Severity</label>
          <select class="selectbox" id="fsev"><option value="">All</option>
            ${SEVERITIES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
        </div>
        <div class="field-inline">
          <label for="fstat">Status</label>
          <select class="selectbox" id="fstat"><option value="">All</option>
            ${BUG_STATUSES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
        </div>
        <div class="field-inline">
          <label for="fproj">Application</label>
          <select class="selectbox" id="fproj"><option value="">All</option>
            ${projects.map((p) => `<option value="${esc(p.id)}">${esc(p.projectName)}</option>`).join('')}</select>
        </div>
        <div class="field-inline">
          <label for="fsort">Sort</label>
          <select class="selectbox" id="fsort">
            <option value="severity">Severity</option>
            <option value="created">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="status">Status</option>
            <option value="project">Application</option>
          </select>
        </div>
      </div>
      <div id="bugWrap" aria-live="polite">
        ${bugs.length ? bugListHTML(bugs, { showProject: true }) : emptyState(anyFilter() ? EMPTY.bugsFiltered : EMPTY.bugs)}
      </div>
    </section>`;

  for (const [id, key] of [['fsev', 'severity'], ['fstat', 'status'], ['fproj', 'projectId'], ['fsort', 'sort']]) {
    const el = main.querySelector(`#${id}`);
    el.value = filters[key];
    el.addEventListener('change', (e) => {
      filters[key] = e.target.value;
      renderBugs(main);
    });
  }

  // Debounced so typing does not fire a request per keystroke.
  let t;
  main.querySelector('#fq').addEventListener('input', (e) => {
    filters.q = e.target.value;
    clearTimeout(t);
    t = setTimeout(() => renderBugs(main), 250);
  });

  wireBugList(main.querySelector('#bugWrap'), () => renderBugs(main));
}

const anyFilter = () => !!(filters.q || filters.severity || filters.status || filters.projectId);
