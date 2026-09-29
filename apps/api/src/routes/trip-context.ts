import type { FastifyInstance } from 'fastify';

import { createTripContextControllers } from '../controllers/trip-context.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';
import { PROVIDER_FANOUT_RATE_LIMIT } from './rate-limits.js';

export function registerTripContextRoutes(app: FastifyInstance) {
  const controllers = createTripContextControllers();

  app.get(
    '/trips/:tripId/context',
    { config: PROVIDER_FANOUT_RATE_LIMIT, preHandler: requireAuthenticatedUser },
    controllers.getTripContext,
  );
}
