import type { FastifyInstance } from 'fastify';

import { createTripPlacesControllers } from '../controllers/trip-places.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';
import { PROVIDER_FANOUT_RATE_LIMIT } from './rate-limits.js';

export function registerTripPlacesRoutes(app: FastifyInstance) {
  const controllers = createTripPlacesControllers();
  const authenticated = { preHandler: requireAuthenticatedUser };
  // Listing the collection refreshes any Place whose snapshot has aged out, so
  // one request here can still become several provider calls.
  const providerBacked = { config: PROVIDER_FANOUT_RATE_LIMIT, ...authenticated };

  app.get('/trips/:tripId/places', providerBacked, controllers.getTripPlaces);
  app.post('/trips/:tripId/places', authenticated, controllers.addTripPlace);
  app.patch('/trips/:tripId/places/:tripPlaceId', authenticated, controllers.updateTripPlace);
  app.delete('/trips/:tripId/places/:tripPlaceId', authenticated, controllers.removeTripPlace);
}
