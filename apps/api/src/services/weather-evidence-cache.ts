import { getPrismaClient } from '@trove/db';
import { WEATHER_CACHE_TTL_MS } from '@trove/types';
import type { ProviderCacheMissReason } from './provider-usage.js';
import type { WeatherDailyForecast, WeatherPoint } from './weather.js';
import { isWithinForecastWindow, type ForecastWindow } from './weather-window.js';

/**
 * A forecast is a claim about the next fortnight, not a fact about a place, so
 * it expires far sooner than a Place snapshot does. Three hours keeps a day's
 * planning session on one answer while still moving before the shape of the
 * week does.
 */
export const WEATHER_FORECAST_TTL_MS = WEATHER_CACHE_TTL_MS;

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

export function snapshotKey(point: WeatherPoint) {
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

export async function readCachedForecast(
  point: WeatherPoint,
  window: ForecastWindow,
  now = new Date(),
): Promise<
  | { forecast: CachedPointForecast; kind: 'hit' }
  | {
      kind: 'miss';
      reason: ProviderCacheMissReason;
      /**
       * The snapshot that was not good enough to serve outright. A stale or
       * window-short forecast is still the best answer available when the
       * provider then refuses to give a better one, so it is carried rather
       * than dropped.
       */
      stored: CachedPointForecast | null;
    }
> {
  let snapshot;

  try {
    snapshot = await getPrismaClient().weatherForecastSnapshot.findUnique({
      include: { days: { orderBy: { date: 'asc' } } },
      where: { weather_forecast_snapshot_point: snapshotKey(point) },
    });
  } catch {
    // A cache that cannot be read is a slow path, never a failed request.
    return { kind: 'miss', reason: 'cache_read_failed', stored: null };
  }

  if (!snapshot) return { kind: 'miss', reason: 'missing_snapshot', stored: null };

  const days = snapshot.days.map((day) => ({
    date: toDateOnly(day.date),
    precipitationProbability: day.precipitationProbability,
    temperatureMax: toNumber(day.temperatureMaxCelsius),
    temperatureMin: toNumber(day.temperatureMinCelsius),
    weatherCode: day.weatherCode,
  }));

  const stored: CachedPointForecast = {
    days,
    fetchedAt: snapshot.fetchedAt,
    location: {
      latitude: toNumber(snapshot.latitude),
      longitude: toNumber(snapshot.longitude),
      timeZone: snapshot.timeZone,
    },
    point,
  };

  if (
    snapshot.fetchedAt.getTime() > now.getTime() ||
    now.getTime() - snapshot.fetchedAt.getTime() >= WEATHER_FORECAST_TTL_MS
  ) {
    return { kind: 'miss', reason: 'stale_forecast', stored };
  }

  // A snapshot written before midnight in this zone still looks fresh but has
  // lost the far end of the window. Serving it would quietly shorten the trip.
  const covered = days.filter((day) => isWithinForecastWindow(day.date, window));
  if (!covered.length || covered[covered.length - 1]!.date < window.endDate) {
    return { kind: 'miss', reason: 'incomplete_forecast', stored };
  }

  return { forecast: stored, kind: 'hit' };
}
