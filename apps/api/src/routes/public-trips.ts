import type { FastifyInstance } from 'fastify';

import { createPublicTripControllers } from '../controllers/public-trips.js';
import { PUBLIC_SHARE_RATE_LIMIT } from './rate-limits.js';

/**
 * The unauthenticated surface, and all of it.
 *
 * Every other data route in Trove carries `requireAuthenticatedUser`; these do
 * not, which is why they live in a file of their own rather than as an exception
 * inside `itineraries.ts`. Keeping the exception visible is the point: a route
 * added here is a route added to the public internet, and there should never be
 * a way to end up here by accident.
 *
 * Nothing provider-backed belongs in this file. Day routes, time suggestions and
 * Trip Mode context all reach Google, and a shared link must not be a way to
 * spend someone else's money.
 */
export function registerPublicTripRoutes(app: FastifyInstance) {
  const controllers = createPublicTripControllers();

  app.get(
    '/public/trips/:tripId/itinerary',
    { config: PUBLIC_SHARE_RATE_LIMIT },
    controllers.getPublicItinerary,
  );
}
