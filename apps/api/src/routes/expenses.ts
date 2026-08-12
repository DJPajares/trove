import type { FastifyInstance } from 'fastify';

import { createExpenseControllers } from '../controllers/expenses.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';

export function registerExpenseRoutes(app: FastifyInstance) {
  const controllers = createExpenseControllers();
  const authenticated = { preHandler: requireAuthenticatedUser };

  app.get('/trips/:tripId/expenses', authenticated, controllers.list);
  app.post('/trips/:tripId/expenses', authenticated, controllers.create);
  app.patch('/trips/:tripId/expenses/budget', authenticated, controllers.updateBudget);
  app.patch('/trips/:tripId/expenses/:expenseId', authenticated, controllers.update);
  app.delete('/trips/:tripId/expenses/:expenseId', authenticated, controllers.remove);
}
