import type { FastifyInstance } from 'fastify';

import { createPlacesControllers } from '../controllers/places.js';
import { createCanonicalPlacesService } from '../services/canonical-places.js';
import { createPlacesService } from '../services/places-runtime.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';
import { PROVIDER_SEARCH_RATE_LIMIT } from './rate-limits.js';

export function registerPlacesRoutes(app: FastifyInstance) {
  const controllers = createPlacesControllers(
    // The provider answering with nothing is the one failure travellers actually
    // see, so it is logged rather than only turned into a status.
    createPlacesService(process.env, app.log),
    createCanonicalPlacesService(),
  );

  app.post(
    '/places/search',
    { config: PROVIDER_SEARCH_RATE_LIMIT, preHandler: requireAuthenticatedUser },
    controllers.search,
  );
  // Resolving is the only place data endpoint that reaches the provider, and it
  // does so once per Place ever. Every screen afterwards reads the database.
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
}
