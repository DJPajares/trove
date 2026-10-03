import type { FastifyInstance } from 'fastify';

import { createPlacesControllers } from '../controllers/places.js';
import { createCanonicalPlacesService } from '../services/canonical-places.js';
import { createPlaceLocationCandidatesService } from '../services/place-location-candidates.js';
import { createPlacesService } from '../services/places-runtime.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';
import { PROVIDER_SEARCH_RATE_LIMIT } from './rate-limits.js';

export function registerPlacesRoutes(app: FastifyInstance) {
  const controllers = createPlacesControllers(
    // The provider answering with nothing is the one failure travellers actually
    // see, so it is logged rather than only turned into a status.
    createPlacesService({
      environment: process.env,
      logger: app.log,
      source: 'places-autocomplete',
    }),
    createCanonicalPlacesService(),
    createPlaceLocationCandidatesService({ environment: process.env, source: 'place-locate' }),
    // Opened rich details are Enterprise-tier requests; counted under their own
    // name so their spend is not read as Autocomplete's.
    createPlacesService({ environment: process.env, logger: app.log, source: 'place-details' }),
  );

  app.get(
    '/places/:placeId/details',
    { config: PROVIDER_SEARCH_RATE_LIMIT, preHandler: requireAuthenticatedUser },
    controllers.richDetails,
  );
  app.post(
    '/places/:placeId/photos/:photoId',
    { config: PROVIDER_SEARCH_RATE_LIMIT, preHandler: requireAuthenticatedUser },
    controllers.photo,
  );
  app.post(
    '/places/search',
    { config: PROVIDER_SEARCH_RATE_LIMIT, preHandler: requireAuthenticatedUser },
    controllers.search,
  );
  // Resolve identity on demand; opened rich details use the separate bounded
  // evidence cache. Decorative surfaces never acquire provider data.
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
  // Repairing a Custom Place that never resolved costs one Text Search, bought
  // only when the traveller asks. Rate limited for the same reason search is.
  app.post(
    '/places/custom/:placeId/location-candidates',
    { config: PROVIDER_SEARCH_RATE_LIMIT, preHandler: requireAuthenticatedUser },
    controllers.locationCandidates,
  );
}
