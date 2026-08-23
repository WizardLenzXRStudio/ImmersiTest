/**
 * Express application. Serves the dashboard AND the API from a single origin,
 * so one URL is the whole product in both local and hosted mode.
 */
import express from 'express';
import config, { paths } from './config.js';
import apiRoutes from './routes/index.js';
import { errorHandler, notFoundHandler } from './lib/errors.js';
import { cors, securityHeaders } from './lib/security.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('etag', false);

  app.use(securityHeaders);
  app.use(cors);

  // Profiler uploads get their own, much smaller body limit than the local
  // bulk-import endpoint. Mounted first: body-parser marks the request parsed,
  // so the general parser below leaves these routes alone.
  app.use(['/api/analyze', '/api/analysis'], express.json({ limit: config.uploadLimit }));
  app.use(express.json({ limit: config.isHosted ? config.uploadLimit : config.jsonBodyLimit }));

  app.use('/api', apiRoutes);

  // The shared metrics module is imported by the browser as an ES module, so it
  // must be reachable over HTTP as well as from Node.
  app.use('/shared', express.static(paths.sharedDir, { extensions: ['js'] }));
  app.use(express.static(paths.webDir));

  // Unknown /api paths must be JSON; anything else falls back to the dashboard
  // so client-side routes survive a refresh.
  app.use('/api', notFoundHandler);
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(`${paths.webDir}/index.html`));

  app.use(errorHandler);
  return app;
}

export default createApp;
