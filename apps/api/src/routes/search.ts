import type { FastifyInstance } from 'fastify';

import { searchController } from '../controllers/search.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';
import { PROVIDER_SEARCH_RATE_LIMIT } from './rate-limits.js';

export function registerSearchRoutes(app: FastifyInstance) {
  app.get(
    '/search',
    { config: PROVIDER_SEARCH_RATE_LIMIT, preHandler: requireAuthenticatedUser },
    searchController,
  );
}
