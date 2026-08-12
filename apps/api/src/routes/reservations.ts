import type { FastifyInstance } from 'fastify';

import { createReservationControllers } from '../controllers/reservations.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';

export function registerReservationRoutes(app: FastifyInstance) {
  const controllers = createReservationControllers();
  const authenticated = { preHandler: requireAuthenticatedUser };

  app.get('/trips/:tripId/reservations', authenticated, controllers.list);
  app.post('/trips/:tripId/reservations', authenticated, controllers.create);
  app.patch('/trips/:tripId/reservations/:reservationId', authenticated, controllers.update);
  app.delete('/trips/:tripId/reservations/:reservationId', authenticated, controllers.remove);
  app.post(
    '/trips/:tripId/reservations/:reservationId/attachments',
    authenticated,
    controllers.addAttachment,
  );
  app.delete(
    '/trips/:tripId/reservations/:reservationId/attachments/:attachmentId',
    authenticated,
    controllers.removeAttachment,
  );
}
