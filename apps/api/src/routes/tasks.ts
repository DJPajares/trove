import type { FastifyInstance } from 'fastify';

import { createTasksControllers } from '../controllers/tasks.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';

export function registerTasksRoutes(app: FastifyInstance) {
  const controllers = createTasksControllers();
  const authenticated = { preHandler: requireAuthenticatedUser };

  app.get('/trips/:tripId/tasks', authenticated, controllers.getTasks);
  app.post('/trips/:tripId/tasks', authenticated, controllers.createTask);
  app.patch('/trips/:tripId/tasks/:taskId', authenticated, controllers.updateTask);
  app.delete('/trips/:tripId/tasks/:taskId', authenticated, controllers.deleteTask);

  app.get('/task-templates', authenticated, controllers.getTemplates);
  app.post('/task-templates', authenticated, controllers.createTemplate);
  app.patch('/task-templates/:templateId', authenticated, controllers.updateTemplate);
  app.delete('/task-templates/:templateId', authenticated, controllers.deleteTemplate);
  app.post('/task-templates/:templateId/apply', authenticated, controllers.applyTemplate);
}
