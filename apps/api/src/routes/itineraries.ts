import type { FastifyInstance } from 'fastify';

import { createItineraryControllers } from '../controllers/itineraries.js';
import { createItineraryRouteControllers } from '../controllers/itinerary-routes.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';

export function registerItineraryRoutes(app: FastifyInstance) {
  const controllers = createItineraryControllers();
  const routeControllers = createItineraryRouteControllers();
  const authenticated = { preHandler: requireAuthenticatedUser };

  app.get('/trips/:tripId/itinerary', authenticated, controllers.getItinerary);
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
    '/trips/:tripId/itinerary/days/:itineraryDayId/route-mode',
    authenticated,
    routeControllers.updateDayRouteMode,
  );
  app.patch(
    '/trips/:tripId/itinerary/items/:itemId/route-mode',
    authenticated,
    routeControllers.updateItemRouteMode,
  );
  app.patch('/trips/:tripId/itinerary/items/:itemId', authenticated, controllers.updateItem);
  app.delete('/trips/:tripId/itinerary/items/:itemId', authenticated, controllers.deleteItem);
}
