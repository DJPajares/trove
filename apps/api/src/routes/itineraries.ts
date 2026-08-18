import type { FastifyInstance } from 'fastify';

import { createItineraryControllers } from '../controllers/itineraries.js';
import { createItineraryRouteControllers } from '../controllers/itinerary-routes.js';
import { createItineraryTimeSuggestionControllers } from '../controllers/itinerary-time-suggestions.js';
import { createTripModeContextControllers } from '../controllers/trip-mode-context.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';
import { PROVIDER_FANOUT_RATE_LIMIT } from './rate-limits.js';

export function registerItineraryRoutes(app: FastifyInstance) {
  const controllers = createItineraryControllers();
  const routeControllers = createItineraryRouteControllers();
  const timeSuggestionControllers = createItineraryTimeSuggestionControllers();
  const tripModeContextControllers = createTripModeContextControllers();
  const authenticated = { preHandler: requireAuthenticatedUser };
  // These three reach Google once per place and once per leg of the day.
  const providerBacked = { config: PROVIDER_FANOUT_RATE_LIMIT, ...authenticated };

  app.get('/trips/:tripId/itinerary', authenticated, controllers.getItinerary);
  app.get(
    '/trips/:tripId/trip-mode/context',
    providerBacked,
    tripModeContextControllers.getContext,
  );
  app.get(
    '/trips/:tripId/itinerary/days/:itineraryDayId/routes',
    providerBacked,
    routeControllers.getDayRoutes,
  );
  app.get(
    '/trips/:tripId/itinerary/days/:itineraryDayId/time-suggestions',
    providerBacked,
    timeSuggestionControllers.getDayTimeSuggestions,
  );
  app.post('/trips/:tripId/itinerary/items', authenticated, controllers.createItem);
  app.post(
    '/trips/:tripId/itinerary/items/:itemId/duplicate',
    authenticated,
    controllers.duplicateItem,
  );
  app.patch(
    '/trips/:tripId/itinerary/items/:itemId/organization',
    authenticated,
    controllers.organizeItem,
  );
  app.patch(
    '/trips/:tripId/itinerary/days/:itineraryDayId/base',
    authenticated,
    controllers.setDayBase,
  );
  app.patch(
    '/trips/:tripId/itinerary/days/:itineraryDayId/note',
    authenticated,
    controllers.updateDayNote,
  );
  app.patch(
    '/trips/:tripId/itinerary/days/:itineraryDayId/experience-rating',
    authenticated,
    controllers.updateDayExperienceRating,
  );
  app.patch(
    '/trips/:tripId/itinerary/days/:itineraryDayId/route-mode',
    authenticated,
    routeControllers.updateDayRouteMode,
  );
  app.patch(
    '/trips/:tripId/itinerary/items/:itemId/route-mode',
    authenticated,
    routeControllers.updateItemRouteMode,
  );
  app.patch(
    '/trips/:tripId/itinerary/items/:itemId/travel-status',
    authenticated,
    tripModeContextControllers.updateTravelStatus,
  );
  app.patch('/trips/:tripId/itinerary/items/:itemId', authenticated, controllers.updateItem);
  app.delete('/trips/:tripId/itinerary/items/:itemId', authenticated, controllers.deleteItem);
}
