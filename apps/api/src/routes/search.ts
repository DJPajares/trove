import type { FastifyInstance } from 'fastify';

import { searchController } from '../controllers/search.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';

export function registerSearchRoutes(app: FastifyInstance) {
  app.get('/search', { preHandler: requireAuthenticatedUser }, searchController);
}
