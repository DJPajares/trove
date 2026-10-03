import { getPrismaClient } from '@trove/db';
import { WEATHER_CACHE_TTL_MS } from '@trove/types';
import { z } from 'zod';

import { recordProviderCacheEvent, recordProviderCall } from './provider-usage.js';
import { singleFlight } from './single-flight.js';
import { snapshotKey } from './weather-evidence-cache.js';
import type { WeatherContext, WeatherProvider, WeatherRequest } from './weather.js';

const payloadSchema = z.object({
  attribution: z.object({ label: z.string(), url: z.string() }),
  current: z
    .object({
      apparentTemperature: z.number(),
      isDay: z.boolean(),
      observedAt: z.string(),
      temperature: z.number(),
      weatherCode: z.number().int(),
    })
    .nullable(),
  forecast: z.array(
    z.object({
      date: z.string(),
      precipitationProbability: z.number().nullable(),
      temperatureMax: z.number(),
      temperatureMin: z.number(),
      weatherCode: z.number().int(),
    }),
  ),
  hours: z.array(
    z.object({
      precipitationProbability: z.number().nullable(),
      temperature: z.number(),
      time: z.string(),
      weatherCode: z.number().int(),
    }),
  ),
  location: z.object({ latitude: z.number(), longitude: z.number(), timeZone: z.string() }),
  provider: z.literal('open_meteo'),
  temperatureUnit: z.literal('celsius'),
});

/** One shared response for Home and Trip Mode, including across cold starts. */
export async function getCachedWeatherContext(provider: WeatherProvider, input: WeatherRequest) {
  const point = { ...snapshotKey(input), timeZone: input.timeZone };
  const key = `weather-context:${point.provider}:${point.latitude}:${point.longitude}:${point.timeZone}`;
  const result = await singleFlight(key, async (): Promise<WeatherContext> => {
    let stored: WeatherContext | null = null;
    try {
      const snapshot = await getPrismaClient().weatherContextSnapshot.findUnique({
        where: { weather_context_snapshot_point: point },
      });
      if (snapshot && snapshot.fetchedAt.getTime() <= Date.now()) {
        const parsed = payloadSchema.safeParse(snapshot.payload);
        if (parsed.success) {
          stored = { ...parsed.data, fetchedAt: snapshot.fetchedAt.toISOString() };
          if (Date.now() - snapshot.fetchedAt.getTime() < WEATHER_CACHE_TTL_MS) {
            recordProviderCacheEvent({
              cache: 'weather-context',
              kind: 'cache_hit',
              operation: 'getForecast',
              provider: 'open_meteo',
              source: 'weather',
            });
            return stored;
          }
        }
      }
    } catch {
      // An unavailable cache must not prevent normal provider acquisition.
    }

    let acquired: WeatherContext;
    try {
      recordProviderCall({
        endpoint: '/v1/forecast',
        expectedSku: 'weather-forecast-free',
        operation: 'getForecast',
        provider: 'open_meteo',
        source: 'weather',
      });
      const { latitude, longitude, timeZone } = point;
      acquired = {
        ...(await provider.getWeather({
          latitude,
          longitude,
          timeZone,
          temperatureUnit: 'celsius',
        })),
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      if (!stored) throw error;
      // Dated forecasts remain useful; expired current/hourly evidence is withheld.
      return { ...stored, current: null, hours: [] };
    }

    try {
      const { fetchedAt, ...payload } = acquired;
      await getPrismaClient().weatherContextSnapshot.upsert({
        create: { ...point, fetchedAt: new Date(fetchedAt), payload },
        update: { fetchedAt: new Date(fetchedAt), payload },
        where: { weather_context_snapshot_point: point },
      });
    } catch {
      // Return the acquired response even when persistence is unavailable.
    }
    return acquired;
  });

  if (input.temperatureUnit === 'celsius') return result;
  const fahrenheit = (celsius: number) => (celsius * 9) / 5 + 32;
  return {
    ...result,
    temperatureUnit: input.temperatureUnit,
    current: result.current
      ? {
          ...result.current,
          apparentTemperature: fahrenheit(result.current.apparentTemperature),
          temperature: fahrenheit(result.current.temperature),
        }
      : null,
    forecast: result.forecast.map((day) => ({
      ...day,
      temperatureMax: fahrenheit(day.temperatureMax),
      temperatureMin: fahrenheit(day.temperatureMin),
    })),
    hours: result.hours.map((hour) => ({ ...hour, temperature: fahrenheit(hour.temperature) })),
  };
}
