/**
 * Analysis store facade — picks the right driver for where we are running.
 *
 *   memory (default)  analysisStore.js       process-local Map.
 *                                            Correct for `npm start` and for
 *                                            any long-lived host. Reports die
 *                                            with the process, by design.
 *
 *   redis             analysisStoreRedis.js  Upstash/Vercel KV over HTTP.
 *                                            Required on serverless, where two
 *                                            requests may hit two instances.
 *
 * Selection is by environment, never by code change:
 *   - KV_REDIS_URL  (Vercel KV; also read as KV_URL or REDIS_URL)
 *   - XRLAB_STORE=memory|redis                   explicit override
 *
 * With no credentials present the memory driver is used, so local development
 * and the test suite behave exactly as they always have.
 *
 * Every function here is awaited by callers. The memory driver returns plain
 * values; `await` on a non-Promise is a no-op, so it stays fully synchronous
 * internally and its direct unit tests are unaffected.
 */
import * as memory from './analysisStore.js';
import * as redis from './analysisStoreRedis.js';

const requested = (process.env.XRLAB_STORE ?? '').trim().toLowerCase();

function pick() {
  if (requested === 'memory') return { driver: memory, name: 'memory' };
  if (requested === 'redis') {
    if (!redis.isConfigured()) {
      throw new Error('XRLAB_STORE=redis but no Vercel KV / Upstash credentials are set.');
    }
    return { driver: redis, name: 'redis' };
  }
  // Auto: credentials present means we are somewhere that needs them.
  return redis.isConfigured() ? { driver: redis, name: 'redis' } : { driver: memory, name: 'memory' };
}

const selected = pick();

/** Which driver is live. Surfaced by /api/health for operational clarity. */
export const storeDriver = selected.name;

const d = selected.driver;

export const createSession = (...a) => d.createSession(...a);
export const getSession = (...a) => d.getSession(...a);
export const deleteSession = (...a) => d.deleteSession(...a);
export const addReport = (...a) => d.addReport(...a);
export const getReport = (...a) => d.getReport(...a);
export const setChecklistResult = (...a) => d.setChecklistResult(...a);
export const stats = (...a) => d.stats(...a);
export const sweep = (...a) => d.sweep(...a);
export const startSweeper = (...a) => d.startSweeper(...a);
export const stopSweeper = (...a) => d.stopSweeper(...a);
export const reset = (...a) => d.reset(...a);

// Shared across both drivers, so `instanceof` works whichever is live.
export { SessionFullError, DuplicateReportError, safeDisplayName } from './analysisStore.js';
