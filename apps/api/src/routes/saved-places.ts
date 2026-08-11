import type { FastifyInstance } from 'fastify';

import { createSavedPlacesControllers } from '../controllers/saved-places.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';

export function registerSavedPlacesRoutes(app: FastifyInstance) {
  const controllers = createSavedPlacesControllers();
  const authenticated = { preHandler: requireAuthenticatedUser };

  app.get('/saved', authenticated, controllers.getSavedPlaces);
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
