import { readFile } from 'node:fs/promises';
import { afterEach, expect, test, vi } from 'vitest';

import {
  CLIMATE_NEGATIVE_CACHE_MS,
  MAX_CLIMATE_CELLS,
  climateYears,
  summarizeClimate,
  tripClimate,
} from '../src/services/climate-norms.js';
import { ItineraryNotFoundError } from '../src/services/itineraries.js';
import { readTripContext } from '../src/services/trip-context.js';
import { dayCountry, tripHolidays } from '../src/services/trip-holidays.js';

const NOW = new Date('2026-09-29T12:00:00Z');
const decimal = (n: number) => ({ toNumber: () => n });
afterEach(() => vi.unstubAllGlobals());

/** A month of archive answers: warm days, rain on every other one. */
function archiveResponse() {
  const days = Array.from({ length: 30 }, (_, i) => i);
  return new Response(
    JSON.stringify({
      daily: {
        time: days.map((i) => `2025-10-${String(i + 1).padStart(2, '0')}`),
        temperature_2m_max: days.map(() => 30),
        temperature_2m_min: days.map(() => 24),
        precipitation_sum: days.map((i) => (i % 2 ? 4 : 0)),
      },
    }),
  );
}

function stubClimateCache(stored: Record<string, unknown> | null = null) {
  const cache = {
    findUnique: vi.fn(async () => stored),
    upsert: vi.fn(async () => ({})),
  };
  vi.stubGlobal('trovePrismaClient', { climateNormSnapshot: cache });
  return cache;
}

test('a day is placed in a country by its zone, settling shared zones with the trip', () => {
  expect(dayCountry({ id: 'd', date: '2026-10-12', timeZone: 'Asia/Tokyo' }, [])).toBe('JP');
  // Vietnam lists Asia/Bangkok alongside Thailand.
  expect(dayCountry({ id: 'd', date: '2026-10-12', timeZone: 'Asia/Bangkok' }, ['VN'])).toBe('VN');
  expect(dayCountry({ id: 'd', date: '2026-10-12', timeZone: 'Asia/Bangkok' }, ['TH', 'VN'])).toBe(
    null,
  );
  expect(dayCountry({ id: 'd', date: '2026-10-12', timeZone: null }, ['SG'])).toBe('SG');
  expect(dayCountry({ id: 'd', date: '2026-10-12', timeZone: null }, ['SG', 'MY'])).toBe(null);
});

test('only public holidays on the trip days are reported, lunar-sighted ones as expected', () => {
  const holidays = tripHolidays({
    countries: ['JP'],
    language: 'en',
    days: [
      { id: 'sports', date: '2026-10-12', timeZone: 'Asia/Tokyo' },
      { id: 'plain', date: '2026-10-13', timeZone: 'Asia/Tokyo' },
      // Shichi-Go-San is an observance, not a public holiday.
      { id: 'observance', date: '2026-11-15', timeZone: 'Asia/Tokyo' },
    ],
  });
  expect(holidays).toEqual([
    {
      certainty: 'official',
      countryCode: 'JP',
      date: '2026-10-12',
      dayIds: ['sports'],
      name: 'Sports Day',
    },
  ]);
  const malaysia = tripHolidays({
    countries: ['MY'],
    language: 'en',
    days: [
      { id: 'eid', date: '2026-03-21', timeZone: 'Asia/Kuala_Lumpur' },
      { id: 'deepavali', date: '2026-11-08', timeZone: 'Asia/Kuala_Lumpur' },
    ],
  });
  expect(malaysia.map(({ dayIds, certainty }) => [dayIds[0], certainty])).toEqual([
    ['eid', 'expected'],
    ['deepavali', 'official'],
  ]);
});

test('a multi-day holiday covers every local date it spans', () => {
  const tet = tripHolidays({
    countries: ['VN'],
    language: 'en',
    days: [{ id: 'mid-tet', date: '2026-02-19', timeZone: 'Asia/Ho_Chi_Minh' }],
  });
  expect(tet.length).toBeGreaterThan(0);
  expect(tet.every((holiday) => holiday.dayIds.includes('mid-tet'))).toBe(true);
});

test('typical conditions average past years and need enough days to be a pattern', () => {
  expect(summarizeClimate([{ max: 30, min: 24, precipitation: 0 }])).toBeNull();
  const samples = Array.from({ length: 20 }, (_, i) => ({
    max: 30 + (i % 2),
    min: 24,
    precipitation: i < 5 ? 3 : 0.5,
  }));
  expect(summarizeClimate(samples)).toEqual({
    temperatureMaxC: 30.5,
    temperatureMinC: 24,
    wetDayShare: 0.25,
  });
  expect(climateYears(NOW)).toEqual({ from: 2021, to: 2025 });
});

test('a cold cell asks once per past year and caches; a warm cell asks nothing', async () => {
  const cache = stubClimateCache();
  const fetcher = vi.fn(async () => archiveResponse());
  const days = [
    { id: 'a', date: '2026-10-16', coordinates: { latitude: 1.32, longitude: 103.82 } },
    { id: 'b', date: '2026-10-17', coordinates: { latitude: 1.29, longitude: 103.84 } },
    // No located stop: it is spent near the days around it.
    { id: 'c', date: '2026-10-18', coordinates: null },
  ];
  const [climate] = await tripClimate(days, {
    allowFetch: true,
    fetcher,
    now: NOW,
    source: 'test',
  });
  expect(fetcher).toHaveBeenCalledTimes(5);
  expect(climate).toEqual({
    dayIds: ['a', 'b', 'c'],
    month: 10,
    years: { from: 2021, to: 2025 },
    temperatureMaxC: 30,
    temperatureMinC: 24,
    wetDayShare: 0.5,
  });
  expect(cache.upsert).toHaveBeenCalledOnce();

  const warm = stubClimateCache({
    fetchedAt: NOW,
    temperatureMaxCelsius: decimal(30),
    temperatureMinCelsius: decimal(24),
    wetDayShare: decimal(0.5),
  });
  const again = vi.fn(async () => archiveResponse());
  await tripClimate(days, { allowFetch: true, fetcher: again, now: NOW, source: 'test' });
  expect(again).not.toHaveBeenCalled();
  expect(warm.upsert).not.toHaveBeenCalled();
});

test('a failed fetch is remembered for an hour, and cache-only reads never fetch', async () => {
  const fetcher = vi.fn(async () => new Response('', { status: 503 }));
  const days = [{ id: 'a', date: '2026-10-16', coordinates: { latitude: 1.3, longitude: 103.8 } }];
  const failure = {
    fetchedAt: new Date(NOW.getTime() - CLIMATE_NEGATIVE_CACHE_MS / 2),
    temperatureMaxCelsius: null,
    temperatureMinCelsius: null,
    wetDayShare: null,
  };
  stubClimateCache(failure);
  expect(await tripClimate(days, { allowFetch: true, fetcher, now: NOW, source: 'test' })).toEqual(
    [],
  );
  expect(fetcher).not.toHaveBeenCalled();

  stubClimateCache({ ...failure, fetchedAt: new Date(NOW.getTime() - CLIMATE_NEGATIVE_CACHE_MS) });
  await tripClimate(days, { allowFetch: true, fetcher, now: NOW, source: 'test' });
  expect(fetcher).toHaveBeenCalledTimes(5);

  fetcher.mockClear();
  stubClimateCache();
  expect(await tripClimate(days, { allowFetch: false, fetcher, now: NOW, source: 'test' })).toEqual(
    [],
  );
  expect(fetcher).not.toHaveBeenCalled();
});

test('a trip across many cities asks about a bounded number of places', async () => {
  const cache = stubClimateCache({
    fetchedAt: NOW,
    temperatureMaxCelsius: decimal(20),
    temperatureMinCelsius: decimal(10),
    wetDayShare: decimal(0.2),
  });
  const days = Array.from({ length: 8 }, (_, i) => ({
    id: `day-${i}`,
    date: `2026-10-${String(10 + i).padStart(2, '0')}`,
    coordinates: { latitude: 30 + i, longitude: 130 },
  }));
  const climate = await tripClimate(days, { allowFetch: false, now: NOW, source: 'test' });
  expect(climate).toHaveLength(MAX_CLIMATE_CELLS);
  expect(cache.findUnique).toHaveBeenCalledTimes(MAX_CLIMATE_CELLS);
});

test("another traveller's trip answers as if it did not exist", async () => {
  const findFirst = vi.fn(async () => null);
  vi.stubGlobal('trovePrismaClient', { trip: { findFirst } });
  await expect(readTripContext('intruder', 'trip')).rejects.toBeInstanceOf(ItineraryNotFoundError);
  expect(findFirst).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 'trip', ownerId: 'intruder' } }),
  );
});

test('scoring never reaches the trip context or its climate provider', async () => {
  for (const file of [
    'plan-score.ts',
    'plan-score-evaluation.ts',
    'ai-draft-score-reader.ts',
    'ai-planning-plan-score.ts',
  ]) {
    const source = await readFile(new URL(`../src/services/${file}`, import.meta.url), 'utf8');
    expect(source, file).not.toMatch(/from ['"]\.\/(?:climate-norms|trip-context|trip-holidays)/);
  }
});

test('one city is one pattern, and a year that fails leaves the others standing', async () => {
  stubClimateCache();
  let calls = 0;
  const fetcher = vi.fn(async () =>
    ++calls === 2 ? new Response('', { status: 429 }) : archiveResponse(),
  );
  const climate = await tripClimate(
    [
      { id: 'marina', date: '2026-10-16', coordinates: { latitude: 1.28, longitude: 103.85 } },
      { id: 'changi', date: '2026-10-17', coordinates: { latitude: 1.36, longitude: 103.99 } },
    ],
    { allowFetch: true, fetcher, now: NOW, source: 'test' },
  );
  expect(fetcher).toHaveBeenCalledTimes(5);
  expect(climate).toHaveLength(1);
  expect(climate[0]?.dayIds).toEqual(['marina', 'changi']);
});
