import type { FastifyInstance } from 'fastify';

import { createPlacesControllers } from '../controllers/places.js';
import { createPlacesService } from '../services/places-runtime.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';

export function registerPlacesRoutes(app: FastifyInstance) {
  const controllers = createPlacesControllers(createPlacesService());

  app.post('/places/search', { preHandler: requireAuthenticatedUser }, controllers.search);
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
