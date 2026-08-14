import type { FastifyInstance } from 'fastify';

import { createPlanScoreControllers } from '../controllers/plan-score.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';

export function registerPlanScoreRoutes(app: FastifyInstance) {
  const controllers = createPlanScoreControllers();

  app.get(
    '/trips/:tripId/plan-score',
    { preHandler: requireAuthenticatedUser },
    controllers.getPlanScore,
  );
}
