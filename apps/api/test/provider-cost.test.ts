import { expect, beforeEach, test } from 'vitest';

import { CachedPlacesService, resetCachedPlacesMemo } from '../src/services/cached-places.js';
import { CachedEditorialImagesService } from '../src/services/cached-editorial-images.js';
import { CachedRoutesService } from '../src/services/cached-routes.js';
import { resetEditorialImageBudget } from '../src/services/editorial-image-budget.js';
import { PexelsEditorialImageProvider } from '../src/services/pexels-editorial-images.js';
import { createPlaceResolver } from '../src/services/itinerary-routes.js';
import {
  hydratePlaceSnapshots,
  isSnapshotFresh,
  MAX_INLINE_PLACE_HYDRATIONS,
  resetFailedPlaceHydrations,
  toPlaceSnapshot,
} from '../src/services/place-data.js';
import { areGoogleProvidersDisabled, getPlacesEnvironment } from '../src/environment.js';
import {
  GOOGLE_PLACE_EVIDENCE_FIELD_MASK,
  GOOGLE_PLACE_LOCATION_FIELD_MASK,
  GooglePlacesProvider,
  PLACE_DETAIL_FIELD_MASKS,
} from '../src/services/google-places.js';
import { GoogleRoutesProvider } from '../src/services/google-routes.js';
import {
  PlaceProviderError,
  type PlacesProvider,
  type ProviderPlaceDetails,
} from '../src/services/places.js';
import { getTripPlanScore } from '../src/services/plan-score.js';
import {
  getProviderCallCounts,
  recordProviderCall,
  resetProviderCallCounts,
  setProviderUsageSink,
  type ProviderUsageEvent,
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
  detailsFailedAt: Date | null;
  detailsFailureCode: string | null;
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
const editorialImages = new Map<
  string,
  { cachedAt: Date | null; id: string; subjectKey: string }
>();
let tripFixture: unknown = null;
let dayFixture: unknown = null;
let tripFindFirstCalls = 0;

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
      findMany: async (args: { where: { externalPlaceId: { in: string[] } } }) =>
        args.where.externalPlaceId.in.flatMap((externalPlaceId) => {
          const row = providerRefs.get(externalPlaceId);
          return row ? [row] : [];
        }),
      updateMany: async (args: {
        data: Record<string, unknown>;
        where: { externalPlaceId: string };
      }) => {
        const existing = providerRefs.get(args.where.externalPlaceId);
        if (!existing) return { count: 0 };
        Object.assign(existing, args.data);
        if (typeof args.data.cachedLatitude === 'number') {
          existing.cachedLatitude = decimal(args.data.cachedLatitude);
        }
        if (typeof args.data.cachedLongitude === 'number') {
          existing.cachedLongitude = decimal(args.data.cachedLongitude);
        }
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
    editorialImage: {
      findMany: async (args: { where: { subjectKey: { in: string[] } } }) =>
        args.where.subjectKey.in.flatMap((subjectKey) => {
          const row = editorialImages.get(subjectKey);
          return row ? [row] : [];
        }),
      upsert: async (args: { update: Record<string, unknown>; where: { subjectKey: string } }) => {
        const row = { ...args.update, id: 'image-1', subjectKey: args.where.subjectKey };
        editorialImages.set(args.where.subjectKey, row as never);
        return { id: 'image-1' };
      },
    },
    place: {
      updateMany: async () => ({ count: 0 }),
    },
    trip: {
      // Plan Score's own query and the day-routes query it fans out to both call
      // `trip.findFirst` with different `where`/`include` shapes; the fixture
      // below carries every field either caller reads, so one stub answers both.
      findFirst: async () => {
        tripFindFirstCalls += 1;
        return tripFixture;
      },
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
      recordProviderCall({
        detailLevel: request.detail,
        endpoint: '/v1/places/:placeId',
        expectedSku:
          request.detail === 'location' ? 'place-details-pro' : 'place-details-enterprise',
        operation: 'getDetails',
        provider: 'google',
        source: 'test',
      });
      return detailsFor(request.externalPlaceId);
    },
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
    detailsFailedAt: null,
    detailsFailureCode: null,
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
    openingPeriods: [],
    primaryType: 'museum',
    provider: 'google',
    rating: 4.5,
    rawTypes: ['museum'],
    utcOffsetMinutes: 480,
  };
}

function countingPlacesProvider() {
  let calls = 0;
  const provider: PlacesProvider = {
    name: 'google',
    getDetails: async (request) => {
      calls += 1;
      recordProviderCall({
        detailLevel: request.detail,
        endpoint: '/v1/places/:placeId',
        expectedSku:
          request.detail === 'location' ? 'place-details-pro' : 'place-details-enterprise',
        operation: 'getDetails',
        provider: 'google',
        source: 'test',
      });
      return detailsFor(request.externalPlaceId);
    },
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
  editorialImages.clear();
  resetEditorialImageBudget();
  tripFixture = null;
  dayFixture = null;
  tripFindFirstCalls = 0;
  resetCachedPlacesMemo();
  resetFailedPlaceHydrations();
  resetProviderCallCounts();
  setProviderUsageSink(null);
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

  expect(getPlacesEnvironment(environment)).not.toBe(null);
  expect(getPlacesEnvironment({ ...environment, TROVE_GOOGLE_PROVIDERS_DISABLED: '1' })).toBe(null);
  expect(getPlacesEnvironment({ ...environment, TROVE_GOOGLE_PROVIDERS_DISABLED: 'true' })).toBe(
    null,
  );
  expect(areGoogleProvidersDisabled({ TROVE_GOOGLE_PROVIDERS_DISABLED: 'no' })).toBe(false);
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
  await provider.getDetails({ detail: 'evidence', externalPlaceId: 'ChIJmuseum' });

  expect(masks[0]).toBe(GOOGLE_PLACE_LOCATION_FIELD_MASK);
  expect(masks[1]).toBe(GOOGLE_PLACE_EVIDENCE_FIELD_MASK);

  // There is no third, more expensive level to reach for by accident. There
  // used to be, and an omitted `detail` fell back to it.
  expect(Object.keys(PLACE_DETAIL_FIELD_MASKS).toSorted()).toStrictEqual(['evidence', 'location']);

  // The expensive fields are exactly what separates the two.
  for (const field of ['rating', 'regularOpeningHours']) {
    expect(GOOGLE_PLACE_LOCATION_FIELD_MASK.includes(field), field).toBe(false);
  }
  // Evidence asks for the mutable fields Plan Score reads, but not the ones
  // that only a place's own sheet renders.
  for (const field of ['rating', 'regularOpeningHours']) {
    expect(GOOGLE_PLACE_EVIDENCE_FIELD_MASK.includes(field), field).toBe(true);
  }
  for (const field of ['photos', 'nationalPhoneNumber', 'websiteUri', 'userRatingCount']) {
    expect(GOOGLE_PLACE_EVIDENCE_FIELD_MASK.includes(field), field).toBe(false);
  }
});

test('a cached place costs nothing to resolve again', async () => {
  seedProviderRef('ChIJmuseum');
  const { provider, calls } = countingPlacesProvider();
  const service = new CachedPlacesService(provider);

  const first = await service.getDetails({ detail: 'location', externalPlaceId: 'ChIJmuseum' });
  const second = await service.getDetails({ detail: 'location', externalPlaceId: 'ChIJmuseum' });

  expect(calls()).toBe(1);
  expect(first.status).toBe('ok');
  expect(second.status).toBe('ok');
  expect(second.status === 'ok' && second.freshness.source).toBe('cache');
  expect(second.status === 'ok' && second.place.location?.latitude).toBe(1.2966);
  expect(getProviderCallCounts()['google:getDetails']).toBe(1);
});

test('a canonicalised Google response is cached against the Place id Trove requested', async () => {
  seedProviderRef('address-only-id');
  let calls = 0;
  const provider: PlacesProvider = {
    name: 'google',
    getDetails: async () => {
      calls += 1;
      return detailsFor('canonical-response-id');
    },
    search: async () => [],
  };
  const service = new CachedPlacesService(provider);

  await service.getDetails({ detail: 'location', externalPlaceId: 'address-only-id' });
  const second = await new CachedPlacesService(provider).getDetails({
    detail: 'location',
    externalPlaceId: 'address-only-id',
  });

  expect(calls).toBe(1);
  expect(providerRefs.get('address-only-id')?.cachedName).toBe('National Museum');
  expect(second.status === 'ok' && second.freshness.source).toBe('cache');
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
  expect(calls()).toBe(1);

  await service.getDetails({ detail: 'location', externalPlaceId: 'ChIJmuseum' });
  expect(calls(), 'the refetch should have refreshed the snapshot').toBe(1);
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

  expect(calls()).toBe(1);
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
  expect(placeCalls()).toBe(2);

  // Trip Mode's context request now forwards the same `languageCode` (the fix
  // for the bug where it silently resolved as `undefined` and thrashed the
  // 30-day snapshot cache against the Itinerary screen's `'en'` entries).
  const context = await resolveTripModeContext(
    'user-1',
    'trip-1',
    { at: new Date('2026-09-01T09:10:00.000Z'), languageCode: 'en' },
    { placesService, routesService },
  );

  expect(
    placeCalls(),
    'Trip Mode must reuse the DB snapshot the Itinerary screen already cached, not re-fetch it',
  ).toBe(2);
  expect(
    context.leaveBy,
    'sanity check: leaveBy should have resolved a route between the items',
  ).toBeTruthy();
});

test('an evidence request never reads the snapshot, which cannot carry ratings or hours', async () => {
  const now = new Date('2026-08-18T00:00:00.000Z');
  seedProviderRef('ChIJmuseum', {
    cachedAt: now,
    cachedLatitude: decimal(1.2966),
    cachedLongitude: decimal(103.8485),
    cachedName: 'National Museum',
  });
  const { provider, calls } = countingPlacesProvider();
  const service = new CachedPlacesService(provider, () => now);

  const result = await service.getDetails({ detail: 'evidence', externalPlaceId: 'ChIJmuseum' });

  expect(calls()).toBe(1);
  expect(result.status === 'ok' && result.place.rating).toBe(4.5);
  expect(result.status === 'ok' && result.freshness.source).toBe('live');
});

test('the mutable half of a place is never written to the database', async () => {
  seedProviderRef('ChIJmuseum');
  const service = new CachedPlacesService(countingPlacesProvider().provider);

  await service.getDetails({ detail: 'evidence', externalPlaceId: 'ChIJmuseum' });

  const stored = JSON.stringify(providerRefs.get('ChIJmuseum'));
  for (const forbidden of ['4.5', 'rating', 'openingPeriods', 'userRatingCount']) {
    expect(stored.includes(forbidden), forbidden).toBe(false);
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

  expect(calls()).toBe(1);
  expect(first.status).toBe('ok');
  expect(second.status === 'ok' && second.freshness.source).toBe('cache');
  expect(second.status === 'ok' && second.estimate.durationSeconds).toBe(600);
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

  expect(calls()).toBe(2);
  expect(withPolyline.status === 'ok' && withPolyline.estimate.encodedPolyline).toBe('abc');

  const again = await service.computeRoute({ ...leg, includePolyline: true });
  expect(calls(), 'the richer answer should have replaced the thinner one').toBe(2);
  expect(again.status === 'ok' && again.estimate.encodedPolyline).toBe('abc');
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

  expect(calls()).toBe(2);
});

test('one resolver shared across days resolves a repeated place once', async () => {
  const { provider, calls } = countingPlacesProvider();
  const service = new CachedPlacesService(provider);
  // The reference exists but has never been resolved, so the first day has
  // something real to pay for and the rest have something to reuse.
  seedProviderRef('ChIJhotel');
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

  expect(calls()).toBe(1);
  expect(points.map((point) => point?.id)).toStrictEqual([
    'day-1-base',
    'day-2-base',
    'day-3-base',
  ]);
});

test('a day is routed from stored coordinates, even with no provider at all', async () => {
  const now = new Date('2026-08-18T00:00:00.000Z');
  seedFreshRef('ChIJhotel', now);
  const hotel = {
    customLatitude: null,
    customLongitude: null,
    customName: null,
    id: 'place-hotel',
    providerRefs: [{ ...providerRefs.get('ChIJhotel'), provider: 'GOOGLE' }],
  } as unknown as Parameters<ReturnType<typeof createPlaceResolver>>[0];

  // `null` is the kill switch and a missing key. Routing used to give up here
  // and report a day it could not measure, even though Trove held the exact
  // coordinates the leg needed.
  const point = await createPlaceResolver(null)(hotel, 'daily_base', 'day-1-base');

  expect(point?.coordinates.latitude).toBe(1.2966);
  expect(point?.label).toBe('National Museum');
  expect(getProviderCallCounts()['google:getDetails']).toBe(undefined);
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
  expect(
    evidenceRequests.map((request) => request.externalPlaceId),
    'the unscheduled trip place must never be asked for evidence',
  ).toStrictEqual(['ChIJscheduled']);
});

test('TROVE_PLAN_SCORE_DISABLED stops every provider call, even with a working service supplied', async () => {
  tripFixture = buildPlanScoreTripFixture();
  const { provider, requests } = detailRequestsProvider();
  const placesService = new CachedPlacesService(provider);

  await withEnvOverride(
    { TROVE_GOOGLE_PROVIDERS_DISABLED: '1', TROVE_PLAN_SCORE_DISABLED: undefined },
    () => getTripPlanScore('user-1', 'trip-1', { placesService }),
  );
  expect(
    requests.length > 0,
    'sanity check: the fixture normally does call the provider',
  ).toBeTruthy();

  requests.length = 0;
  resetCachedPlacesMemo();
  const tripFindFirstCallsBeforeDisabled = tripFindFirstCalls;
  const disabled = await withEnvOverride(
    { TROVE_GOOGLE_PROVIDERS_DISABLED: '1', TROVE_PLAN_SCORE_DISABLED: '1' },
    () => getTripPlanScore('user-1', 'trip-1', { placesService }),
  );

  expect(disabled, 'the kill switch must stop before trip lookup or scoring').toBe(null);
  expect(tripFindFirstCalls, 'the kill switch must stop before the trip query').toBe(
    tripFindFirstCallsBeforeDisabled,
  );
  expect(
    requests.length,
    'the injected placesService must never be called while Plan Score is disabled',
  ).toBe(0);
});

/**
 * The tests below are the ones that hold the DB-first architecture in place.
 * They assert what *navigation* costs, which is the number that produced the
 * bill this work exists to remove.
 */

function seedFreshRef(externalPlaceId: string, now: Date, languageCode = 'en') {
  seedProviderRef(externalPlaceId, {
    cachedAt: now,
    cachedFormattedAddress: '93 Stamford Rd, Singapore',
    cachedLanguageCode: languageCode,
    cachedLatitude: decimal(1.2966),
    cachedLongitude: decimal(103.8485),
    cachedName: 'National Museum',
    cachedPrimaryType: 'museum',
    cachedTypes: ['museum'],
  });
}

test('a screen rendered from snapshots the database already holds costs nothing', async () => {
  const now = new Date('2026-08-18T00:00:00.000Z');
  const ids = Array.from({ length: 30 }, (_, index) => `ChIJplace-${index}`);
  for (const id of ids) seedFreshRef(id, now);

  const { provider, calls } = countingPlacesProvider();
  const resolved = await hydratePlaceSnapshots(ids, {
    now,
    placesService: new CachedPlacesService(provider, () => now),
  });

  expect(calls()).toBe(0);
  expect(resolved.size).toBe(30);
  expect(toPlaceSnapshot(resolved.get('ChIJplace-0'), now)?.name).toBe('National Museum');
});

test('a place still renders when the provider is gone', async () => {
  const now = new Date('2026-08-18T00:00:00.000Z');
  // Well past the 30-day ceiling, so this would refresh if it could.
  seedProviderRef('ChIJmuseum', {
    cachedAt: new Date(now.getTime() - 90 * DAY_MS),
    cachedLanguageCode: 'en',
    cachedLatitude: decimal(1.2966),
    cachedLongitude: decimal(103.8485),
    cachedName: 'National Museum',
  });

  // `null` is what the kill switch and a missing key both produce.
  const resolved = await hydratePlaceSnapshots(['ChIJmuseum'], { now, placesService: null });
  const snapshot = toPlaceSnapshot(resolved.get('ChIJmuseum'), now);

  expect(getProviderCallCounts()['google:getDetails']).toBe(undefined);
  expect(snapshot?.name).toBe('National Museum');
  expect(snapshot?.stale, 'stale data must say so rather than pass as current').toBe(true);
});

test('a backlog of stale snapshots is bounded per request and drains over the next', async () => {
  const now = new Date('2026-08-18T00:00:00.000Z');
  const ids = Array.from({ length: 40 }, (_, index) => `ChIJstale-${index}`);
  for (const id of ids) {
    seedProviderRef(id, {
      cachedAt: new Date(now.getTime() - 31 * DAY_MS),
      cachedLanguageCode: 'en',
      cachedLatitude: decimal(1.2966),
      cachedLongitude: decimal(103.8485),
      cachedName: 'National Museum',
    });
  }

  const { provider, calls } = countingPlacesProvider();
  const service = new CachedPlacesService(provider, () => now);

  const first = await hydratePlaceSnapshots(ids, { now, placesService: service });
  expect(calls()).toBe(MAX_INLINE_PLACE_HYDRATIONS);
  expect(
    [...first.values()].filter((reference) => !toPlaceSnapshot(reference, now)?.stale).length,
  ).toBe(MAX_INLINE_PLACE_HYDRATIONS);

  await hydratePlaceSnapshots(ids, { now, placesService: service });
  expect(calls(), 'the remainder should refresh on the next request, not be dropped').toBe(40);

  await hydratePlaceSnapshots(ids, { now, placesService: service });
  expect(calls(), 'and then cost nothing at all').toBe(40);
});

test('a caller that names no language reads the snapshot one that named `en` wrote', async () => {
  const now = new Date('2026-08-18T00:00:00.000Z');
  seedProviderRef('ChIJmuseum');
  const { provider, calls } = countingPlacesProvider();
  const service = new CachedPlacesService(provider, () => now);

  // The itinerary and Trip Mode forward the locale; Plan Score and time
  // suggestions historically did not. Both must land on the same snapshot.
  await service.getDetails({
    detail: 'location',
    externalPlaceId: 'ChIJmuseum',
    languageCode: 'en',
  });
  await service.getDetails({ detail: 'location', externalPlaceId: 'ChIJmuseum' });
  await service.getDetails({
    detail: 'location',
    externalPlaceId: 'ChIJmuseum',
    languageCode: 'EN',
  });

  expect(calls()).toBe(1);
});

test('Plan Score and the day routes no longer take turns re-billing the same place', async () => {
  const now = new Date('2026-08-18T00:00:00.000Z');
  seedProviderRef('ChIJmuseum');
  const { provider, calls } = countingPlacesProvider();
  const service = new CachedPlacesService(provider, () => now);

  // Plan Score builds its resolver without a language; the day-routes controller
  // forwards one. Before the language chokepoint this cost two calls forever.
  const planScoreResolver = createPlaceResolver(service);
  const dayRoutesResolver = createPlaceResolver(service, 'en');
  const place = {
    customLatitude: null,
    customLongitude: null,
    customName: null,
    id: 'place-1',
    providerRefs: [{ externalPlaceId: 'ChIJmuseum', provider: 'GOOGLE' }],
  } as unknown as Parameters<ReturnType<typeof createPlaceResolver>>[0];

  await planScoreResolver(place, 'daily_base', 'day-1-base');
  await dayRoutesResolver(place, 'daily_base', 'day-1-base');

  expect(calls()).toBe(1);
});

test('an evidence request never writes the location snapshot', async () => {
  const now = new Date('2026-08-18T00:00:00.000Z');
  seedProviderRef('ChIJmuseum');

  // Rating and opening hours are mutable provider data and may not be stored at
  // any TTL (PRD 11.4). Two things keep them out of the database, and this pins
  // both: the evidence field mask asks for no location, and the snapshot write
  // refuses a place that has none. The provider here answers the way that mask
  // actually makes Google answer.
  expect(GOOGLE_PLACE_EVIDENCE_FIELD_MASK.includes('location')).toBe(false);

  const provider: PlacesProvider = {
    name: 'google',
    getDetails: async (request) => ({
      ...detailsFor(request.externalPlaceId),
      location: request.detail === 'evidence' ? null : { latitude: 1.2966, longitude: 103.8485 },
    }),
    search: async () => [],
  };
  const service = new CachedPlacesService(provider, () => now);

  await service.getDetails({ detail: 'evidence', externalPlaceId: 'ChIJmuseum' });

  expect(providerRefs.get('ChIJmuseum')?.cachedName).toBe(null);
  expect(providerRefs.get('ChIJmuseum')?.cachedAt).toBe(null);
  expect(isSnapshotFresh(providerRefs.get('ChIJmuseum')!, { now })).toBe(false);
});

test('a durable Place miss survives new service instances and retries after 30 days', async () => {
  const now = new Date('2026-08-18T00:00:00.000Z');
  // A geocoded-address reference is the real case: it exists, it is on a trip,
  // and Google will not return details for it however many times we ask.
  seedProviderRef('ChIJunresolvable');

  let calls = 0;
  let succeeds = false;
  const provider: PlacesProvider = {
    name: 'google',
    getDetails: async (request) => {
      calls += 1;
      recordProviderCall({
        detailLevel: request.detail,
        endpoint: '/v1/places/:placeId',
        expectedSku: 'place-details-pro',
        operation: 'getDetails',
        provider: 'google',
        source: 'test',
      });
      if (succeeds) return detailsFor(request.externalPlaceId);
      throw new PlaceProviderError('not_found');
    },
    search: async () => [],
  };
  const firstService = new CachedPlacesService(provider, () => now);

  await hydratePlaceSnapshots(['ChIJunresolvable'], { now, placesService: firstService });
  expect(providerRefs.get('ChIJunresolvable')?.detailsFailureCode).toBe('NOT_FOUND');
  expect(providerRefs.get('ChIJunresolvable')?.detailsFailedAt).toStrictEqual(now);

  // A cold start creates a new service and has no process-local backoff state.
  const newService = new CachedPlacesService(provider, () => now);
  for (let visit = 0; visit < 5; visit += 1) {
    await hydratePlaceSnapshots(['ChIJunresolvable'], { now, placesService: newService });
  }
  expect(calls, 'one stubborn Place must not become a bill per screen or cold start').toBe(1);

  // The retry is durable but bounded. A later successful location clears it.
  succeeds = true;
  const retryAt = new Date(now.getTime() + 30 * DAY_MS + 1);
  await hydratePlaceSnapshots(['ChIJunresolvable'], {
    now: retryAt,
    placesService: new CachedPlacesService(provider, () => retryAt),
  });
  expect(calls).toBe(2);
  expect(providerRefs.get('ChIJunresolvable')?.detailsFailureCode).toBe(null);
  expect(providerRefs.get('ChIJunresolvable')?.detailsFailedAt).toBe(null);
});

test('an unusable location is durably cached but transient provider failures are not', async () => {
  const now = new Date('2026-08-18T00:00:00.000Z');
  seedProviderRef('ChIJunusable');
  seedProviderRef('ChIJtransient');

  let unusableCalls = 0;
  const unusable: PlacesProvider = {
    name: 'google',
    getDetails: async (request) => {
      unusableCalls += 1;
      return { ...detailsFor(request.externalPlaceId), location: null };
    },
    search: async () => [],
  };
  await new CachedPlacesService(unusable, () => now).getDetails({
    detail: 'location',
    externalPlaceId: 'ChIJunusable',
  });
  await new CachedPlacesService(unusable, () => now).getDetails({
    detail: 'location',
    externalPlaceId: 'ChIJunusable',
  });
  expect(unusableCalls).toBe(1);
  expect(providerRefs.get('ChIJunusable')?.detailsFailureCode).toBe('UNUSABLE_LOCATION');

  let transientCalls = 0;
  const transient: PlacesProvider = {
    name: 'google',
    getDetails: async () => {
      transientCalls += 1;
      throw new PlaceProviderError('provider_unavailable');
    },
    search: async () => [],
  };
  const transientService = new CachedPlacesService(transient, () => now);
  await hydratePlaceSnapshots(['ChIJtransient'], { now, placesService: transientService });
  await hydratePlaceSnapshots(['ChIJtransient'], { now, placesService: transientService });
  expect(transientCalls, 'the short in-memory backoff absorbs repeated screen reads').toBe(1);
  expect(providerRefs.get('ChIJtransient')?.detailsFailureCode).toBe(null);

  const afterBackoff = new Date(now.getTime() + 11 * 60 * 1_000);
  await hydratePlaceSnapshots(['ChIJtransient'], {
    now: afterBackoff,
    placesService: new CachedPlacesService(transient, () => afterBackoff),
  });
  expect(transientCalls, 'temporary failures recover after the short backoff').toBe(2);
});

test('structured telemetry separates cache outcomes, Places calls, and Routes calls', async () => {
  const events: ProviderUsageEvent[] = [];
  setProviderUsageSink((event) => events.push(event));
  seedProviderRef('ChIJtelemetry');

  const places = new CachedPlacesService(
    new GooglePlacesProvider({
      apiKey: 'server-key',
      fetcher: async () =>
        Response.json({
          displayName: { text: 'Telemetry Place' },
          id: 'ChIJtelemetry',
          location: { latitude: 1.2966, longitude: 103.8485 },
        }),
      source: 'screen-hydration',
    }),
    () => new Date('2026-08-18T00:00:00.000Z'),
    undefined,
    'screen-hydration',
  );
  await places.getDetails({ detail: 'location', externalPlaceId: 'ChIJtelemetry' });
  await places.getDetails({ detail: 'location', externalPlaceId: 'ChIJtelemetry' });

  const routes = new CachedRoutesService(
    new GoogleRoutesProvider({
      apiKey: 'routes-key',
      fetcher: async () =>
        Response.json({
          routes: [
            { distanceMeters: 1200, duration: '600s', polyline: { encodedPolyline: 'abc' } },
          ],
        }),
      source: 'itinerary-routes',
    }),
    () => new Date('2026-08-18T00:00:00.000Z'),
    'itinerary-routes',
  );
  await routes.computeRoute({
    destination: { latitude: 1.3039, longitude: 103.8318 },
    includePolyline: true,
    mode: 'walk',
    origin: { latitude: 1.2966, longitude: 103.8485 },
  });

  const placeCall = events.find(
    (event) => event.kind === 'outbound' && event.operation === 'getDetails',
  );
  expect(placeCall).toStrictEqual({
    cacheMissReason: 'missing_snapshot',
    detailLevel: 'location',
    endpoint: '/v1/places/:placeId',
    expectedSku: 'place-details-pro',
    kind: 'outbound',
    operation: 'getDetails',
    placeFingerprint: placeCall?.placeFingerprint,
    provider: 'google',
    source: 'screen-hydration',
  });
  expect(placeCall?.placeFingerprint?.includes('ChIJ')).toBe(false);
  expect(
    events.some((event) => event.kind === 'cache_hit' && event.cache === 'place-details'),
  ).toBeTruthy();
  expect(
    events.some(
      (event) =>
        event.kind === 'outbound' &&
        event.endpoint === '/directions/v2:computeRoutes' &&
        event.source === 'itinerary-routes' &&
        event.includePolyline === true &&
        event.routeMode === 'walk',
    ),
  ).toBeTruthy();
});

/**
 * A photograph on every card is the newest way this app could start costing a
 * request per row. Editorial imagery is free, but its provider caps requests per
 * hour, so the failure mode is the same shape as a bill: a list that asks once
 * per row works in development and stops working at the size real people have.
 */
function editorialProvider() {
  let fetches = 0;

  const provider = new PexelsEditorialImageProvider({
    apiKey: 'server-key',
    fetcher: async () => {
      fetches += 1;
      return Response.json({
        photos: [
          {
            id: fetches,
            photographer: 'Ada Rivera',
            photographer_url: 'https://www.pexels.com/@ada',
            src: {
              large: 'https://images.example/large.jpg',
              large2x: 'https://images.example/large2x.jpg',
              medium: 'https://images.example/medium.jpg',
              original: 'https://images.example/original.jpg',
            },
            url: `https://www.pexels.com/photo/${fetches}/`,
          },
        ],
      });
    },
    hourlyBudget: 150,
    source: 'editorial-images',
  });

  return { fetches: () => fetches, provider };
}

test('a Trips list costs one editorial image call per distinct destination, then none', async () => {
  const { fetches, provider } = editorialProvider();
  const service = new CachedEditorialImagesService(
    provider,
    () => new Date(),
    undefined,
    'editorial-images',
  );
  const trips = ['Tokyo', 'Kyoto', 'Tokyo', 'Osaka', 'kyoto', 'Tokyo'];

  await service.resolveMany(
    trips.map((name, index) => ({ subject: { name }, tripId: `trip-${index}` })),
    { ownerId: 'owner-1' },
  );

  expect(fetches(), 'six trips, three distinct destinations').toBe(3);
  expect(getProviderCallCounts()['pexels:search']).toBe(3);

  await service.resolveMany(
    trips.map((name, index) => ({ subject: { name }, tripId: `trip-${index}` })),
    { ownerId: 'owner-1' },
  );

  expect(fetches(), 'the second render of the same list is free').toBe(3);
});

test('a place list with no resolvable photos asks once per subject, not once per render', async () => {
  let fetches = 0;
  const provider = new PexelsEditorialImageProvider({
    apiKey: 'server-key',
    fetcher: async () => {
      fetches += 1;
      return Response.json({ photos: [] });
    },
    hourlyBudget: 150,
    source: 'editorial-images',
  });
  const service = new CachedEditorialImagesService(
    provider,
    () => new Date(),
    undefined,
    'editorial-images',
  );
  const places = [
    { category: 'food_and_drink' as const, name: 'Unknown Cafe' },
    { category: 'stay' as const, name: 'Unknown Inn' },
  ];

  await service.resolveMany(
    places.map((subject) => ({ subject })),
    { ownerId: 'owner-1' },
  );
  await service.resolveMany(
    places.map((subject) => ({ subject })),
    { ownerId: 'owner-1' },
  );

  expect(fetches, 'an empty answer is remembered too').toBe(2);
});
