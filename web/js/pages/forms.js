/** Create / edit forms and the archive-vs-delete flows. */
import api from '../api.js';
import { openModal, closeModal, toast, esc, int, confirmDanger, validateFields } from '../ui.js';

const field = (id, label, value, { placeholder = '', hint = '', type = 'text', required = false } = {}) => `
  <div class="field">
    <label for="${id}">${esc(label)}${required ? ' <span aria-hidden="true">*</span>' : ''}${hint ? ` <span class="muted">${esc(hint)}</span>` : ''}</label>
    <input id="${id}" type="${type}" placeholder="${esc(placeholder)}" value="${esc(value ?? '')}"
      ${required ? 'required aria-required="true"' : ''} aria-describedby="${id}-error">
    <div class="field-error" id="${id}-error" role="alert"></div>
  </div>`;

/* ------------------------------------------------------------- projects -- */

export function openProjectForm(project, onDone) {
  const editing = !!project;
  openModal({
    title: editing ? 'Edit Application' : 'New Application',
    body: `
      ${field('f_name', 'Application name', project?.projectName, { placeholder: 'Anatomy VR Explorer', required: true })}
      <div class="field">
        <label for="f_platform">Platform</label>
        <select id="f_platform">
          <option value="VR" ${!editing || project?.platform === 'VR' ? 'selected' : ''}>VR (headset)</option>
          <option value="AR" ${project?.platform === 'AR' ? 'selected' : ''}>AR (mobile)</option>
        </select>
      </div>
      <div class="field">
        <label for="f_target">Target frame rate</label>
        <select id="f_target">
          ${[90, 72, 60].map((v) => `<option value="${v}" ${(project?.targetFps ?? 72) === v ? 'selected' : ''}>${v} Hz</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label for="f_desc">Description <span class="muted">(optional)</span></label>
        <textarea id="f_desc" rows="2">${esc(project?.description ?? '')}</textarea>
      </div>
      ${
        editing
          ? `<div class="field">
              <label for="f_status">Status</label>
              <select id="f_status">
                <option value="active" ${project.status === 'active' ? 'selected' : ''}>Active</option>
                <option value="archived" ${project.status === 'archived' ? 'selected' : ''}>Archived</option>
              </select>
            </div>`
          : ''
      }`,
    footer: `<button type="button" class="btn ghost" data-close>Cancel</button>
             <button type="button" class="btn primary" data-save>${editing ? 'Save Changes' : 'Create Application'}</button>`,
    onMount(root, close) {
      const btn = root.querySelector('[data-save]');
      btn.addEventListener('click', async () => {
        if (!validateFields(root, { f_name: 'Enter an application name.' })) return;
        const payload = {
          projectName: root.querySelector('#f_name').value.trim(),
          platform: root.querySelector('#f_platform').value,
          targetFps: +root.querySelector('#f_target').value,
          description: root.querySelector('#f_desc').value.trim() || null,
        };
        if (editing) payload.status = root.querySelector('#f_status').value;

        btn.disabled = true;
        try {
          const res = editing ? await api.updateProject(project.id, payload) : await api.createProject(payload);
          toast(editing ? 'Application updated' : 'Application created', 'success');
          close();
          onDone?.(res.project);
        } catch (err) {
          toast(err.userMessage ?? err.message, 'error');
          btn.disabled = false;
        }
      });
    },
  });
}

/* ------------------------------------------------------------- students -- */

export function openStudentForm(student, onDone) {
  const editing = !!student;
  openModal({
    title: editing ? 'Edit Tester' : 'New Tester',
    body: `
      ${field('f_sname', 'Tester name', student?.studentName, { placeholder: 'Alex Rivera', required: true })}
      ${field('f_email', 'Email', student?.email, { placeholder: 'tester@studio.com', hint: '(optional)', type: 'email' })}
      ${
        editing
          ? `<div class="field">
              <label for="f_sstatus">Status</label>
              <select id="f_sstatus">
                <option value="active" ${student.status === 'active' ? 'selected' : ''}>Active</option>
                <option value="archived" ${student.status === 'archived' ? 'selected' : ''}>Archived</option>
              </select>
            </div>`
          : ''
      }`,
    footer: `<button type="button" class="btn ghost" data-close>Cancel</button>
             <button type="button" class="btn primary" data-save>${editing ? 'Save Changes' : 'Create Tester'}</button>`,
    onMount(root, close) {
      const btn = root.querySelector('[data-save]');
      btn.addEventListener('click', async () => {
        if (!validateFields(root, { f_sname: 'Enter a tester name.' })) return;
        const payload = {
          studentName: root.querySelector('#f_sname').value.trim(),
          email: root.querySelector('#f_email').value.trim() || null,
        };
        if (editing) payload.status = root.querySelector('#f_sstatus').value;

        btn.disabled = true;
        try {
          const res = editing ? await api.updateStudent(student.id, payload) : await api.createStudent(payload);
          toast(editing ? 'Tester updated' : 'Tester created', 'success');
          close();
          onDone?.(res.student);
        } catch (err) {
          toast(err.userMessage ?? err.message, 'error');
          btn.disabled = false;
        }
      });
    },
  });
}

/* ------------------------------------------------- archive / delete flow -- */

function removalDialog({ title, name, archiveNote, impactLines, onArchive, onPermanent }) {
  openModal({
    title,
    body: `
      <p class="danger-intro">Choose how <b>${esc(name)}</b> should be removed from this PC.</p>
      <div class="choice">
        <b>Archive <span class="muted">(recommended)</span></b>
        <span class="muted">${esc(archiveNote)}</span>
      </div>
      <div class="choice danger">
        <b>Delete permanently</b>
        <span class="muted">Erases the following from this PC and cannot be undone:</span>
        <ul class="danger-list">${impactLines
          .map(([label, count]) => `<li><span>${esc(label)}</span><b>${int(count)}</b></li>`)
          .join('')}</ul>
      </div>`,
    footer: `<button type="button" class="btn ghost" data-close>Cancel</button>
             <button type="button" class="btn" data-archive>Archive</button>
             <button type="button" class="btn danger-solid" data-perm>Delete Permanently</button>`,
    onMount(root, close) {
      root.querySelector('[data-archive]').addEventListener('click', async () => {
        const b = root.querySelector('[data-archive]');
        b.disabled = true;
        try {
          await onArchive();
          close();
        } catch (err) {
          toast(err.userMessage ?? err.message, 'error');
          b.disabled = false;
        }
      });
      root.querySelector('[data-perm]').addEventListener('click', () => {
        close();
        onPermanent();
      });
    },
  });
}

export async function confirmProjectRemoval(project, onDone) {
  let impact = { sessions: 0, samples: 0, bugs: 0, checklistResults: 0, reportFiles: 0 };
  try {
    impact = (await api.projectImpact(project.id)).impact;
  } catch { /* dialog is still accurate about the action itself */ }

  const lines = [
    ['Test sessions', impact.sessions],
    ['Performance samples', impact.samples],
    ['Checklist results', impact.checklistResults],
    ['Defects', impact.bugs],
    ['Original JSON reports', impact.reportFiles],
  ];

  removalDialog({
    title: 'Remove Application',
    name: project.projectName,
    archiveNote: `Hides it from the active list. All ${impact.sessions} test session(s), reports, charts and defects remain available.`,
    impactLines: [['Application', 1], ...lines],
    onArchive: async () => {
      await api.deleteProject(project.id, false);
      toast('Application archived', 'success');
      onDone?.('archived');
    },
    onPermanent: () =>
      confirmDanger({
        title: 'Delete Application Permanently?',
        intro: `This will permanently delete <b>${esc(project.projectName)}</b> and everything belonging to it.`,
        lines: [['Application', 1], ...lines],
        confirmLabel: 'Delete Permanently',
        onConfirm: () => api.deleteProject(project.id, true),
        onDone: (res) => {
          toast(`Application deleted — ${res.sessions} session(s) and ${res.filesRemoved} report file(s) removed`, 'success');
          onDone?.('permanent');
        },
      }),
  });
}

export async function confirmStudentRemoval(student, onDone) {
  let impact = { sessions: 0, samples: 0, reportFiles: 0 };
  try {
    impact = (await api.studentImpact(student.id)).impact;
  } catch { /* as above */ }

  const lines = [
    ['Test sessions', impact.sessions],
    ['Performance samples', impact.samples],
    ['Original JSON reports', impact.reportFiles],
  ];

  removalDialog({
    title: 'Remove Tester',
    name: student.studentName,
    archiveNote: `Hides them from the active list. Their ${impact.sessions} test session(s) remain available.`,
    impactLines: [['Tester', 1], ...lines],
    onArchive: async () => {
      await api.deleteStudent(student.id, false);
      toast('Tester archived', 'success');
      onDone?.('archived');
    },
    onPermanent: () =>
      confirmDanger({
        title: 'Delete Tester Permanently?',
        intro: `This will permanently delete <b>${esc(student.studentName)}</b> and their captured test data.`,
        lines: [['Tester', 1], ...lines],
        confirmLabel: 'Delete Permanently',
        onConfirm: () => api.deleteStudent(student.id, true),
        onDone: (res) => {
          toast(`Tester deleted — ${res.sessions} session(s) and ${res.filesRemoved} report file(s) removed`, 'success');
          onDone?.('permanent');
        },
      }),
  });
}
