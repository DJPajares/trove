import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';

import { CachedPlacesService, resetCachedPlacesMemo } from '../src/services/cached-places.js';
import { CachedRoutesService } from '../src/services/cached-routes.js';
import { createPlaceResolver } from '../src/services/itinerary-routes.js';
import { areGoogleProvidersDisabled, getPlacesEnvironment } from '../src/environment.js';
import {
  GOOGLE_PLACE_DETAILS_FIELD_MASK,
  GOOGLE_PLACE_EVIDENCE_FIELD_MASK,
  GOOGLE_PLACE_LOCATION_FIELD_MASK,
  GooglePlacesProvider,
} from '../src/services/google-places.js';
import type { PlacesProvider, ProviderPlaceDetails } from '../src/services/places.js';
import { getTripPlanScore } from '../src/services/plan-score.js';
import {
  getProviderCallCounts,
  recordProviderCall,
  resetProviderCallCounts,
} from '../src/services/provider-usage.js';
import type { RouteEstimate, RouteRequest, RoutesProvider } from '../src/services/routes.js';
import { resolveTripModeContext } from '../src/services/trip-mode-context.js';

/**
 * These tests exist because nothing else in the suite can fail when a code path
 * starts costing money. They assert call counts, not behaviour, so a
 * reintroduced fan-out shows up here rather than on a bill.
 */

const DAY_MS = 24 * 60 * 60 * 1_000;

type ProviderRefRow = {
  cachedAt: Date | null;
  cachedFormattedAddress: string | null;
  cachedGoogleMapsUri: string | null;
  cachedLanguageCode: string | null;
  cachedLatitude: { toNumber: () => number } | null;
  cachedLongitude: { toNumber: () => number } | null;
  cachedName: string | null;
  cachedPrimaryType: string | null;
  cachedTypes: string[];
  cachedUtcOffsetMinutes: number | null;
  externalPlaceId: string;
};

type LegRow = {
  distanceMeters: number;
  durationSeconds: number;
  encodedPolyline: string | null;
  fetchedAt: Date;
  key: string;
};

const providerRefs = new Map<string, ProviderRefRow>();
const legs = new Map<string, LegRow>();
let tripFixture: unknown = null;
let dayFixture: unknown = null;

function decimal(value: number) {
  return { toNumber: () => value };
}

function legKeyOf(where: Record<string, unknown>) {
  return JSON.stringify(where);
}

function installStubPrisma() {
  (globalThis as { trovePrismaClient?: unknown }).trovePrismaClient = {
    placeProviderRef: {
      findUnique: async (args: {
        where: { provider_externalPlaceId: { externalPlaceId: string } };
      }) => providerRefs.get(args.where.provider_externalPlaceId.externalPlaceId) ?? null,
      updateMany: async (args: {
        data: Record<string, unknown>;
        where: { externalPlaceId: string };
      }) => {
        const existing = providerRefs.get(args.where.externalPlaceId);
        if (!existing) return { count: 0 };
        Object.assign(existing, args.data, {
          cachedLatitude: decimal(args.data.cachedLatitude as number),
          cachedLongitude: decimal(args.data.cachedLongitude as number),
        });
        return { count: 1 };
      },
    },
    travelLegCache: {
      findUnique: async (args: { where: { travel_leg_cache_leg: Record<string, unknown> } }) =>
        legs.get(legKeyOf(args.where.travel_leg_cache_leg)) ?? null,
      upsert: async (args: {
        create: Record<string, unknown>;
        update: Record<string, unknown>;
        where: { travel_leg_cache_leg: Record<string, unknown> };
      }) => {
        const key = legKeyOf(args.where.travel_leg_cache_leg);
        legs.set(key, { ...(args.create as unknown as LegRow), key });
        return legs.get(key);
      },
    },
    trip: {
      // Plan Score's own query and the day-routes query it fans out to both call
      // `trip.findFirst` with different `where`/`include` shapes; the fixture
      // below carries every field either caller reads, so one stub answers both.
      findFirst: async () => tripFixture,
    },
    itineraryDay: {
      findFirst: async () => dayFixture,
    },
  };
}

/**
 * A trip with one scheduled Trip Place and one saved-but-unscheduled Trip Place,
 * both pointing at real Google places. Exercises `getTripPlanScore`'s own
 * provider fan-out end to end (not just the pure `buildTripPlanScore` scorer
 * that `plan-score.test.ts` covers).
 */
function buildPlanScoreTripFixture() {
  const place = (id: string, externalPlaceId: string) => ({
    customLatitude: null,
    customLongitude: null,
    customName: null,
    id,
    providerRefs: [{ externalPlaceId, provider: 'GOOGLE' }],
  });

  const scheduledTripPlace = {
    id: 'tp-scheduled',
    place: place('place-scheduled', 'ChIJscheduled'),
    priority: null,
  };
  const unscheduledTripPlace = {
    id: 'tp-unscheduled',
    place: place('place-unscheduled', 'ChIJunscheduled'),
    priority: null,
  };
  const day = {
    accommodationReservations: [],
    dailyBaseDepartureTripPlace: null,
    dailyBaseTripPlace: null,
    date: new Date('2026-09-01T00:00:00.000Z'),
    defaultTimeZone: 'UTC',
    id: 'day-1',
    items: [
      {
        _count: { reservations: 0 },
        dayPart: null,
        durationMinutes: 60,
        id: 'item-1',
        localStartTime: null,
        position: 0,
        startInstant: null,
        timeSemantics: null,
        timeZone: null,
        travelModeToNext: 'WALK',
        tripPlace: scheduledTripPlace,
        tripPlaceId: 'tp-scheduled',
      },
    ],
    routeStartTravelMode: 'WALK',
  };

  return {
    id: 'trip-1',
    itineraryDays: [day],
    ownerId: 'user-1',
    reservations: [],
    startDate: new Date('2026-09-01T00:00:00.000Z'),
    startingPlace: null,
    tripPlaces: [scheduledTripPlace, unscheduledTripPlace],
  };
}

/** Like `countingPlacesProvider`, but keeps what each call actually asked for. */
function detailRequestsProvider() {
  const requests: Array<{ detail: string | undefined; externalPlaceId: string }> = [];
  const provider: PlacesProvider = {
    name: 'google',
    getDetails: async (request) => {
      requests.push({ detail: request.detail, externalPlaceId: request.externalPlaceId });
      recordProviderCall({ endpoint: '/v1/places', operation: 'getDetails', provider: 'google' });
      return detailsFor(request.externalPlaceId);
    },
    resolvePhoto: async () => ({ name: 'photo', uri: 'https://example.test/photo' }),
    search: async () => [],
  };

  return { provider, requests };
}

function seedProviderRef(externalPlaceId: string, overrides: Partial<ProviderRefRow> = {}) {
  providerRefs.set(externalPlaceId, {
    cachedAt: null,
    cachedFormattedAddress: null,
    cachedGoogleMapsUri: null,
    cachedLanguageCode: null,
    cachedLatitude: null,
    cachedLongitude: null,
    cachedName: null,
    cachedPrimaryType: null,
    cachedTypes: [],
    cachedUtcOffsetMinutes: null,
    externalPlaceId,
    ...overrides,
  });
}

function detailsFor(externalPlaceId: string): ProviderPlaceDetails {
  return {
    category: 'things_to_do',
    externalPlaceId,
    formattedAddress: '93 Stamford Rd, Singapore',
    googleMapsUri: 'https://maps.google.com/?cid=1',
    location: { latitude: 1.2966, longitude: 103.8485 },
    name: 'National Museum',
    nationalPhoneNumber: null,
    openingPeriods: [],
    photos: [],
    primaryType: 'museum',
    provider: 'google',
    rating: 4.5,
    rawTypes: ['museum'],
    regularOpeningHours: [],
    userRatingCount: 100,
    utcOffsetMinutes: 480,
    websiteUri: null,
  };
}

function countingPlacesProvider() {
  let calls = 0;
  const provider: PlacesProvider = {
    name: 'google',
    getDetails: async (request) => {
      calls += 1;
      recordProviderCall({ endpoint: '/v1/places', operation: 'getDetails', provider: 'google' });
      return detailsFor(request.externalPlaceId);
    },
    resolvePhoto: async () => ({ name: 'photo', uri: 'https://example.test/photo' }),
    search: async () => [],
  };

  return { provider, calls: () => calls };
}

function countingRoutesProvider() {
  let calls = 0;
  const provider: RoutesProvider = {
    name: 'google',
    computeRoute: async (request: RouteRequest): Promise<RouteEstimate> => {
      calls += 1;
      return {
        distanceMeters: 1_200,
        durationSeconds: 600,
        encodedPolyline: request.includePolyline ? 'abc' : null,
      };
    },
  };

  return { provider, calls: () => calls };
}

beforeEach(() => {
  providerRefs.clear();
  legs.clear();
  tripFixture = null;
  dayFixture = null;
  resetCachedPlacesMemo();
  resetProviderCallCounts();
  installStubPrisma();
});

/**
 * A trip with two scheduled items back to back, both pointing at real Google
 * places, so `resolveTripModeContext`'s `leaveBy` computation has a real
 * "current item" and "next item" to route between.
 */
function buildTripModeContextFixture() {
  const place = (id: string, externalPlaceId: string) => ({
    customLatitude: null,
    customLongitude: null,
    customName: null,
    customNote: null,
    customTimeZone: null,
    id,
    kind: 'PROVIDER',
    providerAddress: null,
    providerLabel: null,
    providerRefs: [
      { externalPlaceId, provider: 'GOOGLE', updatedAt: new Date('2026-08-01T00:00:00.000Z') },
    ],
  });

  const tripPlace = (id: string, placeId: string, externalPlaceId: string) => ({
    customName: null,
    id,
    note: null,
    place: place(placeId, externalPlaceId),
    priority: null,
  });

  const currentTripPlace = tripPlace('tp-current', 'place-current', 'ChIJcurrent');
  const nextTripPlace = tripPlace('tp-next', 'place-next', 'ChIJnext');
  const dayDate = new Date('2026-09-01T00:00:00.000Z');

  const item = (id: string, startInstant: Date, itemTripPlace: ReturnType<typeof tripPlace>) => ({
    createdAt: dayDate,
    customLabel: null,
    customLocation: null,
    customLocationTimeZone: null,
    dayPart: null,
    durationMinutes: 30,
    id,
    itineraryDayId: 'day-1',
    localStartTime: null,
    notes: null,
    plannedCostAmount: null,
    plannedCostCurrencyCode: null,
    position: 0,
    priority: null,
    startInstant,
    timeSemantics: null,
    timeZone: null,
    timeZoneSource: null,
    travelModeToNext: 'WALK',
    travelStatus: 'UPCOMING',
    tripPlace: itemTripPlace,
    tripPlaceId: itemTripPlace.id,
    updatedAt: dayDate,
  });

  const currentItem = item('item-current', new Date('2026-09-01T09:00:00.000Z'), currentTripPlace);
  const nextItem = item('item-next', new Date('2026-09-01T10:00:00.000Z'), nextTripPlace);

  const day = {
    accommodationReservations: [],
    dailyBaseDepartureTripPlace: null,
    dailyBaseTripPlace: null,
    date: dayDate,
    defaultTimeZone: 'UTC',
    id: 'day-1',
    items: [currentItem, nextItem],
    routeStartTravelMode: 'WALK',
  };

  return {
    currentPlace: currentTripPlace.place,
    day,
    nextPlace: nextTripPlace.place,
    trip: {
      endDate: new Date('2026-09-05T00:00:00.000Z'),
      id: 'trip-1',
      itineraryDays: [day],
      name: 'Test Trip',
      ownerId: 'user-1',
      referenceTimeZone: 'UTC',
      startDate: new Date('2026-08-25T00:00:00.000Z'),
      startingPlace: null,
    },
  };
}

test('the kill switch stops the provider being configured at all', () => {
  const environment = { GOOGLE_PLACES_API_KEY: 'server-key' };

  assert.notEqual(getPlacesEnvironment(environment), null);
  assert.equal(
    getPlacesEnvironment({ ...environment, TROVE_GOOGLE_PROVIDERS_DISABLED: '1' }),
    null,
  );
  assert.equal(
    getPlacesEnvironment({ ...environment, TROVE_GOOGLE_PROVIDERS_DISABLED: 'true' }),
    null,
  );
  assert.equal(areGoogleProvidersDisabled({ TROVE_GOOGLE_PROVIDERS_DISABLED: 'no' }), false);
});

test('a location request asks for coordinates only, not the billable detail', async () => {
  const masks: string[] = [];
  const provider = new GooglePlacesProvider({
    apiKey: 'server-key',
    fetcher: async (_input, init) => {
      masks.push(new Headers(init?.headers).get('X-Goog-FieldMask') ?? '');
      return Response.json({
        displayName: { text: 'National Museum' },
        id: 'ChIJmuseum',
        location: { latitude: 1.2966, longitude: 103.8485 },
      });
    },
  });

  await provider.getDetails({ detail: 'location', externalPlaceId: 'ChIJmuseum' });
  await provider.getDetails({ externalPlaceId: 'ChIJmuseum' });
  await provider.getDetails({ detail: 'evidence', externalPlaceId: 'ChIJmuseum' });

  assert.equal(masks[0], GOOGLE_PLACE_LOCATION_FIELD_MASK);
  assert.equal(masks[1], GOOGLE_PLACE_DETAILS_FIELD_MASK);
  assert.equal(masks[2], GOOGLE_PLACE_EVIDENCE_FIELD_MASK);
  // The expensive fields are exactly what separates the three.
  for (const field of ['rating', 'userRatingCount', 'regularOpeningHours', 'websiteUri']) {
    assert.equal(GOOGLE_PLACE_LOCATION_FIELD_MASK.includes(field), false, field);
    assert.equal(GOOGLE_PLACE_DETAILS_FIELD_MASK.includes(field), true, field);
  }
  // Evidence asks for the mutable fields Plan Score reads, but not the ones
  // that only a place's own sheet renders.
  for (const field of ['rating', 'regularOpeningHours']) {
    assert.equal(GOOGLE_PLACE_EVIDENCE_FIELD_MASK.includes(field), true, field);
  }
  for (const field of ['photos', 'nationalPhoneNumber', 'websiteUri', 'userRatingCount']) {
    assert.equal(GOOGLE_PLACE_EVIDENCE_FIELD_MASK.includes(field), false, field);
  }
});

test('a cached place costs nothing to resolve again', async () => {
  seedProviderRef('ChIJmuseum');
  const { provider, calls } = countingPlacesProvider();
  const service = new CachedPlacesService(provider);

  const first = await service.getDetails({ detail: 'location', externalPlaceId: 'ChIJmuseum' });
  const second = await service.getDetails({ detail: 'location', externalPlaceId: 'ChIJmuseum' });

  assert.equal(calls(), 1);
  assert.equal(first.status, 'ok');
  assert.equal(second.status, 'ok');
  assert.equal(second.status === 'ok' && second.freshness.source, 'cache');
  assert.equal(second.status === 'ok' && second.place.location?.latitude, 1.2966);
  assert.equal(getProviderCallCounts()['google:getDetails'], 1);
});

test('a snapshot past its 30-day life is refetched exactly once', async () => {
  const now = new Date('2026-08-18T00:00:00.000Z');
  seedProviderRef('ChIJmuseum', {
    cachedAt: new Date(now.getTime() - 31 * DAY_MS),
    cachedLatitude: decimal(1.2966),
    cachedLongitude: decimal(103.8485),
    cachedName: 'National Museum',
  });
  const { provider, calls } = countingPlacesProvider();
  const service = new CachedPlacesService(provider, () => now);

  await service.getDetails({ detail: 'location', externalPlaceId: 'ChIJmuseum' });
  assert.equal(calls(), 1);

  await service.getDetails({ detail: 'location', externalPlaceId: 'ChIJmuseum' });
  assert.equal(calls(), 1, 'the refetch should have refreshed the snapshot');
});

test('a snapshot never answers a request in another language', async () => {
  const now = new Date('2026-08-18T00:00:00.000Z');
  seedProviderRef('ChIJmuseum', {
    cachedAt: now,
    cachedLanguageCode: 'en',
    cachedLatitude: decimal(1.2966),
    cachedLongitude: decimal(103.8485),
    cachedName: 'National Museum',
  });
  const { provider, calls } = countingPlacesProvider();
  const service = new CachedPlacesService(provider, () => now);

  await service.getDetails({
    detail: 'location',
    externalPlaceId: 'ChIJmuseum',
    languageCode: 'ja',
  });

  assert.equal(calls(), 1);
});

test("Trip Mode reuses the Itinerary screen's cached snapshot when it forwards the same languageCode", async () => {
  const fixture = buildTripModeContextFixture();
  tripFixture = fixture.trip;
  dayFixture = fixture.day;
  // Both places are already known to Trove (a `PlaceProviderRef` row exists
  // from being saved/scheduled) but have never been resolved yet, so there is
  // nothing cached to reuse until the first resolution below writes into it.
  seedProviderRef('ChIJcurrent');
  seedProviderRef('ChIJnext');

  const { provider: placesProvider, calls: placeCalls } = countingPlacesProvider();
  const placesService = new CachedPlacesService(placesProvider);
  const { provider: routesProvider } = countingRoutesProvider();
  const routesService = new CachedRoutesService(routesProvider);

  // The Itinerary screen resolves both places first, the way
  // `getItineraryDayRoutes` does, caching them under `languageCode: 'en'`.
  const resolveFromItinerary = createPlaceResolver(placesService, 'en');
  await resolveFromItinerary(fixture.currentPlace as never, 'itinerary_item', 'seed-current');
  await resolveFromItinerary(fixture.nextPlace as never, 'itinerary_item', 'seed-next');
  assert.equal(placeCalls(), 2);

  // Trip Mode's context request now forwards the same `languageCode` (the fix
  // for the bug where it silently resolved as `undefined` and thrashed the
  // 30-day snapshot cache against the Itinerary screen's `'en'` entries).
  const context = await resolveTripModeContext(
    'user-1',
    'trip-1',
    { at: new Date('2026-09-01T09:10:00.000Z'), languageCode: 'en' },
    { placesService, routesService },
  );

  assert.equal(
    placeCalls(),
    2,
    'Trip Mode must reuse the DB snapshot the Itinerary screen already cached, not re-fetch it',
  );
  assert.ok(
    context.leaveBy,
    'sanity check: leaveBy should have resolved a route between the items',
  );
});

test('a full request never reads the snapshot, which cannot carry ratings or hours', async () => {
  const now = new Date('2026-08-18T00:00:00.000Z');
  seedProviderRef('ChIJmuseum', {
    cachedAt: now,
    cachedLatitude: decimal(1.2966),
    cachedLongitude: decimal(103.8485),
    cachedName: 'National Museum',
  });
  const { provider, calls } = countingPlacesProvider();
  const service = new CachedPlacesService(provider, () => now);

  const result = await service.getDetails({ externalPlaceId: 'ChIJmuseum' });

  assert.equal(calls(), 1);
  assert.equal(result.status === 'ok' && result.place.rating, 4.5);
  assert.equal(result.status === 'ok' && result.freshness.source, 'live');
});

test('the mutable half of a place is never written to the database', async () => {
  seedProviderRef('ChIJmuseum');
  const service = new CachedPlacesService(countingPlacesProvider().provider);

  await service.getDetails({ externalPlaceId: 'ChIJmuseum' });

  const stored = JSON.stringify(providerRefs.get('ChIJmuseum'));
  for (const forbidden of ['4.5', 'rating', 'openingPeriods', 'userRatingCount']) {
    assert.equal(stored.includes(forbidden), false, forbidden);
  }
});

test('a leg already computed is not computed again', async () => {
  const { provider, calls } = countingRoutesProvider();
  const service = new CachedRoutesService(provider);
  const request: RouteRequest = {
    destination: { latitude: 1.3039, longitude: 103.8318 },
    mode: 'walk',
    origin: { latitude: 1.2966, longitude: 103.8485 },
  };

  const first = await service.computeRoute(request);
  const second = await service.computeRoute(request);

  assert.equal(calls(), 1);
  assert.equal(first.status, 'ok');
  assert.equal(second.status === 'ok' && second.freshness.source, 'cache');
  assert.equal(second.status === 'ok' && second.estimate.durationSeconds, 600);
});

test('a leg cached without a polyline is recomputed when the map needs one', async () => {
  const { provider, calls } = countingRoutesProvider();
  const service = new CachedRoutesService(provider);
  const leg = {
    destination: { latitude: 1.3039, longitude: 103.8318 },
    mode: 'walk' as const,
    origin: { latitude: 1.2966, longitude: 103.8485 },
  };

  await service.computeRoute(leg);
  const withPolyline = await service.computeRoute({ ...leg, includePolyline: true });

  assert.equal(calls(), 2);
  assert.equal(withPolyline.status === 'ok' && withPolyline.estimate.encodedPolyline, 'abc');

  const again = await service.computeRoute({ ...leg, includePolyline: true });
  assert.equal(calls(), 2, 'the richer answer should have replaced the thinner one');
  assert.equal(again.status === 'ok' && again.estimate.encodedPolyline, 'abc');
});

test('a different travel mode over the same leg is its own estimate', async () => {
  const { provider, calls } = countingRoutesProvider();
  const service = new CachedRoutesService(provider);
  const leg = {
    destination: { latitude: 1.3039, longitude: 103.8318 },
    origin: { latitude: 1.2966, longitude: 103.8485 },
  };

  await service.computeRoute({ ...leg, mode: 'walk' });
  await service.computeRoute({ ...leg, mode: 'drive' });

  assert.equal(calls(), 2);
});

test('one resolver shared across days resolves a repeated place once', async () => {
  const { provider, calls } = countingPlacesProvider();
  const service = new CachedPlacesService(provider);
  // Nothing is seeded, so the database cache cannot mask the memo being tested.
  const hotel = {
    customLatitude: null,
    customLongitude: null,
    customName: null,
    id: 'place-hotel',
    providerRefs: [{ externalPlaceId: 'ChIJhotel', provider: 'GOOGLE' }],
  } as unknown as Parameters<ReturnType<typeof createPlaceResolver>>[0];

  const resolvePlace = createPlaceResolver(service);
  // The same hotel is the base on three separate days of the trip.
  const points = await Promise.all([
    resolvePlace(hotel, 'daily_base', 'day-1-base'),
    resolvePlace(hotel, 'daily_base', 'day-2-base'),
    resolvePlace(hotel, 'daily_base', 'day-3-base'),
  ]);

  assert.equal(calls(), 1);
  assert.deepEqual(
    points.map((point) => point?.id),
    ['day-1-base', 'day-2-base', 'day-3-base'],
  );
});

test('a full request and an evidence request for the same place do not share a memo entry', async () => {
  const { provider, calls } = countingPlacesProvider();
  const service = new CachedPlacesService(provider);
  // Nothing is seeded, so the database cache cannot mask the memo being tested.

  await service.getDetails({ detail: 'evidence', externalPlaceId: 'ChIJmuseum' });
  await service.getDetails({ externalPlaceId: 'ChIJmuseum' });

  assert.equal(calls(), 2, 'an evidence hit must not answer a full request from its memo entry');
});

test('a resolver built per day pays for the same place every day', async () => {
  const { provider, calls } = countingPlacesProvider();
  const service = new CachedPlacesService(provider);
  const hotel = {
    customLatitude: null,
    customLongitude: null,
    customName: null,
    id: 'place-hotel',
    providerRefs: [{ externalPlaceId: 'ChIJhotel', provider: 'GOOGLE' }],
  } as unknown as Parameters<ReturnType<typeof createPlaceResolver>>[0];

  // What Plan Score used to do. Kept as a test so the saving above is not
  // mistaken for something the memo would give away for free.
  await Promise.all(
    ['day-1', 'day-2', 'day-3'].map((day) =>
      createPlaceResolver(service)(hotel, 'daily_base', `${day}-base`),
    ),
  );

  assert.equal(calls(), 3);
});

/**
 * `getTripPlanScore` reads its kill switches straight from `process.env`
 * (there is no injectable environment override, unlike `getPlacesEnvironment`),
 * so a test cannot assume either var starts unset - a developer's own `.env`
 * may have `TROVE_PLAN_SCORE_DISABLED` on locally. This snapshots and restores
 * exactly the keys it touches rather than blindly deleting them.
 */
async function withEnvOverride<T>(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const original = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('Plan Score fetches evidence only for scheduled trip places, not every saved one', async () => {
  tripFixture = buildPlanScoreTripFixture();
  const { provider, requests } = detailRequestsProvider();
  const placesService = new CachedPlacesService(provider);

  // Real network calls for routing would need a real Routes API key; disabling
  // the provider keeps this test's routes leg deterministic and offline while
  // leaving the injected `placesService` - the thing under test - untouched.
  // Plan Score itself must be explicitly enabled regardless of the ambient
  // environment, since this test verifies its normal (not disabled) behaviour.
  await withEnvOverride(
    { TROVE_GOOGLE_PROVIDERS_DISABLED: '1', TROVE_PLAN_SCORE_DISABLED: undefined },
    () => getTripPlanScore('user-1', 'trip-1', { placesService }),
  );

  const evidenceRequests = requests.filter((request) => request.detail === 'evidence');
  assert.deepEqual(
    evidenceRequests.map((request) => request.externalPlaceId),
    ['ChIJscheduled'],
    'the unscheduled trip place must never be asked for evidence',
  );
});

test('TROVE_PLAN_SCORE_DISABLED stops every provider call, even with a working service supplied', async () => {
  tripFixture = buildPlanScoreTripFixture();
  const { provider, requests } = detailRequestsProvider();
  const placesService = new CachedPlacesService(provider);

  await withEnvOverride(
    { TROVE_GOOGLE_PROVIDERS_DISABLED: '1', TROVE_PLAN_SCORE_DISABLED: undefined },
    () => getTripPlanScore('user-1', 'trip-1', { placesService }),
  );
  assert.ok(requests.length > 0, 'sanity check: the fixture normally does call the provider');

  requests.length = 0;
  resetCachedPlacesMemo();
  await withEnvOverride(
    { TROVE_GOOGLE_PROVIDERS_DISABLED: '1', TROVE_PLAN_SCORE_DISABLED: '1' },
    () => getTripPlanScore('user-1', 'trip-1', { placesService }),
  );

  assert.equal(
    requests.length,
    0,
    'the injected placesService must never be called while Plan Score is disabled',
  );
});
