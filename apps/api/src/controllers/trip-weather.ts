import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { TripWeatherNotFoundError, type TripWeatherService } from '../services/trip-weather.js';
import { WeatherProviderError } from '../services/weather.js';

const tripParamsSchema = z.object({ tripId: z.uuid() }).strict();

/**
 * The unit is the only thing that varies.
 *
 * Every surface asks the identical question so they share one cache entry both
 * here and in the browser - a flag that split the answer would mean navigating
 * from the day rail to Today cost a second round trip for the same forecast.
 */
const tripWeatherQuerySchema = z
  .object({ temperatureUnit: z.enum(['celsius', 'fahrenheit']) })
  .strict();

function getUserId(request: FastifyRequest, reply: FastifyReply) {
  if (!request.authUserId) {
    void reply.code(500).send({ code: 'authentication_context_missing' });
    return null;
  }
  return request.authUserId;
}

function sendProviderError(reply: FastifyReply, error: unknown) {
  if (error instanceof TripWeatherNotFoundError) {
    return reply.code(404).send({ code: 'trip_not_found' });
  }
  if (error instanceof WeatherProviderError) {
    if (error.code === 'invalid_request') {
      return reply.code(400).send({ code: 'invalid_weather_request' });
    }
    return reply.code(503).send({
      code:
        error.code === 'invalid_response'
          ? 'weather_provider_invalid_response'
          : 'weather_unavailable',
      provider: 'open_meteo',
      status: 'unavailable',
    });
  }
  throw error;
}

export function createTripWeatherControllers(tripWeatherService: TripWeatherService) {
  return {
    async getTripWeather(request: FastifyRequest, reply: FastifyReply) {
      const userId = getUserId(request, reply);
      if (!userId) return reply;

      const params = tripParamsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ code: 'invalid_weather_request' });

      const query = tripWeatherQuerySchema.safeParse(request.query);
      if (!query.success) return reply.code(400).send({ code: 'invalid_weather_request' });

      try {
        return reply.send(
          await tripWeatherService.getTripWeather(userId, params.data.tripId, query.data),
        );
      } catch (error) {
        return sendProviderError(reply, error);
      }
    },
  };
}
