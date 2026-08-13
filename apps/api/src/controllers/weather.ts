import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { WeatherProviderError, type WeatherService } from '../services/weather.js';

const weatherQuerySchema = z
  .object({
    latitude: z.coerce.number().finite().min(-90).max(90),
    longitude: z.coerce.number().finite().min(-180).max(180),
    temperatureUnit: z.enum(['celsius', 'fahrenheit']),
    timeZone: z.string().trim().min(1).max(100),
  })
  .strict();

function sendProviderError(reply: FastifyReply, error: unknown) {
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

export function createWeatherControllers(weatherService: WeatherService) {
  return {
    async getWeather(request: FastifyRequest, reply: FastifyReply) {
      const query = weatherQuerySchema.safeParse(request.query);
      if (!query.success) return reply.code(400).send({ code: 'invalid_weather_request' });

      try {
        return reply.send(await weatherService.getWeather(query.data));
      } catch (error) {
        return sendProviderError(reply, error);
      }
    },
  };
}
