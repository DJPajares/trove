import type { FastifyInstance } from 'fastify';

import {
  createTripController,
  deleteTripController,
  getTripController,
  listTripsController,
  updateTripController,
} from '../controllers/trips.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';

export function registerTripRoutes(app: FastifyInstance) {
  app.get('/trips', { preHandler: requireAuthenticatedUser }, listTripsController);
  app.post('/trips', { preHandler: requireAuthenticatedUser }, createTripController);
  app.get('/trips/:tripId', { preHandler: requireAuthenticatedUser }, getTripController);
  app.patch('/trips/:tripId', { preHandler: requireAuthenticatedUser }, updateTripController);
  app.delete('/trips/:tripId', { preHandler: requireAuthenticatedUser }, deleteTripController);
}
