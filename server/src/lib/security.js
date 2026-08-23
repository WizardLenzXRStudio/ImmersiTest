/**
 * Transport-level hardening for the hosted service.
 *
 * The public API is unauthenticated by design — there are no accounts — so the
 * defences here are about limiting what the endpoint will accept rather than
 * who may call it: a strict origin allowlist for browsers, conservative
 * response headers, and a rate limit on the endpoints that allocate memory.
 */
import config from '../config.js';
import { AppError } from './errors.js';

/* ------------------------------------------------------------------- CORS -- */

/**
 * Browser cross-origin access, restricted to the configured allowlist.
 *
 * Requests with no Origin header (the Unity package, curl, server-to-server)
 * are passed through untouched: CORS is a browser mechanism and adding headers
 * for a non-browser client achieves nothing. Those clients are still subject to
 * the rate limit and payload validation.
 */
export function cors(req, res, next) {
  const origin = req.headers.origin;
  if (!origin) return next();

  const allowed = config.allowedOrigins.includes(origin);

  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }

  if (req.method === 'OPTIONS') {
    // Answer the preflight either way; without the headers above the browser
    // refuses the real request, which is the outcome we want.
    return res.status(allowed ? 204 : 403).end();
  }
  return next();
}

/* ---------------------------------------------------------------- headers -- */

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Inline style attributes are used throughout the dashboard markup.
  "style-src 'self' 'unsafe-inline'",
  // Charts are rasterised to data: URIs for the PDF export.
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), usb=()');
  res.setHeader('Content-Security-Policy', CSP);
  if (config.hsts) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

/**
 * A temporary report URL must never leak into a third party's logs through the
 * Referer header, and must never be indexed.
 */
export function noIndex(req, res, next) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  next();
}

/* ------------------------------------------------------------- rate limit -- */

/**
 * Fixed-window in-memory rate limit.
 *
 * Sized for abuse prevention on a single hosted process, not for distributed
 * accuracy. Buckets are pruned lazily so an idle process holds nothing.
 */
export function rateLimit({ windowMs, max, name = 'requests' } = {}) {
  const win = windowMs ?? config.rateLimit.windowMs;
  const cap = max ?? config.rateLimit.max;
  const hits = new Map(); // ip -> { count, resetAt }

  return function rateLimiter(req, res, next) {
    if (!config.rateLimit.enabled) return next();

    const now = Date.now();
    const ip = clientIp(req);
    let bucket = hits.get(ip);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + win };
      hits.set(ip, bucket);
    }
    bucket.count += 1;

    // Opportunistic prune so the map cannot grow without bound.
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    }

    const remaining = Math.max(0, cap - bucket.count);
    res.setHeader('RateLimit-Limit', String(cap));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil((bucket.resetAt - now) / 1000)));

    if (bucket.count > cap) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return next(
        new AppError(
          429,
          'RATE_LIMITED',
          `Too many ${name}. Please wait a moment and try again.`,
        ),
      );
    }
    return next();
  };
}

/**
 * Client IP, honouring exactly as many proxy hops as XRLAB_TRUST_PROXY allows.
 * Trusting the whole X-Forwarded-For chain would let a caller spoof its way
 * around the rate limit by prepending addresses.
 */
export function clientIp(req) {
  const hops = config.trustProxy;
  if (hops > 0) {
    const chain = String(req.headers['x-forwarded-for'] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (chain.length) return chain[Math.max(0, chain.length - hops)];
  }
  return req.socket?.remoteAddress ?? 'unknown';
}
