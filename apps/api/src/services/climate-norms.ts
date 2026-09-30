import { getPrismaClient } from '@trove/db';
import type { TripContextClimate } from '@trove/types';

import { mapWithConcurrency } from './concurrency.js';
import {
  recordProviderCacheEvent,
  recordProviderCall,
  type ProviderCacheMissReason,
  type ProviderCallSource,
} from './provider-usage.js';

/**
 * Typical conditions for a trip's days, averaged from Open-Meteo's historical
 * archive. These are patterns over past years, never a forecast. Insights may
 * fetch them on a cache miss; Plan Score reads them with `allowFetch: false`
 * only, so scoring never reaches the archive.
 *
 * Climate does not move between trips, so an answer is cached per ~11 km cell
 * and calendar month and shared by every traveller who lands there.
 */
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const CLIMATE_YEARS = 5;
/**
 * 0.1 degrees is about 11 km. Coarser cells averaged the wrong terrain: a 0.5
 * degree cell centre near Da Nang sits on a 1,100 m ridge and reads 5 degrees
 * colder than the coast the traveller is actually on.
 */
const COORDINATE_PRECISION = 10;
/** Days this close to a group's first place share its answer: one city, one pattern. */
const SAME_AREA_DEGREES = 0.5;
/** A trip spanning many cities still asks about at most this many cell-months. */
export const MAX_CLIMATE_CELLS = 4;
export const CLIMATE_NEGATIVE_CACHE_MS = 60 * 60_000;
const REQUEST_TIMEOUT_MS = 8_000;
const WET_DAY_MM = 1;
/** Fewer usable days than this is not a pattern worth describing. */
const MIN_SAMPLE_DAYS = 20;

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;
type Coordinates = { latitude: number; longitude: number };
type Sample = { max: number; min: number; precipitation: number };
type Norm = Pick<TripContextClimate, 'temperatureMaxC' | 'temperatureMinC' | 'wetDayShare'>;

export type ClimateDay = { id: string; date: string; coordinates: Coordinates | null };
export type ClimateOptions = {
  /** False keeps a read cache-only, for paths that must not reach a provider. */
  allowFetch: boolean;
  fetcher?: Fetcher;
  now?: Date;
  source: ProviderCallSource;
};

function round(value: number) {
  return Math.round(value * COORDINATE_PRECISION) / COORDINATE_PRECISION;
}

/** The last complete calendar years, so every month in the range is final. */
export function climateYears(now: Date) {
  const to = now.getUTCFullYear() - 1;
  return { from: to - CLIMATE_YEARS + 1, to };
}

export function summarizeClimate(samples: readonly Sample[]): Norm | null {
  if (samples.length < MIN_SAMPLE_DAYS) return null;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    temperatureMaxC: Math.round(mean(samples.map((sample) => sample.max)) * 10) / 10,
    temperatureMinC: Math.round(mean(samples.map((sample) => sample.min)) * 10) / 10,
    wetDayShare:
      Math.round(
        (100 * samples.filter((sample) => sample.precipitation >= WET_DAY_MM).length) /
          samples.length,
      ) / 100,
  };
}

/**
 * One month of one year. Open-Meteo weighs a request by its span, so a month
 * per year costs a small fraction of one request covering all five years.
 */
async function fetchMonth(
  point: Coordinates,
  year: number,
  month: number,
  options: ClimateOptions & { reason: ProviderCacheMissReason },
): Promise<Sample[]> {
  const url = new URL(ARCHIVE_URL);
  const monthText = String(month).padStart(2, '0');
  url.searchParams.set('latitude', String(point.latitude));
  url.searchParams.set('longitude', String(point.longitude));
  url.searchParams.set('start_date', `${year}-${monthText}-01`);
  url.searchParams.set('end_date', new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10));
  url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_sum');
  url.searchParams.set('timezone', 'auto');
  recordProviderCall({
    cacheMissReason: options.reason,
    endpoint: '/v1/archive',
    expectedSku: 'weather-archive-free',
    operation: 'getClimate',
    provider: 'open_meteo',
    source: options.source,
  });
  const response = await (options.fetcher ?? globalThis.fetch)(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error('climate_unavailable');
  const payload = (await response.json()) as {
    daily?: {
      precipitation_sum?: unknown[];
      temperature_2m_max?: unknown[];
      temperature_2m_min?: unknown[];
    };
  };
  const max = payload.daily?.temperature_2m_max ?? [];
  return max.flatMap((value, index) => {
    const min = payload.daily?.temperature_2m_min?.[index];
    const precipitation = payload.daily?.precipitation_sum?.[index];
    return typeof value === 'number' && typeof min === 'number' && typeof precipitation === 'number'
      ? [{ max: value, min, precipitation }]
      : [];
  });
}

type Snapshot = {
  fetchedAt: Date;
  temperatureMaxCelsius: { toNumber(): number } | null;
  temperatureMinCelsius: { toNumber(): number } | null;
  wetDayShare: { toNumber(): number } | null;
};

async function readClimateNorm(
  point: Coordinates,
  month: number,
  years: { from: number; to: number },
  options: ClimateOptions,
): Promise<Norm | null> {
  const now = options.now ?? new Date();
  const key = {
    provider: 'open_meteo',
    latitude: point.latitude,
    longitude: point.longitude,
    month,
    yearFrom: years.from,
    yearTo: years.to,
  };
  const prisma = getPrismaClient();
  let snapshot: Snapshot | null = null;
  let reason: ProviderCacheMissReason = 'missing_snapshot';
  try {
    snapshot = await prisma.climateNormSnapshot.findUnique({
      where: { climate_norm_snapshot_cell: key },
    });
  } catch {
    // A cache that cannot be read is a slow path, never a failed request.
    reason = 'cache_read_failed';
  }
  const event = {
    operation: 'getClimate',
    provider: 'open_meteo',
    source: options.source,
  } as const;
  if (snapshot?.temperatureMaxCelsius && snapshot.temperatureMinCelsius && snapshot.wetDayShare) {
    recordProviderCacheEvent({ ...event, cache: 'climate-norm', kind: 'cache_hit' });
    return {
      temperatureMaxC: snapshot.temperatureMaxCelsius.toNumber(),
      temperatureMinC: snapshot.temperatureMinCelsius.toNumber(),
      wetDayShare: snapshot.wetDayShare.toNumber(),
    };
  }
  if (snapshot) {
    if (now.getTime() - snapshot.fetchedAt.getTime() < CLIMATE_NEGATIVE_CACHE_MS) {
      recordProviderCacheEvent({ ...event, cache: 'climate-norm', kind: 'negative_cache_hit' });
      return null;
    }
    reason = 'negative_cache_expired';
  }
  if (!options.allowFetch) return null;

  let norm: Norm | null = null;
  let sampleDays = 0;
  try {
    const yearList = Array.from({ length: years.to - years.from + 1 }, (_, i) => years.from + i);
    // A year that fails to answer leaves the others standing; the pattern
    // only has to clear the minimum number of days.
    const samples = (
      await Promise.allSettled(
        yearList.map((year) => fetchMonth(point, year, month, { ...options, reason })),
      )
    ).flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
    sampleDays = samples.length;
    norm = summarizeClimate(samples);
  } catch {
    norm = null;
  }
  // A failure is stored too, without statistics, so the next read within the
  // hour does not ask again.
  const stats = {
    temperatureMaxCelsius: norm?.temperatureMaxC ?? null,
    temperatureMinCelsius: norm?.temperatureMinC ?? null,
    wetDayShare: norm?.wetDayShare ?? null,
    sampleDays,
    fetchedAt: now,
  };
  try {
    await prisma.climateNormSnapshot.upsert({
      where: { climate_norm_snapshot_cell: key },
      create: { ...key, ...stats },
      update: stats,
    });
  } catch {
    // Not caching an answer only costs the next reader a request.
  }
  return norm;
}

/** Typical conditions for each distinct place and month the trip's days fall in. */
export async function tripClimate(
  days: readonly ClimateDay[],
  options: ClimateOptions,
): Promise<TripContextClimate[]> {
  const years = climateYears(options.now ?? new Date());
  const ordered = days.toSorted((a, b) => a.date.localeCompare(b.date));
  // A day with no located stop is spent near the days around it, so it takes
  // the nearest located day's place: the one before it, else the one after.
  const located = ordered.map((day, index) => {
    if (day.coordinates) return day.coordinates;
    for (let offset = 1; offset < ordered.length; offset++) {
      const near = ordered[index - offset]?.coordinates ?? ordered[index + offset]?.coordinates;
      if (near) return near;
    }
    return null;
  });
  const groups: Array<Coordinates & { month: number; dayIds: string[] }> = [];
  for (const [index, day] of ordered.entries()) {
    const coordinates = located[index];
    if (!coordinates) continue;
    const latitude = round(coordinates.latitude);
    const longitude = round(coordinates.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    const month = Number(day.date.slice(5, 7));
    const group = groups.find(
      (entry) =>
        entry.month === month &&
        Math.abs(entry.latitude - latitude) <= SAME_AREA_DEGREES &&
        Math.abs(entry.longitude - longitude) <= SAME_AREA_DEGREES,
    );
    if (group) group.dayIds.push(day.id);
    else if (groups.length < MAX_CLIMATE_CELLS)
      groups.push({ latitude, longitude, month, dayIds: [day.id] });
  }
  const results = await mapWithConcurrency(groups, 2, async (group) => ({
    group,
    norm: await readClimateNorm(group, group.month, years, options),
  }));
  return results.flatMap(({ group, norm }) =>
    norm ? [{ dayIds: group.dayIds, month: group.month, years, ...norm }] : [],
  );
}
