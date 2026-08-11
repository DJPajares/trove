import type { FastifyInstance } from 'fastify';

import {
  createTripInfoController,
  deleteTripInfoController,
  getTripInfoController,
  updateTripInfoController,
} from '../controllers/trip-info.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';

export function registerTripInfoRoutes(app: FastifyInstance) {
  app.get('/trips/:tripId/info', { preHandler: requireAuthenticatedUser }, getTripInfoController);
  app.post(
    '/trips/:tripId/info',
    { preHandler: requireAuthenticatedUser },
    createTripInfoController,
  );
  app.patch(
    '/trips/:tripId/info/:entryId',
    { preHandler: requireAuthenticatedUser },
    updateTripInfoController,
  );
  app.delete(
    '/trips/:tripId/info/:entryId',
    { preHandler: requireAuthenticatedUser },
    deleteTripInfoController,
  );
}
