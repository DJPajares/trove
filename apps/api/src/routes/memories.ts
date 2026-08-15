import type { FastifyInstance } from 'fastify';

import { createMemoryControllers } from '../controllers/memories.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';

export function registerMemoryRoutes(app: FastifyInstance) {
  const controllers = createMemoryControllers();
  const authenticated = { preHandler: requireAuthenticatedUser };

  app.get('/trips/:tripId/memories', authenticated, controllers.list);
  app.post('/trips/:tripId/memories', authenticated, controllers.create);
  app.patch(
    '/trips/:tripId/memories/highlights/order',
    authenticated,
    controllers.reorderHighlights,
  );
  app.patch('/trips/:tripId/memories/story-cover', authenticated, controllers.setStoryCover);
  app.patch('/trips/:tripId/memories/:memoryId', authenticated, controllers.update);
  app.delete('/trips/:tripId/memories/:memoryId', authenticated, controllers.remove);
  app.post('/trips/:tripId/memories/:memoryId/photos', authenticated, controllers.addPhoto);
  app.patch(
    '/trips/:tripId/memories/:memoryId/photos/order',
    authenticated,
    controllers.reorderPhotos,
  );
  app.delete(
    '/trips/:tripId/memories/:memoryId/photos/:photoId',
    authenticated,
    controllers.removePhoto,
  );
}
