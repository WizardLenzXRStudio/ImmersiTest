/**
 * Temporary analysis sessions.
 *
 * This is the whole storage layer of the hosted service, and it is deliberately
 * in-memory and short-lived:
 *
 *   - a report exists only inside a session, and only until that session expires
 *   - expiry is ABSOLUTE from creation, never extended by activity, so a report
 *     cannot be kept alive indefinitely by polling it
 *   - a process restart drops everything, which is the correct failure mode for
 *     a service that promises not to retain user data
 *   - nothing is ever written to disk
 *
 * Tokens are generated server-side from a CSPRNG. Nothing supplied by the
 * client — filename, project name, ids — is used to address a session.
 */
import { randomBytes, createHash } from 'node:crypto';
import config from '../config.js';

/** token -> session */
const sessions = new Map();
let totalBytes = 0;
let sweeper = null;

/* ------------------------------------------------------------------- ids -- */

/** 192 bits of entropy, URL-safe. Unguessable is the only access control here. */
const newToken = () => randomBytes(24).toString('base64url');
const newReportId = () => `rep_${randomBytes(8).toString('hex')}`;

const hashOf = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Filenames are display-only. They never touch the filesystem and never
 * identify anything, but they are still stripped of path separators and
 * control characters before being echoed back to a browser.
 */
export function safeDisplayName(name) {
  if (typeof name !== 'string') return null;
  const cleaned = name
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[\\/]/g, '_')
    .trim()
    .slice(0, 120);
  return cleaned || null;
}

/* -------------------------------------------------------------- lifecycle -- */

const isExpired = (s, now = Date.now()) => s.expiresAt <= now;

function drop(token) {
  const s = sessions.get(token);
  if (!s) return false;
  totalBytes -= s.bytes;
  sessions.delete(token);
  return true;
}

/** Removes expired sessions. Runs on a timer and before every lookup. */
export function sweep(now = Date.now()) {
  let removed = 0;
  for (const [token, s] of sessions) {
    if (isExpired(s, now)) {
      drop(token);
      removed++;
    }
  }
  return removed;
}

/** Evicts oldest sessions until both the count and byte ceilings are met. */
function enforceCeilings() {
  const { maxSessions, maxTotalBytes } = config.session;
  if (sessions.size <= maxSessions && totalBytes <= maxTotalBytes) return;
  // Map preserves insertion order, and sessions are inserted in creation order.
  for (const token of sessions.keys()) {
    if (sessions.size <= maxSessions && totalBytes <= maxTotalBytes) break;
    drop(token);
  }
}

/** Starts the background sweeper. Unref'd so it never holds the process open. */
export function startSweeper() {
  if (sweeper) return sweeper;
  sweeper = setInterval(() => sweep(), config.session.sweepIntervalMs);
  sweeper.unref?.();
  return sweeper;
}

export function stopSweeper() {
  if (sweeper) clearInterval(sweeper);
  sweeper = null;
}

/** Test/ops helper: forget everything immediately. */
export function reset() {
  sessions.clear();
  totalBytes = 0;
}

/* ----------------------------------------------------------------- create -- */

export function createSession() {
  sweep();
  const now = Date.now();
  const token = newToken();
  const session = {
    token,
    createdAt: new Date(now).toISOString(),
    expiresAt: now + config.session.ttlMs,
    reports: [],
    bytes: 0,
  };
  sessions.set(token, session);
  enforceCeilings();
  return session;
}

/** @returns {object|null} the live session, or null when missing or expired. */
export function getSession(token) {
  if (typeof token !== 'string' || !token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (isExpired(s)) {
    drop(token);
    return null;
  }
  return s;
}

export function deleteSession(token) {
  return drop(token);
}

/* ---------------------------------------------------------------- reports -- */

export class SessionFullError extends Error {}
export class DuplicateReportError extends Error {
  constructor(reportId) {
    super('Report already present in this analysis session');
    this.reportId = reportId;
  }
}

/**
 * Adds a validated report to a session.
 *
 * @param {object} session   from createSession/getSession
 * @param {object} validated the normalised report from validateReport()
 * @param {object} meta      { filename, source, warnings, raw }
 */
export function addReport(session, validated, { filename, source = 'unity', warnings = [], raw }) {
  if (session.reports.length >= config.session.maxReports) {
    throw new SessionFullError(
      `An analysis session holds at most ${config.session.maxReports} reports`,
    );
  }

  const body = raw ?? JSON.stringify(validated);
  const hash = hashOf(body);

  // Uploading the same report twice into one session would produce a
  // meaningless "compared against itself" result, so it resolves to the
  // existing entry instead.
  const existing = session.reports.find((r) => r.hash === hash);
  if (existing) throw new DuplicateReportError(existing.id);

  const bytes = Buffer.byteLength(body, 'utf8');
  const report = {
    id: newReportId(),
    hash,
    receivedAt: new Date().toISOString(),
    filename: safeDisplayName(filename),
    source: source === 'browser' ? 'browser' : 'unity',
    warnings,
    data: validated,
    raw: body,
    checklist: {},
    bytes,
  };

  session.reports.push(report);
  session.bytes += bytes;
  totalBytes += bytes;
  enforceCeilings();
  return report;
}

export function getReport(session, reportId) {
  return session.reports.find((r) => r.id === reportId) ?? null;
}

export function setChecklistResult(session, reportId, itemId, result) {
  const report = getReport(session, reportId);
  if (!report) return null;
  if (result == null) delete report.checklist[itemId];
  else report.checklist[itemId] = result;
  return report.checklist;
}

/* ------------------------------------------------------------------ stats -- */

export function stats() {
  sweep();
  return {
    sessions: sessions.size,
    reports: [...sessions.values()].reduce((n, s) => n + s.reports.length, 0),
    bytes: totalBytes,
    ttlMinutes: Math.round(config.session.ttlMs / 60_000),
  };
}
