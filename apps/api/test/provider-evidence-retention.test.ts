import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { cleanupProviderEvidence } from '../src/services/provider-evidence-retention.js';

const NOW = new Date('2026-09-30T03:20:00.000Z');
const DAY = 86_400_000;
const LIFETIME = 30 * DAY;

type Row = Record<string, unknown>;
type Filter = Record<string, { lte: Date }>;

/** A table that applies `lte` filters the way the database does. */
function table(rows: Row[]) {
  const matches = (row: Row, where: Filter) =>
    Object.entries(where).every(([field, { lte }]) => {
      const value = row[field];
      return value instanceof Date && value.getTime() <= lte.getTime();
    });

  return {
    deleteMany: vi.fn(async ({ where }: { where: Filter }) => {
      const doomed = rows.filter((row) => matches(row, where));
      for (const row of doomed) rows.splice(rows.indexOf(row), 1);
      return { count: doomed.length };
    }),
    updateMany: vi.fn(async ({ data, where }: { data: Row; where: Filter }) => {
      const hit = rows.filter((row) => matches(row, where));
      for (const row of hit) Object.assign(row, data);
      return { count: hit.length };
    }),
  };
}

let refs: Row[];
let legs: Row[];
let grounding: Row[];
let weather: Row[];
let weatherContext: Row[];

const ago = (ms: number) => new Date(NOW.getTime() - ms);

beforeEach(() => {
  refs = [];
  legs = [];
  grounding = [];
  weather = [];
  weatherContext = [];
  vi.stubGlobal('trovePrismaClient', {
    aiPlaceGroundingCache: table(grounding),
    placeProviderRef: table(refs),
    travelLegCache: table(legs),
    weatherForecastSnapshot: table(weather),
    weatherContextSnapshot: table(weatherContext),
  });
});
afterEach(() => vi.unstubAllGlobals());

test('nothing is removed before the end of its 30 days, whichever dataset it is in', async () => {
  const almost = ago(LIFETIME - 1);
  refs.push({
    cachedAt: almost,
    cachedEvidence: { rating: 4.5 },
    cachedEvidenceAt: almost,
    cachedName: 'Fresh Cafe',
    detailsFailedAt: almost,
    detailsFailureCode: 'NOT_FOUND',
    externalPlaceId: 'fresh',
  });
  legs.push({ fetchedAt: almost });
  grounding.push({ checkedAt: almost });
  weather.push({ fetchedAt: almost });

  await expect(cleanupProviderEvidence(NOW)).resolves.toStrictEqual({
    clearedFailureMarkers: 0,
    clearedPlaceEvidence: 0,
    clearedPlaceIdentity: 0,
    deletedGroundingDecisions: 0,
    deletedTravelLegs: 0,
    deletedWeatherSnapshots: 0,
    deletedWeatherContextSnapshots: 0,
  });

  expect(refs[0]).toMatchObject({
    cachedEvidence: { rating: 4.5 },
    cachedName: 'Fresh Cafe',
    detailsFailureCode: 'NOT_FOUND',
  });
  expect(legs).toHaveLength(1);
  expect(grounding).toHaveLength(1);
  expect(weather).toHaveLength(1);
});

test('everything is removed at exactly 30 days, keeping the link to the place', async () => {
  const expired = ago(LIFETIME);
  refs.push({
    cachedAt: expired,
    cachedEvidence: { rating: 4.5 },
    cachedEvidenceAt: expired,
    cachedFormattedAddress: '1 Main St',
    cachedLatitude: 35.01,
    cachedLongitude: 135.77,
    cachedName: 'Old Cafe',
    cachedTypes: ['cafe'],
    detailsFailedAt: expired,
    detailsFailureCode: 'NOT_FOUND',
    externalPlaceId: 'old',
  });
  legs.push({ fetchedAt: expired });
  grounding.push({ checkedAt: expired });
  weather.push({ fetchedAt: expired });

  await expect(cleanupProviderEvidence(NOW)).resolves.toStrictEqual({
    clearedFailureMarkers: 1,
    clearedPlaceEvidence: 1,
    clearedPlaceIdentity: 1,
    deletedGroundingDecisions: 1,
    deletedTravelLegs: 1,
    deletedWeatherSnapshots: 1,
    deletedWeatherContextSnapshots: 0,
  });

  expect(refs[0]).toMatchObject({
    cachedAt: null,
    cachedFormattedAddress: null,
    cachedLatitude: null,
    cachedLongitude: null,
    cachedName: null,
    cachedTypes: [],
    detailsFailedAt: null,
    detailsFailureCode: null,
    externalPlaceId: 'old',
  });
  expect(refs[0]?.cachedEvidenceAt).toBeNull();
  expect(legs).toHaveLength(0);
  expect(grounding).toHaveLength(0);
  expect(weather).toHaveLength(0);
});

test('each dataset expires on its own clock', async () => {
  refs.push({
    cachedAt: ago(LIFETIME + DAY),
    cachedEvidence: { rating: 4 },
    cachedEvidenceAt: ago(2 * DAY),
    cachedName: 'Identity old, evidence fresh',
    externalPlaceId: 'a',
  });
  refs.push({
    cachedAt: ago(2 * DAY),
    cachedEvidence: { rating: 3 },
    cachedEvidenceAt: ago(LIFETIME + DAY),
    cachedName: 'Identity fresh, evidence old',
    externalPlaceId: 'b',
  });

  await cleanupProviderEvidence(NOW);

  expect(refs[0]).toMatchObject({ cachedEvidence: { rating: 4 }, cachedName: null });
  expect(refs[1]).toMatchObject({
    cachedEvidenceAt: null,
    cachedName: 'Identity fresh, evidence old',
  });
});

test('current/hourly snapshots expire at three hours independently of daily retention', async () => {
  weatherContext.push({ fetchedAt: ago(3 * 60 * 60 * 1_000 - 1) });
  weatherContext.push({ fetchedAt: ago(3 * 60 * 60 * 1_000) });
  weather.push({ fetchedAt: ago(3 * 60 * 60 * 1_000) });
  await expect(cleanupProviderEvidence(NOW)).resolves.toMatchObject({
    deletedWeatherContextSnapshots: 1,
    deletedWeatherSnapshots: 0,
  });
  expect(weatherContext).toHaveLength(1);
  expect(weather).toHaveLength(1);
});
