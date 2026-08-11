import type { FastifyInstance } from 'fastify';

import { createTripPlacesControllers } from '../controllers/trip-places.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';

export function registerTripPlacesRoutes(app: FastifyInstance) {
  const controllers = createTripPlacesControllers();
  const authenticated = { preHandler: requireAuthenticatedUser };

  app.get('/trips/:tripId/places', authenticated, controllers.getTripPlaces);
  app.post('/trips/:tripId/places', authenticated, controllers.addTripPlace);
  app.patch('/trips/:tripId/places/:tripPlaceId', authenticated, controllers.updateTripPlace);
  app.delete('/trips/:tripId/places/:tripPlaceId', authenticated, controllers.removeTripPlace);
}
