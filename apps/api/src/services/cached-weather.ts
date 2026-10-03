import { singleFlight } from './single-flight.js';
import { getPrismaClient } from '@trove/db';

import {
  recordProviderCacheEvent,
  recordProviderCall,
  type ProviderCallSource,
} from './provider-usage.js';
import {
  OpenMeteoWeatherProvider,
  type WeatherPoint,
  type WeatherPointForecast,
  type WeatherProvider,
} from './weather.js';
import { type ForecastWindow } from './weather-window.js';

export type { CachedPointForecast } from './weather-evidence-cache.js';
export { WEATHER_FORECAST_TTL_MS, weatherPointKey } from './weather-evidence-cache.js';
import {
  readCachedForecast,
  weatherPointKey,
  snapshotKey,
  type CachedPointForecast,
} from './weather-evidence-cache.js';

/**
 * The trip's day-by-day forecast, bought once and shared by everyone.
 *
 * A forecast is not private and not personal: two travellers in the same city
 * want the same numbers, and so does the same traveller on Today, on the day
 * rail, and on the trip overview. Asking per screen turned one answer into
 * dozens of identical requests, which is the shape AGENTS.md warns about even
 * where, as here, the provider bills nothing.
 */
export class CachedWeatherService {
  constructor(
    private readonly provider: WeatherProvider = new OpenMeteoWeatherProvider(),
    private readonly now: () => Date = () => new Date(),
    private readonly source: ProviderCallSource = 'weather',
  ) {}

  /**
   * Every point's forecast for `window`, refreshing only the points whose
   * snapshot cannot answer it. A batch where nothing is stale makes no outbound
   * request at all.
   */
  async getForecasts(
    points: readonly WeatherPoint[],
    window: ForecastWindow,
  ): Promise<Map<string, CachedPointForecast>> {
    const answers = new Map<string, CachedPointForecast>();
    const stale: WeatherPoint[] = [];
    const storedForStale = new Map<string, CachedPointForecast>();

    for (const point of new Map(points.map((point) => [weatherPointKey(point), point])).values()) {
      const cached = await readCachedForecast(point, window, this.now());
      if (cached.kind === 'hit') {
        recordProviderCacheEvent({
          cache: 'weather-forecast',
          kind: 'cache_hit',
          operation: 'getForecast',
          provider: 'open_meteo',
          source: this.source,
        });
        answers.set(weatherPointKey(point), cached.forecast);
        continue;
      }
      if (cached.stored) storedForStale.set(weatherPointKey(point), cached.stored);
      stale.push(point);
    }

    if (!stale.length) return answers;

    // One request for every stale point, not one per point.
    let acquired;
    try {
      acquired = await singleFlight(
        `weather:${window.startDate}:${window.endDate}:${stale.map(weatherPointKey).toSorted().join(';')}`,
        async () => {
          recordProviderCall({
            endpoint: '/v1/forecast',
            expectedSku: 'weather-forecast-free',
            operation: 'getForecast',
            provider: 'open_meteo',
            source: this.source,
          });

          const forecasts = await this.provider.getDailyForecasts({
            endDate: window.endDate,
            points: stale,
            startDate: window.startDate,
          });
          const fetchedAt = this.now();
          for (const forecast of forecasts) await this.writeSnapshot(forecast, fetchedAt);
          return { forecasts, fetchedAt };
        },
      );
    } catch (error) {
      // A refused forecast is not a refused trip. Yesterday's answer for the
      // same place is worth more than nothing, and the surfaces already say how
      // old what they are showing is - so the stored snapshot stands in.
      //
      // With nothing stored for any of them there is genuinely nothing to show,
      // and the caller should hear why rather than receive a silent blank.
      let servedAny = false;
      for (const point of stale) {
        const fallback = storedForStale.get(weatherPointKey(point));
        if (!fallback) continue;
        answers.set(weatherPointKey(point), fallback);
        servedAny = true;
      }
      if (!servedAny) throw error;

      return answers;
    }
    const { forecasts, fetchedAt } = acquired;

    for (const forecast of forecasts) {
      answers.set(weatherPointKey(forecast.point), { ...forecast, fetchedAt });
    }

    return answers;
  }

  private async writeSnapshot(forecast: WeatherPointForecast, fetchedAt: Date) {
    const key = snapshotKey(forecast.point);

    try {
      await getPrismaClient().$transaction(async (transaction) => {
        const snapshot = await transaction.weatherForecastSnapshot.upsert({
          create: { ...key, fetchedAt, timeZone: forecast.location.timeZone },
          update: { fetchedAt, timeZone: forecast.location.timeZone },
          where: { weather_forecast_snapshot_point: key },
        });

        await transaction.weatherForecastSnapshotDay.deleteMany({
          where: { snapshotId: snapshot.id },
        });
        await transaction.weatherForecastSnapshotDay.createMany({
          data: forecast.days.map((day) => ({
            date: new Date(`${day.date}T00:00:00.000Z`),
            precipitationProbability: day.precipitationProbability,
            snapshotId: snapshot.id,
            temperatureMaxCelsius: day.temperatureMax,
            temperatureMinCelsius: day.temperatureMin,
            weatherCode: day.weatherCode,
          })),
        });
      });
    } catch {
      // Failing to cache must never fail the request that produced the data.
    }
  }
}
