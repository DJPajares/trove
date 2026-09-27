import type { FastifyInstance } from 'fastify';

import {
  aiPlanningRetentionController,
  notificationDispatchController,
  tripMediaCleanupController,
} from '../controllers/maintenance.js';

export function registerMaintenanceRoutes(app: FastifyInstance) {
  app.get('/maintenance/ai-planning-retention', aiPlanningRetentionController);
  app.get('/maintenance/trip-media-cleanup', tripMediaCleanupController);
  app.post('/maintenance/notification-dispatch', notificationDispatchController);
}
