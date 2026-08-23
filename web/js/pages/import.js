import api from '../api.js';
import { esc, r1, fmtDate, platformPill, toast } from '../ui.js';
import { errorState } from '../states.js';
import { icons } from '../icons.js';

let staged = [];
let preview = null;

export function renderImport(main) {
  staged = [];
  preview = null;
  drawPicker(main);
}

function drawPicker(main) {
  main.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">Ingest</div>
        <h1>Import Test Report</h1>
        <div class="meta"><span class="muted">Select the <code>xrtest_*.json</code> files produced by XRTestProfiler in Unity</span></div>
      </div>
    </div>

    <section class="section">
      <div class="dropzone" id="drop">
        <div class="dz-icon" aria-hidden="true">${icons.upload(38)}</div>
        <p><b>Drag and drop performance reports here</b></p>
        <p class="muted" style="font-size:13px;margin:6px 0 12px">or</p>
        <button type="button" class="btn primary" id="pick">Choose Files</button>
        <label for="fileInput" class="sr-only">Choose profiler JSON files</label>
        <input type="file" id="fileInput" accept=".json,application/json" multiple hidden>
        <p class="muted" style="font-size:12.5px;margin-top:14px">
          Files are checked before anything is saved. Reports are stored permanently in the local
          database and copied to <code>data/reports/</code>.
        </p>
      </div>
    </section>

    <div id="previewArea" aria-live="polite"></div>`;

  const input = main.querySelector('#fileInput');
  const drop = main.querySelector('#drop');

  main.querySelector('#pick').addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    handleFiles(main, [...input.files]);
    input.value = '';
  });

  ['dragenter', 'dragover'].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add('over');
    }),
  );
  ['dragleave', 'drop'].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove('over');
    }),
  );
  drop.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files ?? [])].filter((f) => f.name.toLowerCase().endsWith('.json'));
    if (files.length) handleFiles(main, files);
    else toast('Only .json files can be imported.', 'error');
  });
}

async function handleFiles(main, files) {
  if (!files.length) return;
  const area = main.querySelector('#previewArea');
  area.innerHTML = `<section class="section"><div class="state">
      <div class="state-title">Checking ${files.length} file${files.length === 1 ? '' : 's'}…</div>
      <p class="state-msg">Nothing is saved until you confirm.</p></div></section>`;

  staged = await Promise.all(
    files.map(
      (f) =>
        new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve({ filename: f.name, content: String(reader.result) });
          reader.onerror = () => resolve({ filename: f.name, content: '' });
          reader.readAsText(f);
        }),
    ),
  );

  try {
    preview = await api.previewReports(staged);
  } catch (err) {
    area.innerHTML = `<section class="section">${errorState(err)}</section>`;
    return;
  }
  drawPreview(main);
}

const STATUS_CHIP = {
  valid: '<span class="chip ok">Valid</span>',
  duplicate: '<span class="chip dup">Duplicate</span>',
  invalid: '<span class="chip bad">Invalid</span>',
  imported: '<span class="chip ok">Imported</span>',
};

function reasonCell(r) {
  if (r.reason) {
    return `<div class="reason">${esc(r.reason)}${r.errorCode ? `<span class="code">${esc(r.errorCode)}</span>` : ''}</div>`;
  }
  if (r.warnings?.length) return `<div class="reason warn-text">${esc(r.warnings.join(' '))}</div>`;
  return '<span class="muted">Ready to import</span>';
}

function drawPreview(main) {
  const { summary, results } = preview;
  const area = main.querySelector('#previewArea');

  area.innerHTML = `
    <section class="section" aria-labelledby="prev-h">
      <h3 id="prev-h">Validation Result <span class="hint">${summary.total} file(s) checked · nothing saved yet</span></h3>
      <div class="import-summary">
        <span class="chip ok">${summary.valid} Valid</span>
        <span class="chip dup">${summary.duplicate} Duplicate</span>
        <span class="chip bad">${summary.invalid} Invalid</span>
      </div>

      <div class="ctable-wrap" style="margin-top:14px">
        <table class="ctable">
          <caption class="sr-only">Validation result for each selected file</caption>
          <thead><tr>
            <th scope="col"><span class="sortbtn">Filename</span></th>
            <th scope="col"><span class="sortbtn">Application</span></th>
            <th scope="col"><span class="sortbtn">Tester</span></th>
            <th scope="col"><span class="sortbtn">Captured At</span></th>
            <th scope="col"><span class="sortbtn">Platform</span></th>
            <th scope="col"><span class="sortbtn">Status</span></th>
            <th scope="col"><span class="sortbtn">Reason</span></th>
          </tr></thead>
          <tbody>${results.map(previewRow).join('')}</tbody>
        </table>
      </div>

      <div class="modal-actions" style="justify-content:flex-start">
        <button type="button" class="btn primary" id="btnCommit" ${summary.valid ? '' : 'disabled'}>
          Import ${summary.valid} Valid Report${summary.valid === 1 ? '' : 's'}
        </button>
        <button type="button" class="btn ghost" id="btnReset">Choose Different Files</button>
      </div>
      ${
        summary.valid < summary.total
          ? `<p class="muted" style="font-size:12.5px;margin-top:10px">
              Duplicate and invalid files are skipped — only the ${summary.valid} valid report(s) will be imported.</p>`
          : ''
      }
    </section>`;

  main.querySelector('#btnReset').addEventListener('click', () => drawPicker(main));
  main.querySelector('#btnCommit').addEventListener('click', async () => {
    const btn = main.querySelector('#btnCommit');
    btn.disabled = true;
    btn.textContent = 'Importing…';

    const validNames = new Set(results.filter((r) => r.status === 'valid').map((r) => r.filename));
    const toSend = staged.filter((f) => validNames.has(f.filename));

    try {
      drawResult(main, await api.importReports(toSend));
    } catch (err) {
      toast(err.userMessage ?? err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Retry Import';
    }
  });
}

function previewRow(r) {
  const p = r.preview;
  return `<tr>
    <td><code>${esc(r.filename ?? '—')}</code></td>
    <td>${esc(p?.projectName ?? '—')}</td>
    <td>${esc(p?.studentName ?? '—')}</td>
    <td>${p?.capturedAt ? fmtDate(p.capturedAt) : '—'}</td>
    <td>${p?.platform ? platformPill(p.platform) : '—'}</td>
    <td>${STATUS_CHIP[r.status] ?? esc(r.status)}</td>
    <td class="wrap">${reasonCell(r)}</td>
  </tr>`;
}

function drawResult(main, res) {
  const area = main.querySelector('#previewArea');
  const imported = res.results.filter((r) => r.status === 'imported');
  const n = res.summary.imported;

  area.innerHTML = `
    <section class="section" aria-labelledby="done-h">
      <h3 id="done-h">Import Complete</h3>
      <div class="state ok" style="padding:26px 20px">
        <div class="state-icon" aria-hidden="true">${icons.check(34)}</div>
        <div class="state-title">${n} test report${n === 1 ? '' : 's'} imported successfully.</div>
        <p class="state-msg">
          ${res.summary.duplicate ? `${res.summary.duplicate} duplicate file(s) were skipped. ` : ''}
          ${res.summary.invalid ? `${res.summary.invalid} file(s) could not be imported. ` : ''}
          Reports are now stored permanently on this PC.
        </p>
        <div class="state-actions">
          ${imported.length === 1
            ? `<a class="btn primary" href="#/sessions/${esc(imported[0].sessionId)}">View Imported Report</a>`
            : `<a class="btn primary" href="#/sessions">View Imported Reports</a>`}
          <a class="btn" href="#/">Go to Dashboard</a>
          <button type="button" class="btn ghost" id="btnMore">Import More</button>
        </div>
      </div>

      <div class="ctable-wrap" style="margin-top:6px">
        <table class="ctable">
          <caption class="sr-only">Outcome for each imported file</caption>
          <thead><tr>
            <th scope="col"><span class="sortbtn">Filename</span></th>
            <th scope="col"><span class="sortbtn">Status</span></th>
            <th scope="col"><span class="sortbtn">Application</span></th>
            <th scope="col"><span class="sortbtn">Tester</span></th>
            <th scope="col"><span class="sortbtn">Grade</span></th>
            <th scope="col"><span class="sortbtn">Notes</span></th>
          </tr></thead>
          <tbody>${res.results
            .map(
              (r) => `<tr>
              <td><code>${esc(r.filename ?? '—')}</code></td>
              <td>${STATUS_CHIP[r.status] ?? esc(r.status)}</td>
              <td>${r.projectId ? `<a href="#/projects/${esc(r.projectId)}">${esc(r.projectName)}</a>` : '—'}${r.projectCreated ? ' <span class="chip new">new</span>' : ''}</td>
              <td>${r.studentName ? esc(r.studentName) : '—'}${r.studentCreated ? ' <span class="chip new">new</span>' : ''}</td>
              <td>${r.grade ? esc(r.grade) : r.captureStatus === 'invalid' ? '<span class="chip bad">No data</span>' : '—'}</td>
              <td class="wrap">${reasonCell(r)}</td>
            </tr>`,
            )
            .join('')}</tbody>
        </table>
      </div>
    </section>`;

  main.querySelector('#btnMore').addEventListener('click', () => drawPicker(main));
}
