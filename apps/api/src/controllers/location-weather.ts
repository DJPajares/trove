import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { resolvePlaceName } from '../services/reverse-geocode.js';
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
         * Resolving the zone to a point is what lets Home answer at all for a
         * traveller who has declined location rather than showing a blank where
         * the weather goes.
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

        /**
         * The name goes back with the reading, because the client cannot work
         * it out. It used to be left to the caller, which meant falling back to
         * the city in the IANA zone - so a traveller in Whangarei read
         * "Auckland" over Whangarei's own temperature.
         *
         * With coordinates, the name is the place those coordinates are
         * actually in. Without them it is the zone's own city, which names the
         * region the reading came from - the client decides whether that is
         * worth showing, and Home does not, because it would read as a claim
         * about the traveller. Either way it is null rather than a guess when
         * nothing resolves.
         */
        const name =
          latitude === undefined
            ? (place?.name ?? null)
            : await resolvePlaceName(latitude, longitude!);

        return reply.send({ ...weather, place: name ? { name } : null });
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
