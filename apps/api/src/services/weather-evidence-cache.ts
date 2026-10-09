import { getPrismaClient } from '@trove/db';
import {
  WEATHER_CACHE_POLICY,
  weatherCoordinate,
  weatherDailyTtl,
  weatherEvidenceFresh,
} from '@trove/types';
import { weatherMemory } from './weather-memory.js';
import type { ProviderCacheMissReason } from './provider-usage.js';
import type { WeatherDailyForecast, WeatherPoint } from './weather.js';
import { isWithinForecastWindow, type ForecastWindow } from './weather-window.js';

/**
 * A forecast is a claim about the next fortnight, not a fact about a place, so
 * today's evidence expires after one hour and upcoming evidence after six hours.
 */
export const WEATHER_FORECAST_TTL_MS = WEATHER_CACHE_POLICY.forecastMs;

/**
 * Two decimals is roughly a kilometre, which is finer than the grid Open-Meteo
 * answers on anyway - it snapped 35.68 to 35.7 in testing. Rounding this hard is
 * deliberate: it makes every stop in one city share a single snapshot, which is
 * where the saving on a dense day actually comes from. As in `cached-routes`,
 * the same rounding runs on write and on read, or a row could never be found by
 * the coordinate that created it.
 */

export type CachedPointForecast = {
  days: WeatherDailyForecast[];
  fetchedAt: Date;
  location: { latitude: number; longitude: number; timeZone: string };
  point: WeatherPoint;
};

function round(value: number) {
  return weatherCoordinate(value);
}

export function weatherPointKey(point: WeatherPoint) {
  return `${round(point.latitude)},${round(point.longitude)}${point.timeZone ? `:${point.timeZone}` : ''}`;
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

type SnapshotRow = {
  fetchedAt: Date;
  latitude: number | { toNumber(): number };
  longitude: number | { toNumber(): number };
  timeZone: string;
  days: {
    date: Date;
    precipitationProbability: number | null;
    temperatureMaxCelsius: number | { toNumber(): number };
    temperatureMinCelsius: number | { toNumber(): number };
    weatherCode: number;
  }[];
};
export async function readCachedForecast(
  point: WeatherPoint,
  window: ForecastWindow,
  now = new Date(),
  provided?: { snapshot: SnapshotRow | null },
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
  const memory = weatherMemory();
  const memoryKey = `daily:${weatherPointKey(point)}`;
  const retained = memory.get<CachedPointForecast>(memoryKey);
  if (retained && forecastIsFresh(retained, window, now)) {
    return { kind: 'hit', forecast: retained };
  }
  let snapshot;
  try {
    snapshot = provided
      ? provided.snapshot
      : await getPrismaClient().weatherForecastSnapshot.findUnique({
          include: { days: { orderBy: { date: 'asc' } } },
          where: { weather_forecast_snapshot_point: snapshotKey(point) },
        });
  } catch {
    return { kind: 'miss', reason: 'cache_read_failed', stored: retained ?? null };
  }
  if (!snapshot) return { kind: 'miss', reason: 'missing_snapshot', stored: retained ?? null };

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

  if (retained && retained.fetchedAt > stored.fetchedAt)
    return { kind: 'miss', reason: 'stale_forecast', stored: retained };
  if (point.timeZone && point.timeZone !== stored.location.timeZone)
    return { kind: 'miss', reason: 'incomplete_forecast', stored: null };
  memory.set(memoryKey, stored);
  if (!forecastIsFresh(stored, window, now)) {
    const covered = days.filter((day) => isWithinForecastWindow(day.date, window));
    const complete =
      covered.length &&
      covered[0]!.date === window.startDate &&
      covered.at(-1)!.date === window.endDate;
    return { kind: 'miss', reason: complete ? 'stale_forecast' : 'incomplete_forecast', stored };
  }
  return { forecast: stored, kind: 'hit' };
}

export function forecastIsFresh(forecast: CachedPointForecast, window: ForecastWindow, now: Date) {
  const covered = forecast.days.filter((day) => isWithinForecastWindow(day.date, window));
  if (
    !covered.length ||
    covered[0]!.date !== window.startDate ||
    covered.at(-1)!.date !== window.endDate
  )
    return false;
  const expected = (Date.parse(window.endDate) - Date.parse(window.startDate)) / 86_400_000 + 1;
  if (covered.length !== expected) return false;
  return covered.every((day) =>
    weatherEvidenceFresh(
      forecast.fetchedAt.getTime(),
      weatherDailyTtl(day.date, forecast.location.timeZone, now),
      now.getTime(),
    ),
  );
}

/** Used by both live and daily acquisitions, preserving the original retrieval. */
export async function writeForecastSnapshot(forecast: CachedPointForecast) {
  weatherMemory().set(`daily:${weatherPointKey(forecast.point)}`, forecast);
  const key = snapshotKey(forecast.point);
  try {
    await getPrismaClient().$transaction(async (transaction) => {
      const snapshot = await transaction.weatherForecastSnapshot.upsert({
        create: { ...key, fetchedAt: forecast.fetchedAt, timeZone: forecast.location.timeZone },
        update: { fetchedAt: forecast.fetchedAt, timeZone: forecast.location.timeZone },
        where: { weather_forecast_snapshot_point: key },
      });
      await transaction.weatherForecastSnapshotDay.deleteMany({
        where: { snapshotId: snapshot.id },
      });
      await transaction.weatherForecastSnapshotDay.createMany({
        data: forecast.days.map((day) => ({
          date: new Date(`${day.date}T00:00:00Z`),
          precipitationProbability: day.precipitationProbability,
          snapshotId: snapshot.id,
          temperatureMaxCelsius: day.temperatureMax,
          temperatureMinCelsius: day.temperatureMin,
          weatherCode: day.weatherCode,
        })),
      });
    });
  } catch {
    /* Acquisition remains available when persistence fails. */
  }
}

/** One query for cold points; the read-only reader also serves the memory tier. */
export async function readCachedForecastBatch(
  points: readonly WeatherPoint[],
  window: ForecastWindow,
  now: Date,
  required?: ReadonlyMap<string, ForecastWindow>,
) {
  const memory = weatherMemory();
  const cold = points.filter((point) => {
    const retained = memory.get<CachedPointForecast>(`daily:${weatherPointKey(point)}`);
    return (
      !retained || !forecastIsFresh(retained, required?.get(weatherPointKey(point)) ?? window, now)
    );
  });
  const table = getPrismaClient().weatherForecastSnapshot;
  let rows: SnapshotRow[] | undefined;
  if (cold.length && table.findMany) {
    try {
      rows = await table.findMany({
        where: { OR: cold.map(snapshotKey) },
        include: { days: { orderBy: { date: 'asc' } } },
      });
    } catch {
      rows = []; /* A failed batch does not fan out into per-point database retries. */
    }
  }
  return new Map(
    await Promise.all(
      points.map(async (point) => {
        const snapshot =
          rows?.find(
            (row) =>
              weatherPointKey({
                latitude: toNumber(row.latitude),
                longitude: toNumber(row.longitude),
              }) === weatherPointKey(snapshotKey(point)),
          ) ?? null;
        return [
          weatherPointKey(point),
          await readCachedForecast(
            point,
            required?.get(weatherPointKey(point)) ?? window,
            now,
            rows ? { snapshot } : undefined,
          ),
        ] as const;
      }),
    ),
  );
}
