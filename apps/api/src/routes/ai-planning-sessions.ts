import type { FastifyInstance } from 'fastify';

import { createAiPlanningSessionControllers } from '../controllers/ai-planning-sessions.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';
import { PROVIDER_FANOUT_RATE_LIMIT } from './rate-limits.js';

export function registerAiPlanningSessionRoutes(app: FastifyInstance) {
  const controllers = createAiPlanningSessionControllers();

  app.post('/ai/planning-sessions', { preHandler: requireAuthenticatedUser }, controllers.create);
  app.get(
    '/ai/planning-sessions/availability',
    { preHandler: requireAuthenticatedUser },
    controllers.availability,
  );
  app.get(
    '/ai/planning-sessions/recovery',
    { preHandler: requireAuthenticatedUser },
    controllers.recover,
  );
  app.get(
    '/ai/planning-sessions/:sessionId',
    { preHandler: requireAuthenticatedUser },
    controllers.get,
  );
  app.patch(
    '/ai/planning-sessions/:sessionId/draft',
    { preHandler: requireAuthenticatedUser },
    controllers.replaceDraft,
  );
  app.post(
    '/ai/planning-sessions/:sessionId/items/:itemId/recheck',
    { config: PROVIDER_FANOUT_RATE_LIMIT, preHandler: requireAuthenticatedUser },
    controllers.recheck,
  );
  app.post(
    '/ai/planning-sessions/:sessionId/items/:itemId/replace-place',
    { config: PROVIDER_FANOUT_RATE_LIMIT, preHandler: requireAuthenticatedUser },
    controllers.replaceItemPlace,
  );
  app.post(
    '/ai/planning-sessions/:sessionId/places/:placeRefId/verify',
    { config: PROVIDER_FANOUT_RATE_LIMIT, preHandler: requireAuthenticatedUser },
    controllers.verifyCustomPlace,
  );
  app.post(
    '/ai/planning-sessions/:sessionId/regenerate',
    { preHandler: requireAuthenticatedUser },
    controllers.regenerate,
  );
  app.post(
    '/ai/planning-sessions/:sessionId/warnings/acknowledge',
    { preHandler: requireAuthenticatedUser },
    controllers.acknowledgeWarnings,
  );
  app.post(
    '/ai/planning-sessions/:sessionId/cancel',
    { preHandler: requireAuthenticatedUser },
    controllers.cancel,
  );
  app.post(
    '/ai/planning-sessions/:sessionId/apply',
    { preHandler: requireAuthenticatedUser },
    controllers.apply,
  );
}
