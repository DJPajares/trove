import type { FastifyInstance } from 'fastify';

import { createItineraryControllers } from '../controllers/itineraries.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';

export function registerItineraryRoutes(app: FastifyInstance) {
  const controllers = createItineraryControllers();
  const authenticated = { preHandler: requireAuthenticatedUser };

  app.get('/trips/:tripId/itinerary', authenticated, controllers.getItinerary);
  app.post('/trips/:tripId/itinerary/items', authenticated, controllers.createItem);
  app.patch('/trips/:tripId/itinerary/items/:itemId', authenticated, controllers.updateItem);
  app.delete('/trips/:tripId/itinerary/items/:itemId', authenticated, controllers.deleteItem);
}
