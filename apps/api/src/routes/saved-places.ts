import type { FastifyInstance } from 'fastify';

import { createSavedPlacesControllers } from '../controllers/saved-places.js';
import { createSavedTripsControllers } from '../controllers/saved-trips.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';

export function registerSavedPlacesRoutes(app: FastifyInstance) {
  const controllers = createSavedPlacesControllers();
  const authenticated = { preHandler: requireAuthenticatedUser };

  app.get('/saved', authenticated, controllers.getSavedPlaces);

  // Other travellers' Public trips kept in Finds to read (PRD 8.4).
  const trips = createSavedTripsControllers();
  app.get('/saved/trips', authenticated, trips.getSavedTrips);
  app.put('/saved/trips/:tripId', authenticated, trips.saveTrip);
  app.delete('/saved/trips/:tripId', authenticated, trips.unsaveTrip);
  app.post('/saved', authenticated, controllers.savePlace);
  app.patch('/saved/:id', authenticated, controllers.updatePlaceNote);
  app.delete('/saved/:id', authenticated, controllers.unsavePlace);

  app.post('/saved/collections', authenticated, controllers.createCollection);
  app.patch('/saved/collections/:id', authenticated, controllers.renameCollection);
  app.delete('/saved/collections/:id', authenticated, controllers.deleteCollection);
  app.put(
    '/saved/:savedPlaceId/collections/:collectionId',
    authenticated,
    controllers.addPlaceToCollection,
  );
  app.delete(
    '/saved/:savedPlaceId/collections/:collectionId',
    authenticated,
    controllers.removePlaceFromCollection,
  );
}
