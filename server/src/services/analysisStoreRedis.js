/**
 * Temporary analysis sessions, backed by Upstash Redis over HTTP.
 *
 * WHY THIS EXISTS
 * ---------------
 * analysisStore.js keeps sessions in a process-local Map. That is exactly right
 * for a long-lived server, but it cannot work on a serverless platform: the
 * Unity POST /api/analyze and the browser's GET /api/analysis/:token are two
 * separate invocations that may land on different instances sharing no memory,
 * so the report would intermittently appear expired.
 *
 * This driver keeps the identical session shape and the identical rules — it
 * only moves *where* the session lives. Nothing about scoring, validation or
 * report structure changes.
 *
 * WHAT IS PRESERVED
 *   - reports stay temporary: every key carries a Redis expiry
 *   - expiry stays ABSOLUTE: re-saving a session after a mutation uses EXAT
 *     against the original expiresAt, so viewing or editing never slides the TTL
 *   - tokens still come from a CSPRNG, never from client input
 *   - the same duplicate-report and session-full rules apply
 *   - nothing is ever written to disk
 *
 * The HTTP client is used deliberately: a TCP Redis connection pool does not
 * survive serverless instance recycling, whereas a stateless REST call does.
 */
import { randomBytes, createHash } from 'node:crypto';
import config from '../config.js';
import { SessionFullError, DuplicateReportError, safeDisplayName } from './analysisStore.js';

/** Namespaced so the store can share a database without colliding. */
const KEY_PREFIX = 'immersitest:sess:';
const keyFor = (token) => KEY_PREFIX + token;

const newToken = () => randomBytes(24).toString('base64url');
const newReportId = () => `rep_${randomBytes(8).toString('hex')}`;
const hashOf = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/* ----------------------------------------------------------------- client -- */

let client = null;

/**
 * A single connection URL is all this driver needs.
 *
 *   Vercel KV  -> KV_REDIS_URL (also seen as KV_URL)
 *   any Redis  -> REDIS_URL
 *
 * `rediss://` selects TLS automatically, which is what managed providers issue.
 */
export function redisUrl(env = process.env) {
  const url = env.KV_REDIS_URL ?? env.KV_URL ?? env.REDIS_URL ?? null;
  return typeof url === 'string' && url.trim() ? url.trim() : null;
}

export const isConfigured = () => redisUrl() !== null;

/**
 * One client per process, created on first use.
 *
 * The module is imported lazily so the memory driver — and therefore local
 * development and the test suite — never loads it at all.
 *
 * Serverless note: the connection is held at module scope so a warm instance
 * reuses it instead of reconnecting per request. `lazyConnect` keeps a cold
 * start from paying for a handshake it may not need, and the retry ceiling
 * stops a request hanging on an unreachable server.
 */
async function redis() {
  if (client) return client;
  const url = redisUrl();
  if (!url) {
    throw new Error(
      'Redis store selected but no connection URL found. Set KV_REDIS_URL '
      + '(or KV_URL / REDIS_URL).',
    );
  }
  const { default: Redis } = await import('ioredis');
  client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableReadyCheck: false,
    connectTimeout: 8000,
  });
  // Without a listener a transient drop becomes an unhandled 'error' event and
  // takes the process down; the command itself still surfaces the failure.
  client.on('error', (err) => console.warn('[immersitest] redis:', err.message));
  return client;
}

/* ------------------------------------------------------------ persistence -- */

const isExpired = (s, now = Date.now()) => s.expiresAt <= now;

/**
 * Writes a session back under its ORIGINAL expiry.
 *
 * EXAT (absolute unix seconds) rather than EX (relative seconds) is the whole
 * point: a mutation must never buy the session more time.
 */
async function save(session) {
  const exat = Math.ceil(session.expiresAt / 1000);
  // Already past its expiry — let it disappear rather than resurrect it.
  if (exat * 1000 <= Date.now()) return session;
  const r = await redis();
  // EXAT (absolute unix seconds), never EX (relative): a mutation must not buy
  // the session more time than it started with.
  await r.set(keyFor(session.token), JSON.stringify(session), 'EXAT', exat);
  return session;
}

async function load(token) {
  if (typeof token !== 'string' || !token) return null;
  const r = await redis();
  const raw = await r.get(keyFor(token));
  if (raw == null) return null;
  // The client may hand back a parsed object or the original string.
  const session = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (isExpired(session)) {
    await r.del(keyFor(token));
    return null;
  }
  return session;
}

/* --------------------------------------------------------------- lifecycle -- */

/** Redis expires keys itself, so there is nothing for a sweeper to do. */
export function sweep() {
  return 0;
}
export function startSweeper() {
  return null;
}
export function stopSweeper() {}

/** Test/ops helper: drops every session this application owns. */
export async function reset() {
  const r = await redis();
  let cursor = '0';
  do {
    const [next, keys] = await r.scan(cursor, 'MATCH', `${KEY_PREFIX}*`, 'COUNT', 200);
    cursor = String(next);
    if (keys.length) await r.del(...keys);
  } while (cursor !== '0');
}

/* ------------------------------------------------------------------ create -- */

export async function createSession() {
  const now = Date.now();
  const session = {
    token: newToken(),
    createdAt: new Date(now).toISOString(),
    expiresAt: now + config.session.ttlMs,
    reports: [],
    bytes: 0,
  };
  return save(session);
}

/** @returns {Promise<object|null>} the live session, or null when gone. */
export async function getSession(token) {
  return load(token);
}

export async function deleteSession(token) {
  if (typeof token !== 'string' || !token) return false;
  const r = await redis();
  const removed = await r.del(keyFor(token));
  return Number(removed) > 0;
}

/* ----------------------------------------------------------------- reports -- */

export async function addReport(session, validated, { filename, source = 'unity', warnings = [], raw }) {
  if (session.reports.length >= config.session.maxReports) {
    throw new SessionFullError(
      `An analysis session holds at most ${config.session.maxReports} reports`,
    );
  }

  const body = raw ?? JSON.stringify(validated);
  const hash = hashOf(body);

  // Same rule as the memory store: the same report twice in one session would
  // produce a meaningless "compared against itself" result.
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
  await save(session);
  return report;
}

/** Pure lookup on an already-loaded session — no I/O. */
export function getReport(session, reportId) {
  return session.reports.find((r) => r.id === reportId) ?? null;
}

export async function setChecklistResult(session, reportId, itemId, result) {
  const report = getReport(session, reportId);
  if (!report) return null;
  if (result == null) delete report.checklist[itemId];
  else report.checklist[itemId] = result;
  await save(session);
  return report.checklist;
}

/* -------------------------------------------------------------------- stats -- */

/**
 * Counting every session would mean SCANning the keyspace on a request path, so
 * this reports what is cheap and honest instead. Redis owns expiry here, so
 * there is no backlog to report.
 */
export async function stats() {
  let sessions = null;
  try {
    const r = await redis();
    let cursor = '0';
    let n = 0;
    do {
      const [next, keys] = await r.scan(cursor, 'MATCH', `${KEY_PREFIX}*`, 'COUNT', 500);
      cursor = String(next);
      n += keys.length;
    } while (cursor !== '0' && n < 5000);
    sessions = n;
  } catch {
    sessions = null; // never fail a diagnostic endpoint over a counter
  }
  return {
    sessions,
    reports: null,
    bytes: null,
    ttlMinutes: Math.round(config.session.ttlMs / 60_000),
    driver: 'redis',
  };
}

export { SessionFullError, DuplicateReportError, safeDisplayName };
