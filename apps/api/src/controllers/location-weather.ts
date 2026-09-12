import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { resolveTimeZonePlace } from '../services/time-zone-places.js';
import { isValidIanaTimeZone } from '../services/trip-rules.js';
import { WeatherProviderError, type WeatherService } from '../services/weather.js';

/**
 * A point on the earth and how to read a clock there.
 *
 * Coordinates rather than a trip: this answers "what is it like where the
 * traveller is standing", which no trip can be asked. The zone is required
 * because a daily forecast has to be bucketed into somebody's days, and the
 * browser already knows its own.
 */
const locationWeatherQuerySchema = z
  .object({
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    temperatureUnit: z.enum(['celsius', 'fahrenheit']),
    timeZone: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine(isValidIanaTimeZone, { error: 'unknown_time_zone' }),
  })
  .strict()
  .refine((query) => (query.latitude === undefined) === (query.longitude === undefined), {
    error: 'incomplete_coordinates',
  });

export function createLocationWeatherControllers(weatherService: WeatherService) {
  return {
    async getLocationWeather(request: FastifyRequest, reply: FastifyReply) {
      const query = locationWeatherQuerySchema.safeParse(request.query);
      if (!query.success) return reply.code(400).send({ code: 'invalid_weather_request' });

      const { latitude, longitude, temperatureUnit, timeZone } = query.data;

      try {
        /**
         * Coordinates when the traveller has shared them, and otherwise the
         * city the zone is named after.
         *
         * Trove never prompts for location, so most visits arrive with a zone
         * and nothing else. Resolving that to a point is what lets Home answer
         * at all rather than showing a blank where the weather goes.
         *
         * `place` is returned alongside so the client does not have to name the
         * location itself. It is null when coordinates were given: the zone's
         * city is not necessarily the city those coordinates are in, and a name
         * the reading cannot vouch for is better left to the caller.
         */
        const place = latitude === undefined ? await resolveTimeZonePlace(timeZone) : null;
        if (latitude === undefined && !place) {
          return reply.code(404).send({ code: 'location_unknown' });
        }

        const weather = await weatherService.getWeather({
          latitude: latitude ?? place!.latitude,
          longitude: longitude ?? place!.longitude,
          temperatureUnit,
          timeZone,
        });

        return reply.send({ ...weather, place: place && { name: place.name } });
      } catch (error) {
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
    },
  };
}
