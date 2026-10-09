import { z } from 'zod';
import { WEATHER_MAX_LOCATIONS } from '@trove/types';
import { WeatherResolver } from '../services/weather-resolver.js';
import { isValidIanaTimeZone } from '../services/trip-rules.js';
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
  const resolver = new WeatherResolver();
  const bodySchema = z
    .object({
      points: z
        .array(
          z
            .object({
              latitude: z.number().min(-90).max(90),
              longitude: z.number().min(-180).max(180),
              timeZone: z.string().max(100).refine(isValidIanaTimeZone),
              dates: z.array(z.iso.date()).max(16),
              current: z.boolean().optional(),
            })
            .strict(),
        )
        .min(1)
        .max(WEATHER_MAX_LOCATIONS),
    })
    .strict();
  app.post(
    '/weather/resolve',
    { config: PROVIDER_SEARCH_RATE_LIMIT, preHandler: requireAuthenticatedUser },
    async (request, reply) => {
      const body = bodySchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ code: 'invalid_weather_request' });
      try {
        return reply.send({ points: await resolver.resolve(body.data.points) });
      } catch {
        return reply.code(503).send({ code: 'weather_unavailable' });
      }
    },
  );

  app.get(
    '/weather',
    { config: PROVIDER_SEARCH_RATE_LIMIT, preHandler: requireAuthenticatedUser },
    controllers.getLocationWeather,
  );
}
