import type { FastifyInstance } from 'fastify';

import { getProfileController, updateProfileController } from '../controllers/profile.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';

export function registerProfileRoutes(app: FastifyInstance) {
  app.get('/profile/me', { preHandler: requireAuthenticatedUser }, getProfileController);
  app.patch('/profile/me', { preHandler: requireAuthenticatedUser }, updateProfileController);
}
