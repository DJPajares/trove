import type { FastifyInstance } from 'fastify';

import { createEditorialImagesControllers } from '../controllers/editorial-images.js';
import { createEditorialImagesService } from '../services/editorial-images-runtime.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';
import { PROVIDER_FANOUT_RATE_LIMIT } from './rate-limits.js';

export function registerEditorialImageRoutes(app: FastifyInstance) {
  const controllers = createEditorialImagesControllers(
    createEditorialImagesService({
      environment: process.env,
      logger: app.log,
      source: 'editorial-images',
    }),
  );

  // One request resolves a whole screen's media, so it is batched rather than
  // per-subject: a per-item endpoint is how a list becomes a fan-out.
  app.post(
    '/editorial-images/resolve',
    { config: PROVIDER_FANOUT_RATE_LIMIT, preHandler: requireAuthenticatedUser },
    controllers.resolve,
  );
}
