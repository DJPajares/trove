import type { FastifyInstance } from 'fastify';

import { createCurrencyControllers } from '../controllers/currency.js';
import { CurrencyService } from '../services/currency.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';

export function registerCurrencyRoutes(app: FastifyInstance) {
  const controllers = createCurrencyControllers(new CurrencyService());

  app.get(
    '/currency/currencies',
    { preHandler: requireAuthenticatedUser },
    controllers.listCurrencies,
  );
  app.get('/currency/rate', { preHandler: requireAuthenticatedUser }, controllers.getRate);
}
