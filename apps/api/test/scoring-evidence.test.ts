import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { getTripPlanScore } from '../src/services/plan-score.js';
import {
  readCachedPlaceEvidence,
  storePlaceEvidence,
  PLACE_EVIDENCE_TTL_MS,
} from '../src/services/place-evidence-cache.js';
import { readCachedRoute } from '../src/services/route-evidence-cache.js';
import { readCachedForecast } from '../src/services/weather-evidence-cache.js';
import { singleFlight } from '../src/services/single-flight.js';
import { cleanupProviderEvidence } from '../src/services/provider-evidence-retention.js';
import type { ProviderPlaceDetails } from '../src/services/places.js';

const NOW = new Date('2026-09-28T09:00:00Z');
const DAY = 86400000;
const decimal = (value: number) => ({ toNumber: () => value });
const place: ProviderPlaceDetails = {
  provider: 'google',
  externalPlaceId: 'venue',
  attributions: [],
  category: 'things_to_do',
  formattedAddress: null,
  googleMapsUri: null,
  location: null,
  name: '',
  openingPeriods: [],
  primaryType: null,
  rating: 4.7,
  userRatingCount: 1000,
  rawTypes: [],
  utcOffsetMinutes: 0,
};
let evidenceRow: Record<string, unknown>;
let trip: any;
let route: any;
let forecast: any;
let update: ReturnType<typeof vi.fn>;
let outbound: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv('TROVE_PLAN_SCORE_DISABLED', 'false');
  evidenceRow = {
    cachedEvidence: place,
    cachedEvidenceAt: new Date(NOW.getTime() - 2 * DAY),
    cachedEvidenceLanguage: 'ja',
    cachedEvidenceRegion: 'JP',
  };
  const reference = {
    provider: 'GOOGLE',
    externalPlaceId: 'venue',
    cachedAt: NOW,
    cachedLatitude: decimal(1),
    cachedLongitude: decimal(2),
    cachedName: 'Venue',
  };
  const canonical = {
    id: 'place',
    customLatitude: null,
    customLongitude: null,
    customName: null,
    providerRefs: [reference],
  };
  const tripPlace = { id: 'tp', placeId: 'place', priority: null, place: canonical };
  const day = {
    id: 'day',
    date: new Date('2026-09-28'),
    defaultTimeZone: 'UTC',
    dailyBaseTripPlaceId: null,
    dailyBaseDepartureTripPlaceId: null,
    dailyBaseTripPlace: null,
    dailyBaseDepartureTripPlace: null,
    accommodationReservations: [],
    routeStartTravelMode: 'WALK',
    planningContext: null,
    items: [
      {
        id: 'item',
        tripPlaceId: 'tp',
        tripPlace,
        position: 0,
        travelModeToNext: 'WALK',
        localStartTime: new Date('1970-01-01T09:00Z'),
        durationMinutes: 60,
        durationProvenance: 'USER_OWNED',
        timeSemantics: 'FLOATING_LOCAL',
        timeProvenance: 'USER_OWNED',
        timeZone: 'UTC',
        startInstant: null,
        dayPart: null,
        _count: { reservations: 0 },
      },
    ],
  };
  trip = {
    id: 'trip',
    ownerId: 'owner',
    startDate: day.date,
    endDate: day.date,
    startingPlace: null,
    startingPlaceId: null,
    itineraryDays: [day],
    tripPlaces: [tripPlace],
    reservations: [],
    destinations: [],
    planningPreferences: null,
    planScore: null,
    planScoreComputedAt: null,
    planScoreRevision: null,
  };
  route = null;
  forecast = null;
  update = vi.fn(async ({ data }) => {
    Object.assign(trip, data);
    return trip;
  });
  outbound = vi.fn(async () => {
    throw new Error('unexpected provider request');
  });
  vi.stubGlobal('fetch', outbound);
  vi.stubGlobal('trovePrismaClient', {
    trip: { findFirst: vi.fn(async () => trip), update },
    placeProviderRef: {
      findUnique: vi.fn(async () => evidenceRow),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    aiPlaceGroundingCache: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    travelLegCache: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      findUnique: vi.fn(async () => route),
    },
    weatherForecastSnapshot: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      findUnique: vi.fn(async () => forecast),
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

for (const state of ['cold', 'warm', 'expired', 'malformed'] as const)
  test(`scoring and retry make zero provider requests with ${state} evidence`, async () => {
    if (state === 'cold') evidenceRow = {};
    if (state === 'expired')
      evidenceRow.cachedEvidenceAt = new Date(NOW.getTime() - PLACE_EVIDENCE_TTL_MS);
    if (state === 'malformed') evidenceRow.cachedEvidence = { rating: 'invalid' };
    const first = await getTripPlanScore('owner', 'trip', { now: () => NOW });
    const second = await getTripPlanScore('owner', 'trip', { now: () => NOW });
    expect(second).toEqual(first);
    expect(outbound).not.toHaveBeenCalled();
    expect(first?.days[0]?.factors.EXPERIENCE_QUALITY.state).toBe(
      state === 'warm' ? 'LIMITED' : 'UNKNOWN',
    );
    if (state === 'warm')
      expect(first?.evidenceAsOf).toBe((evidenceRow.cachedEvidenceAt as Date).toISOString());
  });

test('new evidence, preferences, and day context invalidate a cached assessment without acquisition', async () => {
  await getTripPlanScore('owner', 'trip', { now: () => NOW });
  expect(update).toHaveBeenCalledTimes(1);
  trip.planningPreferences = {
    pace: 'relaxed',
    interests: ['nature_scenery'],
    unmatchedInterests: [],
  };
  await getTripPlanScore('owner', 'trip', { now: () => NOW });
  trip.itineraryDays[0].planningContext = { intent: 'rest', availability: null };
  await getTripPlanScore('owner', 'trip', { now: () => NOW });
  evidenceRow.cachedEvidence = { ...place, rating: 2 };
  await getTripPlanScore('owner', 'trip', { now: () => NOW });
  expect(update).toHaveBeenCalledTimes(4);
  expect(outbound).not.toHaveBeenCalled();
});

test('a concurrent itinerary edit supersedes an older scoring read', async () => {
  const cache = (globalThis as any).trovePrismaClient.placeProviderRef;
  const originalRead = cache.findUnique;
  let reads = 0;
  cache.findUnique = vi.fn(async (args: unknown) => {
    if (reads++ === 0) trip.itineraryDays[0].items[0].durationMinutes = 90;
    return originalRead(args);
  });
  const first = await getTripPlanScore('owner', 'trip', { now: () => NOW });
  const second = await getTripPlanScore('owner', 'trip', { now: () => NOW });
  expect(first?.fingerprint).toBe(second?.fingerprint);
  expect(update).toHaveBeenCalledTimes(1);
  expect(outbound).not.toHaveBeenCalled();
});

test('unknown stops remain in the route chain instead of being bypassed', async () => {
  trip.itineraryDays[0].items.push({
    ...trip.itineraryDays[0].items[0],
    id: 'unknown',
    tripPlace: null,
    tripPlaceId: null,
    position: 1,
  });
  const result = await getTripPlanScore('owner', 'trip', { now: () => NOW });
  expect(result?.days[0]?.factors.ROUTE_EFFICIENCY).toMatchObject({ state: 'UNKNOWN' });
  expect(outbound).not.toHaveBeenCalled();
});

test('rich evidence retains its original age and request locale while score fields are language independent', async () => {
  expect(
    await readCachedPlaceEvidence({ externalPlaceId: 'venue', languageCode: 'en' }, NOW),
  ).toBeNull();
  const hit = await readCachedPlaceEvidence(
    { externalPlaceId: 'venue', languageCode: 'ja', regionCode: 'JP' },
    NOW,
  );
  expect(hit?.freshness).toEqual({
    fetchedAt: (evidenceRow.cachedEvidenceAt as Date).toISOString(),
    source: 'cache',
  });
  const write = (globalThis as any).trovePrismaClient.placeProviderRef.updateMany;
  await storePlaceEvidence(
    { externalPlaceId: 'venue' },
    {
      status: 'ok',
      provider: 'google',
      freshness: { fetchedAt: hit!.freshness.fetchedAt, source: 'cache' },
      place,
    },
  );
  expect(write.mock.calls[0][0].data.cachedEvidenceAt).toEqual(evidenceRow.cachedEvidenceAt);
  expect(write.mock.calls[0][0].where.OR).toContainEqual({
    cachedEvidenceAt: { lte: evidenceRow.cachedEvidenceAt },
  });
});

test('route and weather readers return misses for expired and unavailable snapshots without fetching', async () => {
  const request = {
    origin: { latitude: 1, longitude: 2 },
    destination: { latitude: 2, longitude: 3 },
    mode: 'walk' as const,
  };
  expect((await readCachedRoute(request, NOW)).kind).toBe('miss');
  route = {
    fetchedAt: new Date(NOW.getTime() - 30 * DAY),
    distanceMeters: 1000,
    durationSeconds: 600,
    encodedPolyline: null,
  };
  expect((await readCachedRoute(request, NOW)).kind).toBe('miss');
  route.fetchedAt = new Date(NOW.getTime() - 2 * DAY);
  expect((await readCachedRoute(request, NOW)).kind).toBe('hit');
  const point = { latitude: 1, longitude: 2, timeZone: 'UTC' };
  const window = { startDate: '2026-09-28', endDate: '2026-09-28' };
  expect((await readCachedForecast(point, window, NOW)).kind).toBe('miss');
  forecast = {
    fetchedAt: new Date(NOW.getTime() - 3 * 3600000),
    latitude: 1,
    longitude: 2,
    timeZone: 'UTC',
    days: [
      {
        date: new Date('2026-09-28'),
        temperatureMaxCelsius: 30,
        temperatureMinCelsius: 20,
        precipitationProbability: 10,
        weatherCode: 0,
      },
    ],
  };
  expect((await readCachedForecast(point, window, NOW)).kind).toBe('miss');
  forecast.fetchedAt = NOW;
  expect((await readCachedForecast(point, window, NOW)).kind).toBe('hit');
  expect(outbound).not.toHaveBeenCalled();
});

test('concurrent acquisition is coalesced, then released after failure for a normal retry', async () => {
  let reject!: (error: Error) => void;
  const acquire = vi.fn(
    () =>
      new Promise<never>((_resolve, onReject) => {
        reject = onReject;
      }),
  );
  const a = singleFlight('test-request', acquire),
    b = singleFlight('test-request', acquire);
  expect(acquire).toHaveBeenCalledTimes(1);
  reject(new Error('provider failed'));
  await Promise.allSettled([a, b]);
  expect(await singleFlight('test-request', async () => 'retried')).toBe('retried');
});

test('expired raw place evidence is removed by maintenance without acquiring replacements', async () => {
  const write = (globalThis as any).trovePrismaClient.placeProviderRef.updateMany;
  await expect(cleanupProviderEvidence(NOW)).resolves.toMatchObject({ clearedPlaceEvidence: 1 });
  expect(write.mock.calls[0][0].where.cachedEvidenceAt.lte).toEqual(
    new Date(NOW.getTime() - 30 * DAY),
  );
  expect(write.mock.calls[0][0].data.cachedEvidenceAt).toBeNull();
  expect(outbound).not.toHaveBeenCalled();
});

test('scoring readers cannot import provider factories or refresh-on-miss cache services', async () => {
  for (const name of [
    'plan-score',
    'ai-draft-score-reader',
    'plan-score-evaluation',
    'plan-score-normalization',
    'plan-score-rules',
    'scoring-evidence',
    'itinerary-route-reader',
    'place-evidence-cache',
    'route-evidence-cache',
    'weather-evidence-cache',
  ]) {
    const source = await readFile(new URL(`../src/services/${name}.ts`, import.meta.url), 'utf8');
    expect(source).not.toMatch(
      /from ['"].*(?:places-runtime|routes-runtime|cached-places|cached-routes|cached-weather)['"]/,
    );
  }
});

test('repeated places and coordinates across days are read once from existing caches', async () => {
  trip.itineraryDays.push({
    ...trip.itineraryDays[0],
    id: 'day-two',
    date: new Date('2026-09-29'),
  });
  evidenceRow.cachedEvidence = {
    ...place,
    location: { latitude: 1.35, longitude: 103.82 },
    rawTypes: ['park'],
  };
  const prisma = (globalThis as any).trovePrismaClient;
  await getTripPlanScore('owner', 'trip', { now: () => NOW });
  expect(prisma.placeProviderRef.findUnique).toHaveBeenCalledTimes(1);
  expect(prisma.weatherForecastSnapshot.findUnique).toHaveBeenCalledTimes(1);
  expect(outbound).not.toHaveBeenCalled();
});

test('thin rich evidence preserves independently cached coordinates, types and both original ages', async () => {
  const { mergeScoringPlaceIdentity } = await import('../src/services/plan-score.js');
  const row = trip.tripPlaces[0].place;
  row.providerRefs[0].cachedTypes = ['museum'];
  const richAt = new Date(NOW.getTime() - 2 * DAY).toISOString();
  const merged = mergeScoringPlaceIdentity(
    'tp',
    row,
    {
      tripPlaceId: 'tp',
      coordinates: null,
      types: [],
      name: '',
      rating: { status: 'KNOWN', rating: 4.7, reviewCount: 1000, source: 'CACHED_PROVIDER' },
      fieldEvidence: {
        identity: {
          acquiredAt: richAt,
          expiresAt: new Date(Date.parse(richAt) + 30 * DAY).toISOString(),
        },
        rating: {
          acquiredAt: richAt,
          expiresAt: new Date(Date.parse(richAt) + 30 * DAY).toISOString(),
        },
      },
    },
    NOW,
  );
  expect(merged.place.coordinates).toEqual({ latitude: 1, longitude: 2 });
  expect(merged.place.types).toEqual(['museum']);
  expect(merged.place.fieldEvidence?.identity?.acquiredAt).toBe(NOW.toISOString());
  expect(merged.place.fieldEvidence?.rating?.acquiredAt).toBe(richAt);
  expect(outbound).not.toHaveBeenCalled();
});

test('local recheck after a day reuses valid provider evidence without renewing its age', async () => {
  const first = await getTripPlanScore('owner', 'trip', { now: () => NOW });
  const acquiredAt = evidenceRow.cachedEvidenceAt;
  const second = await getTripPlanScore('owner', 'trip', {
    now: () => new Date(NOW.getTime() + DAY),
  });
  expect(second?.generatedAt).toBe(new Date(NOW.getTime() + DAY).toISOString());
  expect(second?.evidenceAsOf).toBe(first?.evidenceAsOf);
  expect(evidenceRow.cachedEvidenceAt).toBe(acquiredAt);
  expect(second?.evidenceExpiresAt).toBe(first?.evidenceExpiresAt);
  expect(outbound).not.toHaveBeenCalled();
});

test('re-enabling evaluates the same existing trip and rejects legacy payloads without acquisition', async () => {
  vi.stubEnv('TROVE_PLAN_SCORE_DISABLED', 'true');
  expect(await getTripPlanScore('owner', 'trip', { now: () => NOW })).toBeNull();
  vi.stubEnv('TROVE_PLAN_SCORE_DISABLED', 'false');
  const first = await getTripPlanScore('owner', 'trip', { now: () => NOW });
  expect(first?.schemaVersion).toBe(7);
  trip.planScore = { ...first, schemaVersion: 6, rubricVersion: 6 };
  const second = await getTripPlanScore('owner', 'trip', { now: () => NOW });
  expect(second?.schemaVersion).toBe(7);
  expect(update).toHaveBeenCalledTimes(2);
  expect(outbound).not.toHaveBeenCalled();
});

test('newer thin rich snapshots do not renew older coordinate and type evidence', async () => {
  const { mergeScoringPlaceIdentity } = await import('../src/services/plan-score.js');
  const row = trip.tripPlaces[0].place;
  row.providerRefs[0].cachedAt = new Date(NOW.getTime() - 5 * DAY);
  row.providerRefs[0].cachedTypes = ['museum'];
  const stamp = {
    acquiredAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 30 * DAY).toISOString(),
  };
  const merged = mergeScoringPlaceIdentity(
    'tp',
    row,
    {
      tripPlaceId: 'tp',
      coordinates: null,
      types: [],
      rating: { status: 'UNKNOWN' },
      fieldEvidence: { identity: stamp },
    },
    NOW,
  );
  expect(merged.place.fieldEvidence?.coordinates?.acquiredAt).toBe(
    row.providerRefs[0].cachedAt.toISOString(),
  );
  expect(merged.place.fieldEvidence?.types?.expiresAt).toBe(
    new Date(NOW.getTime() + 25 * DAY).toISOString(),
  );
  expect(merged.place.coordinates).toEqual({ latitude: 1, longitude: 2 });
});

test('date-specific hours expire at their local boundary while regular hours keep their acquisition age', async () => {
  const { loadPlaceEvidence, placeHoursDeadlines } = await import('../src/services/plan-score.js');
  evidenceRow.cachedEvidence = {
    ...place,
    location: { latitude: 1.35, longitude: 103.82 },
    currentOpeningPeriods: [
      { open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 18, minute: 0 } },
    ],
    currentHoursValidFrom: '2026-09-28',
    currentHoursValidThrough: '2026-09-28',
  };
  const before = await loadPlaceEvidence([{ id: 'tp', externalPlaceId: 'venue' }], NOW);
  expect(
    placeHoursDeadlines(before.hours, [{ date: '2026-09-28', items: [{ tripPlaceId: 'tp' }] }]),
  ).toEqual(['2026-09-28T16:00:00.000Z']);
  const after = await loadPlaceEvidence(
    [{ id: 'tp', externalPlaceId: 'venue' }],
    new Date('2026-09-28T16:00Z'),
  );
  expect(after.hours.get('tp')?.currentPeriods).toBeUndefined();
  expect(after.hours.get('tp')?.fetchedAt).toBe(before.hours.get('tp')?.fetchedAt);
  expect(outbound).not.toHaveBeenCalled();
});

test('thin rich hours expire using the independently retained location timezone', async () => {
  evidenceRow.cachedEvidence = {
    ...place,
    currentOpeningPeriods: [],
    currentHoursValidFrom: '2026-09-28',
    currentHoursValidThrough: '2026-09-28',
  };
  Object.assign(trip.tripPlaces[0].place.providerRefs[0], {
    cachedLatitude: decimal(1.35),
    cachedLongitude: decimal(103.82),
  });
  trip.itineraryDays[0].defaultTimeZone = 'Asia/Singapore';
  trip.itineraryDays[0].items[0].timeZone = 'Asia/Singapore';
  const before = await getTripPlanScore('owner', 'trip', { now: () => NOW });
  expect(before?.evidenceExpiresAt).toBe('2026-09-28T16:00:00.000Z');
  const after = await getTripPlanScore('owner', 'trip', {
    now: () => new Date('2026-09-28T16:00:00Z'),
  });
  expect(after?.recomputeAfter).toBe('2026-09-29T16:00:00.000Z');
  expect(after?.evidenceAsOf).toBe(before?.evidenceAsOf);
  expect(outbound).not.toHaveBeenCalled();
});

test('a trip’s place hours and ratings are read from stored evidence, never acquired', async () => {
  const { getTripPlaceHours } = await import('../src/services/trip-place-hours.js');
  evidenceRow.cachedEvidence = {
    ...place,
    location: { latitude: 1.35, longitude: 103.82 },
    openingPeriods: [
      { open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 18, minute: 0 } },
    ],
  };

  const monday = await getTripPlaceHours('owner', 'trip', '2026-09-28', { now: NOW });
  expect(monday.places.tp).toMatchObject({
    hours: { spans: [{ close: '18:00', open: '09:00' }], status: 'open' },
    rating: { reviewCount: 1000, value: 4.7 },
  });

  const tuesday = await getTripPlaceHours('owner', 'trip', '2026-09-29', { now: NOW });
  expect(tuesday.places.tp?.hours).toMatchObject({ status: 'closed' });

  // With no date, only the rating is offered.
  const undated = await getTripPlaceHours('owner', 'trip', null, { now: NOW });
  expect(undated.places.tp).toStrictEqual({ rating: { reviewCount: 1000, value: 4.7 } });

  // Expired evidence is absent, not refreshed.
  const expired = await getTripPlaceHours('owner', 'trip', '2026-09-28', {
    now: new Date(NOW.getTime() + 40 * DAY),
  });
  expect(expired.places).toStrictEqual({});
  expect(outbound).not.toHaveBeenCalled();
});
