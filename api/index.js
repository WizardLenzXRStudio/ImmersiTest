/**
 * Vercel serverless entry point.
 *
 * Vercel wants an exported request handler, not a process that calls
 * app.listen(). The Express application itself IS such a handler, so this file
 * is a genuine adapter and not a second copy of the server: it imports the same
 * createApp() that `npm start` uses, so routing, static serving, the SPA
 * fallback, security headers and every API route behave identically.
 *
 * WHY EVERY REQUEST COMES THROUGH HERE
 *   vercel.json rewrites all paths to this function rather than letting Vercel
 *   serve web/ as static files. That is deliberate:
 *
 *     - the SPA fallback, the /shared mount and the "source files are never
 *       served" behaviour all live inside the Express app. Re-expressing them
 *       as platform rewrite rules would mean maintaining the same policy twice
 *       and risking divergence — exactly where an accidental source-file
 *       exposure would come from.
 *
 *   The cost is that static assets are served by a function instead of the CDN.
 *   Correctness first; if that ever matters, web/ can be promoted to static
 *   hosting later without touching the application.
 *
 * NO SWEEPER IS STARTED HERE. There is no long-lived process to run a timer in,
 * and none is needed: the Redis driver gives every session its own expiry, and
 * getSession() re-checks expiresAt on read.
 */
import { createApp } from '../server/src/app.js';

const app = createApp();

export default app;
