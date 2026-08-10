import type { FastifyInstance } from 'fastify';

import { databaseHealthController, healthController } from '../controllers/health.js';

export function registerHealthRoutes(app: FastifyInstance) {
  app.get('/health', healthController);
  app.get('/health/database', databaseHealthController);
}
