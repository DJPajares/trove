import cors from '@fastify/cors';
import Fastify from 'fastify';

import { getWebOrigins } from './environment.js';
import { registerAuthenticationRoutes } from './routes/auth.js';
import { registerProfileRoutes } from './routes/profile.js';
import { registerHealthRoutes } from './routes/health.js';

export function buildApp() {
  const app = Fastify({ logger: true });
  const allowedOrigins = new Set(getWebOrigins());

  void app.register(cors, {
    methods: ['GET', 'PATCH', 'OPTIONS'],
    origin(origin, callback) {
      callback(null, origin === undefined || allowedOrigins.has(origin));
    },
  });

  registerAuthenticationRoutes(app);
  registerProfileRoutes(app);
  registerHealthRoutes(app);

  return app;
}
