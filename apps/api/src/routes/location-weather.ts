import type { FastifyInstance } from 'fastify';

import { createLocationWeatherControllers } from '../controllers/location-weather.js';
import { requireAuthenticatedUser } from '../services/request-auth.js';
import { WeatherService } from '../services/weather.js';
import { PROVIDER_SEARCH_RATE_LIMIT } from './rate-limits.js';

/**
 * The weather where the traveller is, rather than where a trip is.
 *
 * Authenticated and rate-limited like the trip's own weather, even though the
 * answer is neither private nor personal: two people standing in the same city
 * get the same numbers. The gate is about who may spend Trove's provider
 * budget, not about who may know the temperature - and Home asks this on every
 * visit, which is exactly the shape that has to stay counted.
 */
export function registerLocationWeatherRoutes(app: FastifyInstance) {
  const controllers = createLocationWeatherControllers(new WeatherService());

  app.get(
    '/weather',
    { config: PROVIDER_SEARCH_RATE_LIMIT, preHandler: requireAuthenticatedUser },
    controllers.getLocationWeather,
  );
}
