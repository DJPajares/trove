import type { FastifyInstance } from 'fastify';

import { createNotificationControllers } from '../controllers/notifications.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';

export function registerNotificationRoutes(app: FastifyInstance) {
  const controllers = createNotificationControllers();
  const authenticated = { preHandler: requireAuthenticatedUser };

  app.get('/notifications', authenticated, controllers.getNotifications);
  app.get('/notifications/push-config', authenticated, controllers.getPushConfig);
  app.put('/notifications/push-subscription', authenticated, controllers.registerPush);
  app.delete('/notifications/push-subscription', authenticated, controllers.removePush);
  app.post('/notifications/push-subscription/status', authenticated, controllers.pushStatus);
  app.patch('/notifications/preferences', authenticated, controllers.updateSettings);
  app.patch('/notifications/:notificationId', authenticated, controllers.updateNotification);
  app.post('/notifications/read-all', authenticated, controllers.markAllRead);
  app.get('/trips/:tripId/notification-preferences', authenticated, controllers.getTripPreference);
  app.patch(
    '/trips/:tripId/notification-preferences',
    authenticated,
    controllers.updateTripPreference,
  );
}
