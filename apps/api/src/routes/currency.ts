import type { FastifyInstance } from 'fastify';

import { createCurrencyControllers } from '../controllers/currency.js';
import { CachedCurrencyService } from '../services/cached-currency.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';
import { PROVIDER_SEARCH_RATE_LIMIT } from './rate-limits.js';

export function registerCurrencyRoutes(app: FastifyInstance) {
  // One service instance per app, so the in-flight refresh it holds actually
  // collapses concurrent misses into a single provider call.
  const controllers = createCurrencyControllers(new CachedCurrencyService());

  app.get(
    '/currency/currencies',
    { ...PROVIDER_SEARCH_RATE_LIMIT, preHandler: requireAuthenticatedUser },
    controllers.listCurrencies,
  );
  app.get(
    '/currency/rates',
    { ...PROVIDER_SEARCH_RATE_LIMIT, preHandler: requireAuthenticatedUser },
    controllers.getRates,
  );
  app.get(
    '/currency/rate',
    { ...PROVIDER_SEARCH_RATE_LIMIT, preHandler: requireAuthenticatedUser },
    controllers.getRate,
  );
}
