/**
 * Runs the hosted service locally for development.
 *
 * Production does NOT use this: on Hostinger the environment variables come
 * from the hosting panel / .env and the app is started with `npm start`. This
 * script only sets safe local defaults so the public workflow can be exercised
 * on a laptop, including the HTTPS escape hatch that hosted mode otherwise
 * refuses to start without.
 *
 *   npm run start:hosted:dev
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.PORT ?? '3200';

const env = {
  ...process.env,
  XRLAB_MODE: 'hosted',
  PORT: port,
  XRLAB_HOST: process.env.XRLAB_HOST ?? '127.0.0.1',
  XRLAB_PUBLIC_URL: process.env.XRLAB_PUBLIC_URL ?? `http://localhost:${port}`,
  // Hosted mode requires HTTPS in production; this flag is the documented
  // development-only exception and must never be set on the real deployment.
  XRLAB_ALLOW_INSECURE: 'true',
  XRLAB_HSTS: process.env.XRLAB_HSTS ?? 'false',
  // Short TTL so expiry behaviour is easy to observe while developing.
  XRLAB_SESSION_TTL_MINUTES: process.env.XRLAB_SESSION_TTL_MINUTES ?? '15',
};

console.log(`[dev] hosted mode on http://localhost:${port} (development defaults; not production config)`);

spawn(process.execPath, [resolve(root, 'server/src/index.js')], {
  stdio: 'inherit',
  env,
}).on('exit', (code) => process.exit(code ?? 0));
