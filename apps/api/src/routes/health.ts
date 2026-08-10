import type { FastifyInstance } from 'fastify';

import { healthController } from '../controllers/health.js';

export function registerHealthRoutes(app: FastifyInstance) {
  app.get('/health', healthController);
}
