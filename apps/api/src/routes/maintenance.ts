import type { FastifyInstance } from 'fastify';

import { aiPlanningRetentionController } from '../controllers/maintenance.js';

export function registerMaintenanceRoutes(app: FastifyInstance) {
  app.get('/maintenance/ai-planning-retention', aiPlanningRetentionController);
}
