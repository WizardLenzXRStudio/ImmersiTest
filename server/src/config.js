/**
 * Configuration.
 *
 * XR Test Lab runs in one of two modes:
 *
 *   local   (default)  Development and offline single-machine use. The SQLite
 *                      dashboard is mounted, data persists in data/, and the
 *                      server binds to loopback only.
 *
 *   hosted             The public service (Hostinger). NO database, NO accounts
 *                      and NO permanent report storage: uploads become
 *                      short-lived in-memory analysis sessions that expire.
 *
 * Everything environment-specific is read from env vars — nothing about the
 * production deployment is hard-coded, and localhost is never assumed in
 * hosted mode.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/* ------------------------------------------------------------------ utils -- */

const str = (v, fallback) => (v == null || v === '' ? fallback : String(v));
const int = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};
const bool = (v, fallback) => {
  if (v == null || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(v));
};

/** "4mb" | "512kb" | "1048576" -> bytes. Used to enforce our own size guard. */
export function parseBytes(value, fallback) {
  if (value == null || value === '') return fallback;
  const m = String(value).trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/);
  if (!m) return fallback;
  const mult = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[m[2] ?? 'b'];
  return Math.floor(Number(m[1]) * mult);
}

/** Normalises a URL to its bare origin, or null when unusable. */
export function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------- mode -- */

const rawMode = str(process.env.XRLAB_MODE, 'local').toLowerCase();
if (!['local', 'hosted'].includes(rawMode)) {
  throw new Error(`XRLAB_MODE must be "local" or "hosted" (received "${rawMode}")`);
}
const mode = rawMode;
const isHosted = mode === 'hosted';

const port = int(process.env.PORT, 3000);

/**
 * Public base URL. In hosted mode this MUST be set to the real HTTPS domain —
 * it is what the Unity package opens in the browser, so a wrong value produces
 * an unreachable report link.
 */
const publicBaseUrl = str(process.env.XRLAB_PUBLIC_URL, `http://localhost:${port}`).replace(/\/+$/, '');

if (isHosted) {
  if (!originOf(publicBaseUrl)) {
    throw new Error(`XRLAB_PUBLIC_URL is not a valid URL: "${publicBaseUrl}"`);
  }
  if (!publicBaseUrl.startsWith('https://') && !bool(process.env.XRLAB_ALLOW_INSECURE, false)) {
    throw new Error(
      'Hosted mode requires an HTTPS XRLAB_PUBLIC_URL. Set XRLAB_ALLOW_INSECURE=true only for a trusted staging box.',
    );
  }
}

/**
 * Browser origins allowed to call the API cross-origin. The app's own origin is
 * always permitted. Unity uploads send no Origin header and are unaffected.
 */
const allowedOrigins = [
  ...new Set(
    [
      originOf(publicBaseUrl),
      ...str(process.env.XRLAB_ALLOWED_ORIGINS, '')
        .split(',')
        .map((o) => originOf(o.trim()))
        .filter(Boolean),
    ].filter(Boolean),
  ),
];

/* ------------------------------------------------------------------ paths -- */

export const paths = {
  root,
  webDir: resolve(root, 'web'),
  sharedDir: resolve(root, 'shared'),
  dataDir: resolve(root, 'data'),
  reportsDir: resolve(root, 'data/reports'),
  dbFile: process.env.XRLAB_DB ?? resolve(root, 'data/xr-test-lab.db'),
  schemaFile: resolve(root, 'server/src/db/schema.sql'),
};

/* ----------------------------------------------------------------- config -- */

export const config = {
  mode,
  isHosted,
  isLocal: !isHosted,
  port,
  /** Loopback in local mode; hosted runs behind the Hostinger reverse proxy. */
  host: str(process.env.XRLAB_HOST, isHosted ? '0.0.0.0' : '127.0.0.1'),
  /** Number of proxy hops to trust for client IPs (rate limiting). */
  trustProxy: int(process.env.XRLAB_TRUST_PROXY, isHosted ? 1 : 0),

  publicBaseUrl,
  allowedOrigins,

  /** Body limit for the local bulk-import endpoint (many reports per request). */
  jsonBodyLimit: str(process.env.JSON_BODY_LIMIT, '25mb'),
  /** Body limit for a single profiler upload. Deliberately much smaller. */
  uploadLimit: str(process.env.XRLAB_UPLOAD_LIMIT, '4mb'),

  /** Temporary analysis sessions. */
  session: {
    ttlMs: int(process.env.XRLAB_SESSION_TTL_MINUTES, 60) * 60_000,
    /** Reports that may share one analysis session (comparison / trend). */
    maxReports: int(process.env.XRLAB_SESSION_MAX_REPORTS, 25),
    /** Hard ceiling on concurrent sessions; oldest are evicted beyond it. */
    maxSessions: int(process.env.XRLAB_MAX_SESSIONS, 1000),
    /** Hard ceiling on total retained bytes across all sessions. */
    maxTotalBytes: parseBytes(process.env.XRLAB_MAX_TOTAL_BYTES, 256 * 1024 * 1024),
    sweepIntervalMs: int(process.env.XRLAB_SWEEP_SECONDS, 60) * 1000,
  },

  /** Fixed-window rate limit applied to upload endpoints. */
  rateLimit: {
    windowMs: int(process.env.XRLAB_RATE_WINDOW_SECONDS, 60) * 1000,
    max: int(process.env.XRLAB_RATE_MAX, 30),
    enabled: bool(process.env.XRLAB_RATE_LIMIT, true),
  },

  /** Send HSTS. Only meaningful once the domain is HTTPS-only. */
  hsts: bool(process.env.XRLAB_HSTS, isHosted),

  version: '2.0.0',
  product: 'ImmersiTest',
  vendor: 'Wizardlenz XR Studio',
  tagline: 'Test the Experience. Trust the Immersion.',
};

/** Bytes form of the single-upload limit, for our own pre-checks. */
config.uploadLimitBytes = parseBytes(config.uploadLimit, 4 * 1024 * 1024);

export default config;
