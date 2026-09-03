import { getPrismaClient } from '@trove/db';

import {
  recordProviderCacheEvent,
  recordProviderCall,
  type ProviderCacheMissReason,
  type ProviderCallSource,
} from './provider-usage.js';
import {
  OpenMeteoWeatherProvider,
  type WeatherDailyForecast,
  type WeatherPoint,
  type WeatherPointForecast,
  type WeatherProvider,
} from './weather.js';
import { isWithinForecastWindow, type ForecastWindow } from './weather-window.js';

/**
 * A forecast is a claim about the next fortnight, not a fact about a place, so
 * it expires far sooner than a Place snapshot does. Three hours keeps a day's
 * planning session on one answer while still moving before the shape of the
 * week does.
 */
export const WEATHER_FORECAST_TTL_MS = 3 * 60 * 60 * 1_000;

/**
 * Two decimals is roughly a kilometre, which is finer than the grid Open-Meteo
 * answers on anyway - it snapped 35.68 to 35.7 in testing. Rounding this hard is
 * deliberate: it makes every stop in one city share a single snapshot, which is
 * where the saving on a dense day actually comes from. As in `cached-routes`,
 * the same rounding runs on write and on read, or a row could never be found by
 * the coordinate that created it.
 */
const COORDINATE_PRECISION = 100;

export type CachedPointForecast = {
  days: WeatherDailyForecast[];
  fetchedAt: Date;
  location: { latitude: number; longitude: number; timeZone: string };
  point: WeatherPoint;
};

function round(value: number) {
  return Math.round(value * COORDINATE_PRECISION) / COORDINATE_PRECISION;
}

export function weatherPointKey(point: WeatherPoint) {
  return `${round(point.latitude)},${round(point.longitude)}`;
}

function snapshotKey(point: WeatherPoint) {
  return {
    latitude: round(point.latitude),
    longitude: round(point.longitude),
    provider: 'open_meteo',
  };
}

function toNumber(value: number | { toNumber(): number }) {
  return typeof value === 'number' ? value : value.toNumber();
}

function toDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

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

    for (const point of points) {
      const cached = await this.readSnapshot(point, window);
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
      stale.push(point);
    }

    if (!stale.length) return answers;

    recordProviderCall({
      endpoint: '/v1/forecast',
      expectedSku: 'weather-forecast-free',
      operation: 'getForecast',
      provider: 'open_meteo',
      source: this.source,
    });

    // One request for every stale point, not one per point.
    const fetched = await this.provider.getDailyForecasts({
      endDate: window.endDate,
      points: stale,
      startDate: window.startDate,
    });
    const fetchedAt = this.now();

    for (const forecast of fetched) {
      answers.set(weatherPointKey(forecast.point), { ...forecast, fetchedAt });
      await this.writeSnapshot(forecast, fetchedAt);
    }

    return answers;
  }

  private async readSnapshot(
    point: WeatherPoint,
    window: ForecastWindow,
  ): Promise<
    | { forecast: CachedPointForecast; kind: 'hit' }
    | { kind: 'miss'; reason: ProviderCacheMissReason }
  > {
    let snapshot;

    try {
      snapshot = await getPrismaClient().weatherForecastSnapshot.findUnique({
        include: { days: { orderBy: { date: 'asc' } } },
        where: { weather_forecast_snapshot_point: snapshotKey(point) },
      });
    } catch {
      // A cache that cannot be read is a slow path, never a failed request.
      return { kind: 'miss', reason: 'cache_read_failed' };
    }

    if (!snapshot) return { kind: 'miss', reason: 'missing_snapshot' };
    if (this.now().getTime() - snapshot.fetchedAt.getTime() > WEATHER_FORECAST_TTL_MS) {
      return { kind: 'miss', reason: 'stale_forecast' };
    }

    const days = snapshot.days.map((day) => ({
      date: toDateOnly(day.date),
      precipitationProbability: day.precipitationProbability,
      temperatureMax: toNumber(day.temperatureMaxCelsius),
      temperatureMin: toNumber(day.temperatureMinCelsius),
      weatherCode: day.weatherCode,
    }));

    // A snapshot written before midnight in this zone still looks fresh but has
    // lost the far end of the window. Serving it would quietly shorten the trip.
    const covered = days.filter((day) => isWithinForecastWindow(day.date, window));
    if (!covered.length || covered[covered.length - 1]!.date < window.endDate) {
      return { kind: 'miss', reason: 'incomplete_forecast' };
    }

    return {
      forecast: {
        days,
        fetchedAt: snapshot.fetchedAt,
        location: {
          latitude: toNumber(snapshot.latitude),
          longitude: toNumber(snapshot.longitude),
          timeZone: snapshot.timeZone,
        },
        point,
      },
      kind: 'hit',
    };
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
