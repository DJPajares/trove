import Fastify from 'fastify';

import { registerAuthenticationRoutes } from './routes/auth.js';
import { registerHealthRoutes } from './routes/health.js';

export function buildApp() {
  const app = Fastify({ logger: true });

  registerAuthenticationRoutes(app);
  registerHealthRoutes(app);

  return app;
}
