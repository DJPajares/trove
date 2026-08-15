import type { FastifyInstance } from 'fastify';

import { createItineraryControllers } from '../controllers/itineraries.js';
import { createItineraryRouteControllers } from '../controllers/itinerary-routes.js';
import { createTripModeContextControllers } from '../controllers/trip-mode-context.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';

export function registerItineraryRoutes(app: FastifyInstance) {
  const controllers = createItineraryControllers();
  const routeControllers = createItineraryRouteControllers();
  const tripModeContextControllers = createTripModeContextControllers();
  const authenticated = { preHandler: requireAuthenticatedUser };

  app.get('/trips/:tripId/itinerary', authenticated, controllers.getItinerary);
  app.get('/trips/:tripId/trip-mode/context', authenticated, tripModeContextControllers.getContext);
  app.get(
    '/trips/:tripId/itinerary/days/:itineraryDayId/routes',
    authenticated,
    routeControllers.getDayRoutes,
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
