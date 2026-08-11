import type { FastifyInstance } from 'fastify';

import { authenticatedUserController } from '../controllers/auth.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';

export function registerAuthenticationRoutes(app: FastifyInstance) {
  app.get('/auth/me', { preHandler: requireAuthenticatedUser }, authenticatedUserController);
}
