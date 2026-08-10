import Fastify from 'fastify';

import { registerHealthRoutes } from './routes/health.js';

export function buildApp() {
  const app = Fastify({ logger: true });

  registerHealthRoutes(app);

  return app;
}
