/** Thin fetch wrapper. Every call goes to the ImmersiTest API on this origin. */

/**
 * Plain-English text for the error codes the API can return. The raw code and
 * server message stay on the error object for the console; the user sees this.
 */
const FRIENDLY = {
  NOT_FOUND: 'That item no longer exists. It may have been deleted in another tab.',
  DUPLICATE: 'A record with these details already exists. Try a different name.',
  FOREIGN_KEY: 'Unable to complete this because some related data could not be updated.',
  INVALID_VALUE: 'One of the values submitted is not allowed.',
  BAD_REQUEST: 'Some required information is missing or invalid.',
  INVALID_JSON: 'The data sent could not be read.',
  TOO_LARGE: 'That report is too large to analyse.',
  RATE_LIMITED: 'Too many uploads from this connection. Wait a moment and try again.',
  SESSION_EXPIRED: 'This analysis has expired. Temporary reports are deleted automatically.',
  SESSION_FULL: 'This analysis already holds the maximum number of reports.',
  UNSUPPORTED_SCHEMA: 'That report was written by a profiler version this service cannot read yet.',
  MISSING_SCHEMA: 'That file was not produced by the XR Test Profiler.',
  MISSING_REQUIRED_FIELD: 'That report is missing information the analysis needs.',
  NOT_A_REPORT: 'That file does not contain a single XR test report.',
  INTERNAL_ERROR: 'The service hit an unexpected problem. Please try again.',
  OFFLINE: 'Could not reach the ImmersiTest service. Check your connection and try again.',
};

function friendly(code, serverMessage, status) {
  if (FRIENDLY[code]) return FRIENDLY[code];
  if (status === 404) return FRIENDLY.NOT_FOUND;
  if (status >= 500) return FRIENDLY.INTERNAL_ERROR;
  return serverMessage || 'The request could not be completed.';
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    const err = new Error(networkErr.message);
    err.code = 'OFFLINE';
    err.userMessage = FRIENDLY.OFFLINE;
    console.error('[api] network failure', method, path, networkErr);
    throw err;
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const code = data?.error?.code ?? `HTTP_${res.status}`;
    const err = new Error(data?.error?.message ?? `Request failed (${res.status})`);
    err.code = code;
    err.status = res.status;
    err.details = data?.error?.details;
    err.userMessage = friendly(code, data?.error?.message, res.status);
    // Technical detail to the console only.
    console.error('[api]', method, path, res.status, code, data?.error?.message);
    throw err;
  }
  return data;
}

const get = (p) => request('GET', p);
const post = (p, b) => request('POST', p, b);
const patch = (p, b) => request('PATCH', p, b);
const put = (p, b) => request('PUT', p, b);
const del = (p) => request('DELETE', p);

export const api = {
  health: () => get('/health'),
  checklistItems: () => get('/checklist-items'),

  /* ---- temporary analysis sessions (hosted workflow, also available locally) */
  analyze: (report, filename) => post('/analyze', { report, filename }),
  analysis: (token) => get(`/analysis/${encodeURIComponent(token)}`),
  addAnalysisReport: (token, report, filename) =>
    post(`/analysis/${encodeURIComponent(token)}/reports`, { report, filename }),
  setHostedCheck: (token, reportId, itemId, result) =>
    put(
      `/analysis/${encodeURIComponent(token)}/reports/${encodeURIComponent(reportId)}/checklist/${encodeURIComponent(itemId)}`,
      { result },
    ),
  deleteAnalysis: (token) => del(`/analysis/${encodeURIComponent(token)}`),

  /* ---- local dashboard (local mode only) ---------------------------------- */
  stats: () => get('/dashboard/stats'),

  projects: (includeArchived = false) => get(`/projects?includeArchived=${includeArchived}`),
  project: (id) => get(`/projects/${id}`),
  createProject: (b) => post('/projects', b),
  updateProject: (id, b) => patch(`/projects/${id}`, b),
  projectImpact: (id) => get(`/projects/${id}/deletion-impact`),
  deleteProject: (id, permanent) => del(`/projects/${id}?permanent=${!!permanent}`),

  students: (includeArchived = false) => get(`/students?includeArchived=${includeArchived}`),
  student: (id) => get(`/students/${id}`),
  createStudent: (b) => post('/students', b),
  updateStudent: (id, b) => patch(`/students/${id}`, b),
  studentImpact: (id) => get(`/students/${id}/deletion-impact`),
  deleteStudent: (id, permanent) => del(`/students/${id}?permanent=${!!permanent}`),

  sessions: (q = '') => get(`/sessions${q}`),
  session: (id) => get(`/sessions/${id}`),
  deleteSession: (id) => del(`/sessions/${id}`),
  setCheck: (id, itemId, result) => put(`/sessions/${id}/checklist/${itemId}`, { result }),
  rawUrl: (id, download) => `/api/sessions/${id}/raw${download ? '?download=true' : ''}`,

  bugs: (q = '') => get(`/bugs${q}`),
  bug: (id) => get(`/bugs/${id}`),
  createBug: (b) => post('/bugs', b),
  updateBug: (id, b) => patch(`/bugs/${id}`, b),
  deleteBug: (id) => del(`/bugs/${id}`),

  previewReports: (files) => post('/reports/preview', { files }),
  importReports: (files) => post('/reports/import', { files }),

  migrateStatus: () => get('/migrate/status'),
  migrateLocalStorage: (projects) => post('/migrate/localstorage', { projects }),

  dataSummary: () => get('/data/summary'),
  exportUrl: () => '/api/data/export',
  excelUrl: () => '/api/data/export.xlsx',
};

export default api;
