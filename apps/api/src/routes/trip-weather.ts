import type { FastifyInstance } from 'fastify';

import { createTripWeatherControllers } from '../controllers/trip-weather.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';
import { TripWeatherService } from '../services/trip-weather.js';
import { PROVIDER_SEARCH_RATE_LIMIT } from './rate-limits.js';

export function registerTripWeatherRoutes(app: FastifyInstance) {
  const controllers = createTripWeatherControllers(new TripWeatherService());

  app.get(
    '/trips/:tripId/weather',
    { config: PROVIDER_SEARCH_RATE_LIMIT, preHandler: requireAuthenticatedUser },
    controllers.getTripWeather,
  );
}
