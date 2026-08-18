import type { FastifyInstance } from 'fastify';

import { createPlanScoreControllers } from '../controllers/plan-score.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';
import { PROVIDER_FANOUT_RATE_LIMIT } from './rate-limits.js';

export function registerPlanScoreRoutes(app: FastifyInstance) {
  const controllers = createPlanScoreControllers();

  app.get(
    '/trips/:tripId/plan-score',
    { config: PROVIDER_FANOUT_RATE_LIMIT, preHandler: requireAuthenticatedUser },
    controllers.getPlanScore,
  );
}
