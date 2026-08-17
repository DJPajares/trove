import type { FastifyInstance } from 'fastify';

import { createPlacesControllers } from '../controllers/places.js';
import { createCanonicalPlacesService } from '../services/canonical-places.js';
import { createPlacesService } from '../services/places-runtime.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';

export function registerPlacesRoutes(app: FastifyInstance) {
  const controllers = createPlacesControllers(
    // The provider answering with nothing is the one failure travellers actually
    // see, so it is logged rather than only turned into a status.
    createPlacesService(process.env, app.log),
    createCanonicalPlacesService(),
  );

  app.post('/places/search', { preHandler: requireAuthenticatedUser }, controllers.search);
  app.post(
    '/places/resolve',
    { preHandler: requireAuthenticatedUser },
    controllers.resolveProviderPlace,
  );
  app.post(
    '/places/custom',
    { preHandler: requireAuthenticatedUser },
    controllers.createCustomPlace,
  );
  app.patch(
    '/places/custom/:placeId',
    { preHandler: requireAuthenticatedUser },
    controllers.updateCustomPlace,
  );
  app.get(
    '/places/:providerPlaceId',
    { preHandler: requireAuthenticatedUser },
    controllers.getDetails,
  );
  app.post(
    '/places/photos/resolve',
    { preHandler: requireAuthenticatedUser },
    controllers.resolvePhoto,
  );
}
