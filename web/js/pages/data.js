import api from '../api.js';
import { esc, int, bytes, toast } from '../ui.js';
import { loadingState, errorState } from '../states.js';

export async function renderData(main) {
  main.innerHTML = loadingState({ cards: 3, rows: 4, label: 'Loading data summary' });

  let d;
  try {
    d = await api.dataSummary();
  } catch (err) {
    main.innerHTML = errorState(err, { retryId: 'retry' });
    main.querySelector('#retry')?.addEventListener('click', () => renderData(main));
    return;
  }

  const c = d.counts;

  main.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">Local Vault</div>
        <h1>Data Management</h1>
        <div class="meta"><span class="muted">Everything is stored locally on this PC — nothing is sent anywhere</span></div>
      </div>
      <div class="actions">
        <a class="btn primary" href="${api.excelUrl()}" download id="btnExcel">Download Excel</a>
        <a class="btn" href="${api.exportUrl()}" download id="btnExport">Export All Data (JSON)</a>
      </div>
    </div>

    <div class="stat-grid">
      ${card('Stored Reports', c.reportFiles, 'original JSON files')}
      ${card('Test Sessions', c.sessions, `${int(c.samples)} performance samples`)}
      ${card('Storage Used', bytes(d.storage.totalBytes), `${bytes(d.storage.databaseBytes)} database`)}
    </div>

    <section class="section" aria-labelledby="backup-h">
      <h3 id="backup-h">Export &amp; Backup</h3>
      <p class="muted" style="font-size:13.5px;line-height:1.6;margin-bottom:12px">
        <b>Download Excel</b> produces an <code>.xlsx</code> workbook with five sheets —
        one row per test session, covering every application, tester, metric, XR validation
        stored on this PC. Best for marking, review and sharing.
      </p>
      <p class="muted" style="font-size:13.5px;line-height:1.6;margin-bottom:12px">
        <b>Export All Data (JSON)</b> downloads a portable bundle that also carries the
        performance samples and the original profiler report for every session. It is
        enough on its own to reconstruct the full archive.
      </p>
      <p class="muted" style="font-size:13.5px;line-height:1.6">
        To back up manually instead, copy the whole <code>data</code> folder while the server is
        stopped. That folder holds the database and every original report.
      </p>
      <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn primary" href="${api.excelUrl()}" download>Download Excel</a>
        <a class="btn" href="${api.exportUrl()}" download>Export All Data (JSON)</a>
        <button type="button" class="btn" id="btnCopyPath">Copy Data Folder Path</button>
      </div>
    </section>

    <section class="section" aria-labelledby="loc-h">
      <h3 id="loc-h">Storage Locations</h3>
      <dl class="kv">
        <dt>Data folder</dt><dd id="dataPath">${esc(d.location.dataFolder)}</dd>
        <dt>Database</dt><dd>${esc(d.location.database)}</dd>
        <dt>Original reports</dt><dd>${esc(d.location.reports)}</dd>
      </dl>
    </section>

    <section class="section" aria-labelledby="cnt-h">
      <h3 id="cnt-h">Stored Records</h3>
      <dl class="kv">
        <dt>Applications</dt><dd>${int(c.projects)}</dd>
        <dt>Testers</dt><dd>${int(c.students)}</dd>
        <dt>Test sessions</dt><dd>${int(c.sessions)}</dd>
        <dt>Performance samples</dt><dd>${int(c.samples)}</dd>
        <dt>Checklist results</dt><dd>${int(c.checklistResults)}</dd>
        <dt>Defects</dt><dd>${int(c.bugs)}</dd>
        <dt>Original report files</dt><dd>${int(c.reportFiles)} (${bytes(d.storage.reportsBytes)})</dd>
      </dl>
    </section>

    <section class="section" aria-labelledby="about-h">
      <h3 id="about-h">About</h3>
      <dl class="kv">
        <dt>Application version</dt><dd>${esc(d.version)}</dd>
        <dt>Database schema</dt><dd>v${esc(d.schemaVersion)}</dd>
        <dt>Profiler contract</dt><dd>xr-test-profile-v1</dd>
      </dl>
    </section>`;

  main.querySelector('#btnExport').addEventListener('click', () => toast('Preparing your backup…'));
  main.querySelector('#btnExcel').addEventListener('click', () => toast('Building your Excel workbook…'));
  main.querySelector('#btnCopyPath').addEventListener('click', async () => {
    const path = d.location.dataFolder;
    try {
      await navigator.clipboard.writeText(path);
      toast('Data folder path copied', 'success');
    } catch {
      // Clipboard needs a secure context; fall back to selecting the text.
      const el = main.querySelector('#dataPath');
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      toast('Path selected — press Ctrl+C to copy');
    }
  });
}

function card(label, value, sub) {
  return `<div class="stat">
    <div class="stat-label">${esc(label)}</div>
    <div class="stat-value">${typeof value === 'number' ? int(value) : esc(value)}</div>
    <div class="stat-sub">${esc(sub)}</div>
  </div>`;
}
