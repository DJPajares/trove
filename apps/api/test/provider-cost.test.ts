import { randomUUID } from 'node:crypto';

import type { AiPlannerDraft } from '@trove/types';
import { draftPlanScoreInputRevision } from '../src/services/ai-planning-plan-score.js';
import { readFile } from 'node:fs/promises';

import { expect, beforeEach, afterEach, test, vi } from 'vitest';

import {
  CachedPlacesService,
  rememberPlaceEvidence,
  resetCachedPlacesMemo,
} from '../src/services/cached-places.js';
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
  GOOGLE_TEXT_SEARCH_EVIDENCE_FIELD_MASK,
  GOOGLE_TEXT_SEARCH_FIELD_MASK,
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
import { AiPlaceGrounder } from '../src/services/ai-place-grounding.js';
import { groundableDraftPlaceIds } from '../src/services/ai-planning-draft-places.js';
import {
  assembleAiPlanningDraft,
  runAiPlanningPipeline,
  type AiPlanningPipelineOptions,
} from '../src/services/ai-planning-pipeline.js';
import {
  compactModelProposal,
  explicitModelProposal,
  missingDetailsProposal,
} from './fixtures/ai-planning.js';
import { PlacesService, placePhotoId } from '../src/services/places.js';
import {
  getTripPlanScore,
  PLAN_SCORE_CACHE_TTL_MS,
  readPlanScoreInputs,
  type TripPlanScore,
} from '../src/services/plan-score.js';
import {
  getProviderCallCounts,
  recordProviderCall,
  resetProviderCallCounts,
  setProviderUsageSink,
  type ProviderUsageEvent,
} from '../src/services/provider-usage.js';
import type { RouteEstimate, RouteRequest, RoutesProvider } from '../src/services/routes.js';
import {
  LEAVE_BY_BUFFER_SECONDS,
  resolveTripModeContext,
} from '../src/services/trip-mode-context.js';

/**
 * These tests exist because nothing else in the suite can fail when a code path
 * starts costing money. They assert call counts, not behaviour, so a
 * reintroduced fan-out shows up here rather than on a bill.
 */

const DAY_MS = 24 * 60 * 60 * 1_000;
afterEach(() => vi.useRealTimers());

type ProviderRefRow = {
  id: string;
  placeId: string;
  provider: 'GOOGLE';
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
  cachedEvidence?: ProviderPlaceDetails;
  cachedEvidenceAt?: Date;
  cachedEvidenceLanguage?: string;
  cachedEvidenceRegion?: string | null;
};

type LegRow = {
  distanceMeters: number;
  durationSeconds: number;
  encodedPolyline: string | null;
  fetchedAt: Date;
  key: string;
};

const providerRefs = new Map<string, ProviderRefRow>();
type GroundingMappingRow = {
  key: string;
  checkedAt: Date;
  outcome: string;
  placeProviderRefId: string | null;
};
const groundingMappings = new Map<string, GroundingMappingRow>();
const providerLabels = new Map<
  string,
  { providerLabel: string | null; providerAddress: string | null }
>();
let snapshotWrites = 0;
const legs = new Map<string, LegRow>();
const editorialImages = new Map<
  string,
  { cachedAt: Date | null; id: string; images: unknown[]; subjectKey: string }
>();
type PlanScoreTripFixture = ReturnType<typeof buildPlanScoreTripFixture>;
let tripFixture: unknown = null;
let dayFixture: unknown = null;
let tripFindFirstCalls = 0;
let tripPlanScoreWrites = 0;

function decimal(value: number) {
  return { toNumber: () => value };
}

function legKeyOf(where: Record<string, unknown>) {
  return JSON.stringify(where);
}

function canonicalRecord(id: string) {
  const reference = [...providerRefs.values()].find((ref) => ref.placeId === id);
  if (!reference) return null;
  return {
    id,
    kind: 'PROVIDER',
    ownerId: null,
    customLatitude: null,
    customLongitude: null,
    customName: null,
    customNote: null,
    customTimeZone: null,
    ...providerLabels.get(id),
    providerRefs: [reference],
  };
}

function installStubPrisma() {
  (globalThis as { trovePrismaClient?: unknown }).trovePrismaClient = {
    $queryRaw: async (query: { values: unknown[] }) => {
      const [name, uri, externalId, acquiredAt, language, region] = query.values;
      const row = providerRefs.get(String(externalId));
      if (
        !row?.cachedEvidence ||
        row.cachedEvidenceAt?.getTime() !== (acquiredAt as Date).getTime() ||
        row.cachedEvidenceLanguage !== language ||
        (row.cachedEvidenceRegion ?? '') !== region
      )
        return [];
      const photo = row.cachedEvidence.photos?.find((item) => item.name === name);
      if (!photo) return [];
      photo.uri = String(uri);
      return [{ evidence: structuredClone(row.cachedEvidence) }];
    },
    placeProviderRef: {
      findUnique: async (args: {
        where: { provider_externalPlaceId: { externalPlaceId: string }; placeId?: string };
        include?: { place?: unknown };
      }) => {
        const reference = providerRefs.get(args.where.provider_externalPlaceId.externalPlaceId);
        if (!reference || (args.where.placeId && reference.placeId !== args.where.placeId))
          return null;
        return args.include?.place
          ? { ...reference, place: canonicalRecord(reference.placeId) }
          : reference;
      },
      create: async (args: {
        data: {
          externalPlaceId: string;
          place: { create: { providerLabel: string | null; providerAddress: string | null } };
        };
      }) => {
        const placeId = randomUUID();
        seedProviderRef(args.data.externalPlaceId, { placeId });
        providerLabels.set(placeId, args.data.place.create);
        const reference = providerRefs.get(args.data.externalPlaceId)!;
        return { ...reference, place: canonicalRecord(placeId) };
      },
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
        if (
          args.data.cachedEvidenceAt instanceof Date &&
          existing.cachedEvidenceAt &&
          args.data.cachedEvidenceAt.getTime() <= existing.cachedEvidenceAt.getTime()
        )
          return { count: 0 };
        snapshotWrites += 1;
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
    aiPlaceGroundingCache: {
      findUnique: async (args: { where: { key: string } }) => {
        const mapping = groundingMappings.get(args.where.key);
        if (!mapping) return null;
        return {
          ...mapping,
          placeProviderRef:
            [...providerRefs.values()].find((ref) => ref.id === mapping.placeProviderRefId) ?? null,
        };
      },
      upsert: async (args: {
        create: GroundingMappingRow;
        update: Omit<GroundingMappingRow, 'key'>;
        where: { key: string };
      }) => {
        groundingMappings.set(
          args.where.key,
          groundingMappings.has(args.where.key)
            ? { key: args.where.key, ...args.update }
            : args.create,
        );
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
    editorialImageSet: {
      findMany: async (args: { where: { subjectKey: { in: string[] } } }) =>
        args.where.subjectKey.in.flatMap((subjectKey) => {
          const row = editorialImages.get(subjectKey);
          return row ? [row] : [];
        }),
      upsert: async (args: {
        create: Record<string, unknown>;
        update: Record<string, unknown>;
        where: { subjectKey: string };
      }) => {
        const data = editorialImages.has(args.where.subjectKey) ? args.update : args.create;
        const nested = data.images as
          { create?: Record<string, unknown>[]; deleteMany?: Record<string, never> } | undefined;
        const current = editorialImages.get(args.where.subjectKey);
        const row = {
          ...current,
          ...data,
          id: current?.id ?? `image-set-${editorialImages.size + 1}`,
          images: nested?.create ?? current?.images ?? [],
          subjectKey: args.where.subjectKey,
        };
        editorialImages.set(args.where.subjectKey, row as never);
        return { id: row.id };
      },
    },
    place: {
      findMany: async (args: { where: { id: { in: string[] } } }) =>
        args.where.id.in.flatMap((id) => {
          const row = canonicalRecord(id);
          return row ? [row] : [];
        }),
      findUnique: async (args: { where: { id: string } }) => canonicalRecord(args.where.id),
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
      // Plan Score caches what it computes, so the fixture has to accept the
      // write back and answer the next read from it.
      update: async ({ data }: { data: Record<string, unknown> }) => {
        tripPlanScoreWrites += 1;
        Object.assign(tripFixture as object, data);
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
    priority: null as string | null,
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
        localStartTime: null as Date | null,
        position: 0,
        startInstant: null,
        timeSemantics: null,
        timeZone: null,
        travelModeToNext: 'WALK' as string | null,
        tripPlace: scheduledTripPlace,
        tripPlaceId: 'tp-scheduled' as string | null,
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
      return {
        ...detailsFor(request.externalPlaceId),
        ...(request.detail === 'evidence'
          ? {
              photos: [],
              websiteUri: null,
              internationalPhoneNumber: null,
              priceLevel: null,
            }
          : {}),
      };
    },
    search: async () => [],
  };

  return { provider, requests };
}

function seedProviderRef(externalPlaceId: string, overrides: Partial<ProviderRefRow> = {}) {
  providerRefs.set(externalPlaceId, {
    id: randomUUID(),
    placeId: randomUUID(),
    provider: 'GOOGLE',
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
    attributions: [],
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
      return {
        ...detailsFor(request.externalPlaceId),
        ...(request.detail === 'evidence'
          ? {
              photos: [],
              websiteUri: null,
              internationalPhoneNumber: null,
              priceLevel: null,
            }
          : {}),
      };
    },
    search: async () => [],
  };

  return { provider, calls: () => calls };
}

/**
 * A provider whose evidence carries photos, and whose photo media answers can
 * be scripted per call: `'not_found'` and `'unavailable'` throw the matching
 * provider error, anything else is the image URL.
 */
function photoPlacesProvider(mediaAnswers: Record<string, string[]> = {}) {
  let details = 0;
  let media = 0;
  const provider: PlacesProvider = {
    name: 'google',
    getDetails: async (request) => {
      details += 1;
      recordProviderCall({
        detailLevel: request.detail,
        endpoint: '/v1/places/:placeId',
        expectedSku:
          request.detail === 'location' ? 'place-details-pro' : 'place-details-enterprise',
        operation: 'getDetails',
        provider: 'google',
        source: 'test',
      });
      return {
        ...detailsFor(request.externalPlaceId),
        ...(request.detail === 'evidence'
          ? {
              photos: [1, 2, 3].map((index) => ({
                authorAttributions: [{ displayName: `Author ${index}`, uri: null }],
                heightPx: 900,
                name: `places/${request.externalPlaceId}/photos/p${index}`,
                uri: null,
                widthPx: 1200,
              })),
              internationalPhoneNumber: null,
              priceLevel: 1 as const,
              websiteUri: 'https://museum.example/',
            }
          : {}),
      };
    },
    getPhotoMedia: async (request) => {
      media += 1;
      recordProviderCall({
        endpoint: '/v1/places/:placeId/photos/:photoId/media',
        expectedSku: 'place-details-photos',
        operation: 'getPhotoMedia',
        provider: 'google',
        source: 'test',
      });
      const answer = mediaAnswers[request.name]?.shift();
      if (answer === 'not_found' || answer === 'unavailable') {
        throw new PlaceProviderError(answer === 'not_found' ? 'not_found' : 'provider_unavailable');
      }
      return answer ?? `https://lh3.googleusercontent.com/${request.name}`;
    },
    search: async () => [],
  };

  return { provider, details: () => details, media: () => media };
}

function countingRoutesProvider() {
  let calls = 0;
  const asked: Array<boolean | undefined> = [];
  const provider: RoutesProvider = {
    name: 'google',
    computeRoute: async (request: RouteRequest): Promise<RouteEstimate> => {
      calls += 1;
      asked.push(request.includePolyline);
      return {
        distanceMeters: 1_200,
        durationSeconds: 600,
        encodedPolyline: request.includePolyline ? 'abc' : null,
      };
    },
  };

  return { asked: () => asked, provider, calls: () => calls };
}

beforeEach(() => {
  providerRefs.clear();
  groundingMappings.clear();
  providerLabels.clear();
  snapshotWrites = 0;
  legs.clear();
  editorialImages.clear();
  resetEditorialImageBudget();
  tripFixture = null;
  dayFixture = null;
  tripFindFirstCalls = 0;
  tripPlanScoreWrites = 0;
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
      reservations: [],
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
  for (const field of ['rating', 'regularOpeningHours', 'userRatingCount', 'currentOpeningHours']) {
    expect(GOOGLE_PLACE_LOCATION_FIELD_MASK.includes(field), field).toBe(false);
  }
  // Evidence asks for the mutable fields Plan Score reads, plus what a
  // place's own sheet renders from the same Enterprise answer: website, phone
  // and price level are that tier already, and photos are the cheapest one.
  for (const field of [
    'rating',
    'regularOpeningHours',
    'userRatingCount',
    'currentOpeningHours',
    'photos',
    'websiteUri',
    'internationalPhoneNumber',
    'priceLevel',
  ]) {
    expect(GOOGLE_PLACE_EVIDENCE_FIELD_MASK.includes(field), field).toBe(true);
  }
  // Identity and location-only grounding never ask for photos, and
  // nothing reaches into Enterprise + Atmosphere.
  for (const mask of [GOOGLE_PLACE_LOCATION_FIELD_MASK, GOOGLE_TEXT_SEARCH_FIELD_MASK]) {
    expect(mask.includes('photos')).toBe(false);
  }
  for (const field of ['reviews', 'editorialSummary', 'generativeSummary']) {
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

  // Leaving at the exact moment that lands you there as it starts is a
  // departure nobody wants to be told, so the time carries a standing slack.
  const leaveBy = context.leaveBy!;
  expect(leaveBy.bufferSeconds).toBe(LEAVE_BY_BUFFER_SECONDS);
  expect(new Date(leaveBy.at).getTime()).toBe(
    new Date(leaveBy.targetStartAt).getTime() -
      (leaveBy.routeDurationSeconds + LEAVE_BY_BUFFER_SECONDS) * 1_000,
  );
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

test('rich evidence is stored separately with its original acquisition date', async () => {
  seedProviderRef('ChIJmuseum');
  const service = new CachedPlacesService(countingPlacesProvider().provider);

  await service.getDetails({ detail: 'evidence', externalPlaceId: 'ChIJmuseum' });

  const stored = providerRefs.get('ChIJmuseum') as unknown as {
    cachedEvidence: ProviderPlaceDetails;
    cachedEvidenceAt: Date;
    cachedAt: Date | null;
  };
  expect(stored.cachedEvidence.rating).toBe(4.5);
  expect(stored.cachedEvidenceAt).toBeInstanceOf(Date);
  expect(stored.cachedAt).toEqual(stored.cachedEvidenceAt);
});

test('seeded search evidence keeps its original age and language/region isolation', async () => {
  let now = new Date('2026-09-02T12:00:00Z');
  const { provider } = countingPlacesProvider();
  const result = await new PlacesService(provider, () => now).getDetails({
    detail: 'evidence',
    externalPlaceId: 'ChIJmuseum',
  });
  if (result.status !== 'ok') throw new Error('fixture must provide evidence');
  resetProviderCallCounts();
  const request = { externalPlaceId: 'ChIJmuseum', languageCode: 'en', regionCode: 'SG' };
  await rememberPlaceEvidence(request, result);
  const service = new CachedPlacesService(provider, () => now);
  now = new Date(now.getTime() + 30 * DAY_MS - 1);
  const hit = await service.getDetails({ ...request, detail: 'evidence' });
  expect(hit).toEqual(result);
  expect(getProviderCallCounts()['google:getDetails'] ?? 0).toBe(0);
  await rememberPlaceEvidence(request, result);
  now = new Date(now.getTime() + 1);
  await service.getDetails({ ...request, detail: 'evidence' });
  expect(getProviderCallCounts()['google:getDetails']).toBe(1);
  await service.getDetails({ ...request, languageCode: 'ja', detail: 'evidence' });
  await service.getDetails({ ...request, regionCode: 'JP', detail: 'evidence' });
  expect(getProviderCallCounts()['google:getDetails']).toBe(3);
  expect(snapshotWrites).toBe(0);
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

test('route retention is independent of the calling surface', async () => {
  let now = new Date('2026-09-01T09:00:00Z');
  const { provider, calls } = countingRoutesProvider();
  const ordinary = new CachedRoutesService(provider, () => now, 'itinerary-routes');
  const scoring = new CachedRoutesService(provider, () => now, 'plan-score');
  const request: RouteRequest = {
    origin: { latitude: 1.2966, longitude: 103.8485 },
    destination: { latitude: 1.3039, longitude: 103.8318 },
    mode: 'walk',
  };
  await ordinary.computeRoute(request);
  now = new Date(now.getTime() + PLAN_SCORE_CACHE_TTL_MS - 1);
  await scoring.computeRoute(request);
  expect(calls()).toBe(1);
  now = new Date(now.getTime() + 1);
  await ordinary.computeRoute(request);
  expect(calls()).toBe(1);
  await scoring.computeRoute(request);
  expect(calls()).toBe(1);
});

test('a leg bought for a list already has its line when the map wants it', async () => {
  const { asked, provider, calls } = countingRoutesProvider();
  const service = new CachedRoutesService(provider);
  const leg = {
    destination: { latitude: 1.3039, longitude: 103.8318 },
    mode: 'walk' as const,
    origin: { latitude: 1.2966, longitude: 103.8485 },
  };

  const list = await service.computeRoute(leg);
  // The price does not depend on the polyline, so every purchase includes it.
  expect(asked()).toStrictEqual([true]);
  expect(list.status === 'ok' && list.estimate.encodedPolyline, 'a list is not sent a line').toBe(
    null,
  );

  const map = await service.computeRoute({ ...leg, includePolyline: true });
  expect(calls(), 'one purchase serves both surfaces').toBe(1);
  expect(map.status === 'ok' && map.estimate.encodedPolyline).toBe('abc');

  const listAgain = await service.computeRoute(leg);
  expect(calls()).toBe(1);
  expect(listAgain.status === 'ok' && listAgain.estimate.encodedPolyline).toBe(null);
});

test('a leg stored before this without its line is bought once more, then complete', async () => {
  const { provider, calls } = countingRoutesProvider();
  const service = new CachedRoutesService(provider);
  const leg = {
    destination: { latitude: 1.3039, longitude: 103.8318 },
    mode: 'walk' as const,
    origin: { latitude: 1.2966, longitude: 103.8485 },
  };

  await service.computeRoute(leg);
  for (const row of legs.values()) row.encodedPolyline = null;

  const first = await service.computeRoute({ ...leg, includePolyline: true });
  expect(calls()).toBe(2);
  expect(first.status === 'ok' && first.estimate.encodedPolyline).toBe('abc');

  await service.computeRoute({ ...leg, includePolyline: true });
  expect(calls(), 'the complete leg replaced the thin one').toBe(2);
});

test('a list and a map asking for the same leg together make one purchase', async () => {
  const { provider, calls } = countingRoutesProvider();
  const service = new CachedRoutesService(provider);
  const leg = {
    destination: { latitude: 1.3039, longitude: 103.8318 },
    mode: 'walk' as const,
    origin: { latitude: 1.2966, longitude: 103.8485 },
  };

  const [list, map] = await Promise.all([
    service.computeRoute(leg),
    service.computeRoute({ ...leg, includePolyline: true }),
  ]);

  expect(calls()).toBe(1);
  expect(list.status === 'ok' && list.estimate.encodedPolyline).toBe(null);
  expect(map.status === 'ok' && map.estimate.encodedPolyline).toBe('abc');
});

test('a list request is reported to the provider as asking for the line too', async () => {
  const events: ProviderUsageEvent[] = [];
  setProviderUsageSink((event) => events.push(event));
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

  const list = await routes.computeRoute({
    destination: { latitude: 1.3039, longitude: 103.8318 },
    mode: 'walk',
    origin: { latitude: 1.2966, longitude: 103.8485 },
  });

  expect(list.status === 'ok' && list.estimate.encodedPolyline).toBe(null);
  expect(
    events.filter((event) => event.kind === 'outbound' && event.includePolyline === true),
  ).toHaveLength(1);
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

test('a day is routed from coordinates stored in another language, with no provider call', async () => {
  // Freshness is judged against the real clock, so the snapshot has to be one.
  const now = new Date();
  seedFreshRef('ChIJhotel', now);
  const stored = providerRefs.get('ChIJhotel');
  const hotel = {
    customLatitude: null,
    customLongitude: null,
    customName: null,
    id: 'place-hotel',
    providerRefs: [{ ...stored, cachedLanguageCode: 'ja', provider: 'GOOGLE' }],
  } as unknown as Parameters<ReturnType<typeof createPlaceResolver>>[0];
  const { provider, calls } = countingPlacesProvider();
  const service = new PlacesService(provider);

  const point = await createPlaceResolver(service, 'en')(hotel, 'daily_base', 'day-1-base');

  expect(point?.coordinates.latitude).toBe(1.2966);
  // Where it is does not depend on language; what it is called does.
  expect(point?.label).toBeNull();
  expect(calls(), 'a snapshot in another language still places the leg').toBe(0);

  const sameLanguage = await createPlaceResolver(service, 'ja')(hotel, 'daily_base', 'day-1-base');
  expect(sameLanguage?.label).toBe('National Museum');
  expect(calls()).toBe(0);
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

test('Plan Score reads scheduled evidence without acquiring missing places', async () => {
  tripFixture = buildPlanScoreTripFixture();
  const { requests } = detailRequestsProvider();

  // Real network calls for routing would need a real Routes API key; disabling
  // the provider keeps this test's routes leg deterministic and offline while
  // leaving the injected `placesService` - the thing under test - untouched.
  // Plan Score itself must be explicitly enabled regardless of the ambient
  // environment, since this test verifies its normal (not disabled) behaviour.
  await withEnvOverride(
    { TROVE_GOOGLE_PROVIDERS_DISABLED: '1', TROVE_PLAN_SCORE_DISABLED: undefined },
    () => getTripPlanScore('user-1', 'trip-1', {}),
  );

  const evidenceRequests = requests.filter((request) => request.detail === 'evidence');
  expect(
    evidenceRequests.map((request) => request.externalPlaceId),
    'the unscheduled trip place must never be asked for evidence',
  ).toStrictEqual([]);
});

test('suggesting a time for a new stop reads only what is stored', async () => {
  tripFixture = buildPlanScoreTripFixture();
  const { getItineraryDayTimeSuggestions } =
    await import('../src/services/itinerary-time-suggestions.js');

  // No provider is configured and none may be reached: the new stop's place,
  // hours and leg are all read from what Trove already stored, or estimated.
  const result = await getItineraryDayTimeSuggestions('user-1', 'trip-1', 'day-1', {
    candidate: { durationMinutes: null, tripPlaceId: 'tp-unscheduled' },
  });

  expect(result.suggestions.map((suggestion) => suggestion.itemId)).toStrictEqual(['candidate']);
  expect(getProviderCallCounts()).toStrictEqual({});
});

test('TROVE_PLAN_SCORE_DISABLED stops every provider call, even with a working service supplied', async () => {
  tripFixture = buildPlanScoreTripFixture();
  const { requests } = detailRequestsProvider();

  await withEnvOverride(
    { TROVE_GOOGLE_PROVIDERS_DISABLED: '1', TROVE_PLAN_SCORE_DISABLED: undefined },
    () => getTripPlanScore('user-1', 'trip-1', {}),
  );
  expect(requests.length, 'cache-only scoring must not reach a provider even when enabled').toBe(0);

  requests.length = 0;
  resetCachedPlacesMemo();
  const tripFindFirstCallsBeforeDisabled = tripFindFirstCalls;
  const disabled = await withEnvOverride(
    { TROVE_GOOGLE_PROVIDERS_DISABLED: '1', TROVE_PLAN_SCORE_DISABLED: '1' },
    () => getTripPlanScore('user-1', 'trip-1', {}),
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
 * The switch bounds this endpoint's fan-out. Draft scoring makes no provider call
 * of its own, so silencing it would cost a traveller their score and save
 * nothing — asserted here because the guarantee is otherwise only an accident of
 * which module reads the flag.
 */
test('TROVE_PLAN_SCORE_DISABLED cannot reach scoring that costs no provider call', async () => {
  const { arePlanScoreProvidersDisabled } = await import('../src/environment.js');
  const planScore = await import('../src/services/plan-score.js');
  const pipelineSource = await readFile(
    new URL('../src/services/ai-planning-pipeline.ts', import.meta.url),
    'utf8',
  );
  const draftReaderSource = await readFile(
    new URL('../src/services/ai-draft-score-reader.ts', import.meta.url),
    'utf8',
  );

  expect(arePlanScoreProvidersDisabled({ TROVE_PLAN_SCORE_DISABLED: '1' })).toBe(true);

  // The pipeline now uses the shared cache-only draft reader. Neither path
  // consults the provider kill switch or acquires missing evidence.
  expect(pipelineSource).not.toContain('arePlanScoreProvidersDisabled');
  expect(pipelineSource).toContain('readDraftPlanScore');
  expect(draftReaderSource).toContain('buildPlanScoreFromEvaluations');
  expect(draftReaderSource).not.toContain('arePlanScoreProvidersDisabled');
  expect(
    await withEnvOverride({ TROVE_PLAN_SCORE_DISABLED: '1' }, async () =>
      planScore.buildPlanScoreFromEvaluations({ days: [], mustGoIds: [], scheduledIds: [] }),
    ),
  ).toMatchObject({ withheldReasons: ['NO_SCORABLE_DAY'] });
});

/**
 * The whole point of storing a score: a second look at an unchanged trip costs
 * nothing. Everything above proves what one computation costs; this proves the
 * next one costs zero, and that the key notices what the rubric actually reads.
 */
test('a stored Plan Score serves an unchanged trip with no provider call', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-01T09:00:00.000Z'));
  tripFixture = buildPlanScoreTripFixture();
  const { requests } = detailRequestsProvider();
  const scoreAt = (now: Date) =>
    withEnvOverride(
      { TROVE_GOOGLE_PROVIDERS_DISABLED: '1', TROVE_PLAN_SCORE_DISABLED: undefined },
      () => getTripPlanScore('user-1', 'trip-1', { now: () => now }),
    );

  const first = await scoreAt(new Date('2026-09-01T09:00:00.000Z'));
  expect(requests.length, 'a first computation is cache-only').toBe(0);
  expect(tripPlanScoreWrites).toBe(1);

  requests.length = 0;
  resetCachedPlacesMemo(); // A separate API instance retains only database state.
  const second = await scoreAt(new Date('2026-09-01T10:00:00.000Z'));

  expect(requests, 'an unchanged trip must not reach the provider again').toStrictEqual([]);
  expect(second).toStrictEqual(first);
  expect(tripPlanScoreWrites, 'a hit must not rewrite the row').toBe(1);
});

test('the stored Plan Score is invalidated by what the rubric reads, and only that', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-01T09:00:00.000Z'));
  const scoreAt = (now: Date) =>
    withEnvOverride(
      { TROVE_GOOGLE_PROVIDERS_DISABLED: '1', TROVE_PLAN_SCORE_DISABLED: undefined },
      () => getTripPlanScore('user-1', 'trip-1', { now: () => now }),
    );
  const NOW = new Date('2026-09-01T09:00:00.000Z');

  // Each case warms the cache, applies one edit, and reports whether the next
  // look had to pay for itself.
  const recomputesAfter = async (edit: (trip: PlanScoreTripFixture) => void) => {
    tripFixture = buildPlanScoreTripFixture();
    const { requests } = detailRequestsProvider();
    await scoreAt(NOW);
    requests.length = 0;
    resetCachedPlacesMemo();
    edit(tripFixture as PlanScoreTripFixture);
    const writesBefore = tripPlanScoreWrites;
    await scoreAt(NOW);
    expect(requests).toHaveLength(0);
    return tripPlanScoreWrites > writesBefore;
  };

  expect(await recomputesAfter(() => {}), 'nothing changed').toBe(false);

  // Timing, order, duration, place and priority all move the score.
  expect(
    await recomputesAfter((trip) => {
      trip.itineraryDays[0]!.items[0]!.localStartTime = new Date('1970-01-01T09:30:00.000Z');
    }),
    'a start time moves the score',
  ).toBe(true);
  expect(
    await recomputesAfter((trip) => {
      trip.itineraryDays[0]!.items[0]!.durationMinutes = 120;
    }),
    'a duration moves the score',
  ).toBe(true);
  expect(
    await recomputesAfter((trip) => {
      trip.itineraryDays[0]!.items[0]!.position = 5;
    }),
    'an order change moves the legs',
  ).toBe(true);
  expect(
    await recomputesAfter((trip) => {
      trip.itineraryDays[0]!.items[0]!.travelModeToNext = 'DRIVE';
    }),
    'a travel mode moves the legs',
  ).toBe(true);
  expect(
    await recomputesAfter((trip) => {
      trip.tripPlaces[0]!.priority = 'MUST_GO';
    }),
    'Must Go priority moves the trip factor',
  ).toBe(true);
  expect(
    await recomputesAfter((trip) => {
      trip.itineraryDays[0]!.items[0]!.tripPlaceId = 'tp-unscheduled';
    }),
    'a different place moves the evidence and the legs',
  ).toBe(true);

  // A field the rubric cannot read must not trigger the most expensive endpoint
  // in the app, which is the reason the key names its inputs rather than
  // hashing a row wholesale.
  expect(
    await recomputesAfter((trip) => {
      (trip as unknown as { name: string }).name = 'Renamed after scoring';
    }),
    'a trip rename cannot move the score',
  ).toBe(false);
});

test('a stored Plan Score expires even when nothing about the trip changed', async () => {
  tripFixture = buildPlanScoreTripFixture();
  const { requests } = detailRequestsProvider();
  const scoreAt = (now: Date) =>
    withEnvOverride(
      { TROVE_GOOGLE_PROVIDERS_DISABLED: '1', TROVE_PLAN_SCORE_DISABLED: undefined },
      () => getTripPlanScore('user-1', 'trip-1', { now: () => now }),
    );

  const first = new Date('2026-09-01T09:00:00.000Z');
  await scoreAt(first);
  requests.length = 0;
  resetCachedPlacesMemo();

  // Opening hours and ratings move underneath a plan nobody edits, and no
  // revision can express that, so age alone has to force the refresh.
  await scoreAt(new Date(first.getTime() + PLAN_SCORE_CACHE_TTL_MS));
  expect(requests.length, 'an expired score recomputes without provider calls').toBe(0);
  expect(tripPlanScoreWrites).toBe(2);
});

test('an inflated Apply timestamp cannot renew an expired generated assessment', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const now = new Date('2026-09-01T09:00:00Z');
  vi.setSystemTime(now);
  const trip = buildPlanScoreTripFixture();
  const { buildPlanScoreFromEvaluations } = await import('../src/services/plan-score.js');
  const assessment = {
    ...buildPlanScoreFromEvaluations({ days: [], mustGoIds: [], scheduledIds: [] }),
    score: 72,
  };
  const score = {
    ...assessment,
    generatedAt: new Date(now.getTime() - PLAN_SCORE_CACHE_TTL_MS).toISOString(),
    evidenceAsOf: undefined,
  };
  tripFixture = {
    ...trip,
    planScore: score,
    planScoreComputedAt: now,
    planScoreRevision: readPlanScoreInputs(trip as never).revision,
  };
  const { requests } = detailRequestsProvider();
  const result = await withEnvOverride(
    { TROVE_GOOGLE_PROVIDERS_DISABLED: '1', TROVE_PLAN_SCORE_DISABLED: undefined },
    () =>
      getTripPlanScore('user-1', 'trip-1', {
        now: () => now,
      }),
  );
  expect(requests).toHaveLength(0);
  expect(result?.generatedAt).toBe(now.toISOString());
  expect(result?.score).not.toBe(72);
});

test('expired provider evidence still permits a cache-only partial timing assessment', async () => {
  const now = new Date('2026-09-01T09:00:00Z');
  const trip = buildPlanScoreTripFixture();
  const { buildPlanScoreFromEvaluations } = await import('../src/services/plan-score.js');
  const score = {
    ...buildPlanScoreFromEvaluations({
      days: [],
      mustGoIds: [],
      scheduledIds: [],
      evaluatedAt: new Date(now.getTime() - PLAN_SCORE_CACHE_TTL_MS),
    }),
    score: 72,
  };
  tripFixture = {
    ...trip,
    planScore: score,
    planScoreComputedAt: now,
    planScoreRevision: readPlanScoreInputs(trip as never).revision,
  };
  const result = await withEnvOverride(
    { TROVE_GOOGLE_PROVIDERS_DISABLED: '1', TROVE_PLAN_SCORE_DISABLED: undefined },
    () => getTripPlanScore('user-1', 'trip-1', { now: () => now }),
  );
  expect(result).toMatchObject({ assessmentStatus: 'provisional' });
  expect(result?.days.every((day) => day.score !== null)).toBe(true);
  // The stop has a length but no time, which counts low; its Google place
  // still counts as located although its cached snapshot has lapsed.
  expect(result?.score).toBeGreaterThanOrEqual(80);
  expect(result?.score).toBeLessThan(100);
  const codes = result?.explanations.worthImproving.map((reason) => reason.code);
  expect(codes).toContain('STOPS_WITHOUT_TIMING');
  expect(codes).not.toContain('STOPS_NOT_LOCATED');
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

test('thin evidence cannot overwrite a missing location snapshot', async () => {
  const now = new Date('2026-08-18T00:00:00.000Z');
  seedProviderRef('ChIJmuseum');

  expect(GOOGLE_PLACE_EVIDENCE_FIELD_MASK.includes('location')).toBe(true);

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
    fetcher: async (input) => {
      fetches += 1;
      return Response.json({
        photos: [
          {
            alt: new URL(String(input)).searchParams.get('query') ?? '',
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

  expect(fetches, 'each exact answer and each category fallback is remembered').toBe(4);
});

test('missing places of the same detailed type share one generic provider request', async () => {
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
  const service = new CachedEditorialImagesService(provider);

  await service.resolveMany(
    ['Sunrise', 'Moonlight', 'Corner'].map((name) => ({
      subject: {
        category: 'food_and_drink' as const,
        name,
        primaryType: 'bakery',
        rawTypes: ['bakery'],
      },
    })),
    { ownerId: 'owner-1' },
  );

  expect(fetches, 'three exact lookups share one bakery fallback').toBe(4);
});

/**
 * The planner used to look up every place the model *considered*: grounding ran
 * before scheduling, so orphan candidates, out-of-range items, pace-dropped
 * items and everything past the real-place cap were all billed and then thrown
 * away. Scheduling now runs first and grounding only sees what survived, so this
 * asserts the searched set rather than trusting the stage order to stay put.
 */
test('a generate run searches only the places its finished itinerary stands on', async () => {
  const proposal = missingDetailsProposal();
  const kyoto = proposal.places[0]!;

  proposal.places = [
    kyoto,
    // Referenced by an item that lands on a real day: searched.
    { id: 'candidate:used', name: 'Nishiki Market', note: null, searchQuery: 'Nishiki Market' },
    // Referenced only by an item whose dayIndex falls outside the trip, so it
    // ends up unscheduled: not searched.
    { id: 'candidate:unscheduled', name: 'Kinkaku-ji', note: null, searchQuery: 'Kinkaku-ji' },
    // Declared and never referenced at all. Nothing rejects this, so it has to
    // be dropped here or it is a free lookup on every run.
    { id: 'candidate:orphan', name: 'Fushimi Inari', note: null, searchQuery: 'Fushimi Inari' },
  ];

  const item = (id: string, candidatePlaceId: string, dayIndex: number) => ({
    blockType: 'activity' as const,
    candidatePlaceId,
    constraintIds: [],
    dayIndex,
    destinationIntentId: null,
    durationMinutes: 60,
    durationProvenance: 'ai_estimated' as const,
    id,
    isAnchor: false,
    label: id,
    notes: null,
    origin: 'model' as const,
    priority: 'interested' as const,
    schedule: { dayPart: 'anytime' as const, kind: 'day_part' as const },
  });

  proposal.items = [
    item('item:used', 'candidate:used', 0),
    item('item:unscheduled', 'candidate:unscheduled', 9),
  ];

  const draft = assembleAiPlanningDraft(proposal, new Date('2026-08-31T12:00:00.000Z'));
  const targets = groundableDraftPlaceIds(draft);
  const searchable = proposal.places.filter((candidate) => targets.has(candidate.id));

  const queries: string[] = [];
  const grounder = new AiPlaceGrounder(
    {
      name: 'google' as const,
      async textSearch(request) {
        queries.push(request.textQuery);
        return [];
      },
    },
    {
      async resolveProviderPlaceFromIdentity() {
        return { id: 'unused' };
      },
    },
  );
  await grounder.groundCandidates(searchable);

  // The destination Kyoto (apply needs it as a TripDestination) and the one
  // scheduled stop. The unscheduled and orphan candidates cost nothing.
  expect(queries.toSorted()).toStrictEqual(['Kyoto Japan', 'Nishiki Market']);
  expect(draft.places.map((place) => place.id).toSorted()).toStrictEqual([
    'candidate:kyoto',
    'candidate:unscheduled',
    'candidate:used',
  ]);
});

test('six venues use one Places call each, with persisted identity and transient evidence reuse', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-02T12:00:00Z'));
  const proposal = explicitModelProposal();
  proposal.normalizedRequest.constraints = [];
  const template = proposal.items[1]!;
  proposal.places = [
    proposal.places[0]!,
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `candidate:venue${index}`,
      name: `Tokyo Venue ${index}`,
      note: null,
      searchQuery: `Tokyo Venue ${index}`,
    })),
  ];
  proposal.items = proposal.places.slice(1).map((place, index) => ({
    ...template,
    id: `item:venue${index}`,
    candidatePlaceId: place.id,
    label: place.name,
    constraintIds: [],
    isAnchor: false,
    origin: 'model',
    priority: 'interested',
    dayIndex: Math.floor(index / 2),
    durationMinutes: 60,
    schedule: { kind: 'day_part', dayPart: index % 2 ? 'afternoon' : 'morning' },
  }));
  const events: ProviderUsageEvent[] = [];
  setProviderUsageSink((event) => events.push(event));
  const provider = new GooglePlacesProvider({
    apiKey: 'test-key',
    source: 'ai-planner',
    fetcher: async (input, init) => {
      const url = String(input);
      if (url.includes('/photos/') && url.includes('/media')) {
        return Response.json({ photoUri: 'https://lh3.googleusercontent.com/venue-cover' });
      }
      if (url.endsWith('/v1/places:searchText')) {
        const query = (JSON.parse(String(init?.body)) as { textQuery: string }).textQuery;
        const place = proposal.places.find((candidate) => candidate.searchQuery === query)!;
        expect(place).toBeDefined();
        const mask = new Headers(init?.headers).get('X-Goog-FieldMask');
        expect(mask).toBe(
          place.id === 'candidate:tokyo'
            ? GOOGLE_TEXT_SEARCH_FIELD_MASK
            : GOOGLE_TEXT_SEARCH_EVIDENCE_FIELD_MASK,
        );
        return Response.json({
          places: [
            {
              id: `google-${place.id}`,
              displayName: { text: place.name },
              rating: 4.5,
              photos: [1, 2, 3].map((number) => ({
                name: `places/google-${place.id.replaceAll(':', '_')}/photos/p${number}`,
                authorAttributions: [{ displayName: `Author ${number}` }],
                widthPx: 1200,
                heightPx: 900,
              })),
              websiteUri: 'https://example.com/venue',
              internationalPhoneNumber: '+81 3 1234 5678',
              priceLevel: 'PRICE_LEVEL_MODERATE',
              utcOffsetMinutes: 540,
              regularOpeningHours: { periods: [{ open: {} }] },
              formattedAddress: 'Tokyo, Japan',
              location: {
                latitude: 35.7 + proposal.places.indexOf(place) / 1000,
                longitude: 139.776,
              },
            },
          ],
        });
      }
      expect(new Headers(init?.headers).get('X-Goog-FieldMask')).toBe(
        GOOGLE_PLACE_EVIDENCE_FIELD_MASK,
      );
      return Response.json({
        id: decodeURIComponent(url.split('/').at(-1)!),
        rating: 4.5,
        utcOffsetMinutes: 540,
        regularOpeningHours: { periods: [{ open: { day: 0, hour: 0, minute: 0 } }] },
      });
    },
  });
  const routeRequests: RouteRequest[] = [];
  const routesService = new CachedRoutesService({
    name: 'google',
    async computeRoute(request) {
      routeRequests.push(request);
      return { distanceMeters: 500, durationSeconds: 600, encodedPolyline: null };
    },
  });
  const drafts: AiPlannerDraft[] = [];
  const planScores: TripPlanScore[] = [];
  const failures: string[] = [];
  const lifecycle: NonNullable<AiPlanningPipelineOptions['lifecycle']> = {
    async claim(_ownerId, runId) {
      return {
        baseDraftRevision: 0,
        deadlineAt: new Date(Date.now() + 60_000),
        model: 'test',
        prompt: 'Tokyo trip',
        provider: 'vertex',
        runId,
        sessionId: randomUUID(),
      };
    },
    async completeFailure(_ownerId, _runId, code) {
      failures.push(code);
    },
    async completeSuccess(_ownerId, _runId, draft, planScore) {
      drafts.push(draft);
      planScores.push(planScore);
    },
    async updateStage() {},
  };
  const gateway: NonNullable<AiPlanningPipelineOptions['gateway']> = {
    async generateStructured<OUTPUT>() {
      return {
        output: compactModelProposal(proposal) as OUTPUT,
        metadata: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          latencyMs: 1,
          model: 'test',
          provider: 'vertex' as const,
        },
      };
    },
  };
  const run = () =>
    runAiPlanningPipeline(randomUUID(), randomUUID(), {
      clock: () => new Date(),
      gateway,
      lifecycle,
      loadHomeLocation: async () => 'Singapore',
      providerContext: {
        placesProvider: provider,
        placesService: new CachedPlacesService(provider),
        routesService,
      },
    });

  await run();
  expect(failures).toEqual([]);
  expect(getProviderCallCounts()['google:textSearch']).toBe(7);
  expect(getProviderCallCounts()['google:getDetails'] ?? 0).toBe(0);
  expect(snapshotWrites).toBe(13);
  expect(groundingMappings.size).toBe(7);
  expect(
    events.filter(
      (event) => event.kind === 'outbound' && event.expectedSku === 'places-text-search-enterprise',
    ),
  ).toHaveLength(6);
  expect(
    events.filter(
      (event) => event.kind === 'outbound' && event.expectedSku === 'places-text-search-pro',
    ),
  ).toHaveLength(1);
  const originalDates = [...providerRefs.values()].map((ref) => ref.cachedAt);

  // Search evidence seeds the existing memory cache for the next generation.
  await run();
  expect(getProviderCallCounts()['google:textSearch']).toBe(7);
  expect(getProviderCallCounts()['google:getDetails'] ?? 0).toBe(0);
  expect(drafts[1]!.evidence.filter((entry) => entry.kind === 'opening_hours')).toEqual(
    drafts[0]!.evidence.filter((entry) => entry.kind === 'opening_hours'),
  );

  resetCachedPlacesMemo(); // A separate API instance retains only database state.
  await run();
  expect(failures).toEqual([]);
  expect(getProviderCallCounts()['google:textSearch']).toBe(7);
  expect(getProviderCallCounts()['google:getDetails'] ?? 0).toBe(0);
  expect(snapshotWrites).toBe(13);
  expect([...providerRefs.values()].map((ref) => ref.cachedAt)).toEqual(originalDates);
  expect(routeRequests).toHaveLength(3); // Each adjacent leg is acquired once, then reused.
  for (const draft of drafts) {
    expect(draft.days.map((day) => day.items.length)).toEqual([2, 2, 2]);
    expect(
      draft.evidence.filter(
        (entry) => entry.kind === 'opening_hours' && entry.status === 'verified',
      ),
      JSON.stringify(draft.evidence.filter((entry) => entry.kind === 'opening_hours')),
    ).toHaveLength(6);
    expect(
      draft.evidence.filter((entry) => entry.kind === 'route' && entry.status === 'verified'),
    ).toHaveLength(3);
    expect(JSON.stringify(draft)).not.toContain('openingPeriods');
    expect(JSON.stringify(draft)).not.toContain('rating');
  }
  // Scoring rides on the evidence above and must not move a single count: every
  // provider assertion in this test is the guard, so a score that fetched
  // anything of its own would break them rather than this block.
  for (const planScore of planScores) {
    expect(planScore.generatedAt).toBe('2026-09-02T12:00:00.000Z');
    expect(planScore.evidenceAsOf).toBe('2026-09-02T12:00:00.000Z');
    expect(planScore.days.map((day) => day.dayId)).toEqual(drafts[0]!.days.map((day) => day.date));
    expect(planScore.score).not.toBeNull();
    for (const day of planScore.days) {
      expect(day.factors.FEASIBILITY.state).not.toBe('UNKNOWN');
      expect(day.factors.ROUTE_EFFICIENCY.state).not.toBe('UNKNOWN');
      // The rating arrives free on the same response the hours came from; the
      // rest of the sparse experience row is filled low (rubric 12).
      expect(day.factors.EXPERIENCE_QUALITY.state).toBe('EVALUATED');
    }
    // Derived from the plan, never a copy of the mutable evidence behind it.
    expect(JSON.stringify(planScore)).not.toContain('openingPeriods');
  }

  expect(drafts[2]!.places).toEqual(drafts[0]!.places);
  expect(drafts[2]!.evidence.filter((entry) => entry.kind === 'identity')).toEqual(
    drafts[0]!.evidence.filter((entry) => entry.kind === 'identity'),
  );

  // Opening a generated venue reuses all metadata from Text Search across instances.
  // Only its cover photo incurs a new provider call.
  resetCachedPlacesMemo();
  const venueDetails = await new CachedPlacesService(provider).getDetails({
    externalPlaceId: 'google-candidate:venue0',
    detail: 'evidence',
    purpose: 'details',
  });
  expect(getProviderCallCounts()['google:getDetails'] ?? 0).toBe(0);
  expect(getProviderCallCounts()['google:getPhotoMedia']).toBe(1);
  expect(venueDetails.status === 'ok' && venueDetails.place).toMatchObject({
    websiteUri: 'https://example.com/venue',
    internationalPhoneNumber: '+81 3 1234 5678',
    priceLevel: 2,
    photos: [
      { uri: 'https://lh3.googleusercontent.com/venue-cover' },
      { uri: null },
      { uri: null },
    ],
  });

  // Drop just one decision: mixed new/cached targets still cost one call each.
  groundingMappings.delete(
    [...groundingMappings].find(
      ([, row]) => row.placeProviderRefId === providerRefs.get('google-candidate:venue0')?.id,
    )![0],
  );
  resetCachedPlacesMemo();
  const previousSearches = getProviderCallCounts()['google:textSearch']!;
  const previousDetails = getProviderCallCounts()['google:getDetails'] ?? 0;
  // Identity snapshots have a separate retention policy. Fresh score evidence
  // may be fetched while those identity decisions legitimately keep their age.
  vi.setSystemTime(new Date('2026-09-03T13:00:00Z'));
  await run();
  expect(failures).toEqual([]);
  expect(getProviderCallCounts()['google:textSearch']! - previousSearches).toBe(1);
  expect((getProviderCallCounts()['google:getDetails'] ?? 0) - previousDetails).toBe(0);
  expect(
    drafts[3]!.evidence.some(
      (entry) => entry.kind === 'identity' && entry.checkedAt === '2026-09-02T12:00:00.000Z',
    ),
  ).toBe(true);
  expect(planScores[3]!.evidenceAsOf).toBe('2026-09-02T12:00:00.000Z');
  expect(planScores[3]!.score).not.toBeNull();
  expect(planScores[3]!.sourceInputRevision).toBe(draftPlanScoreInputRevision(drafts[3]!));
  for (const row of groundingMappings.values()) {
    expect(Object.keys(row).sort()).toEqual(['checkedAt', 'key', 'outcome', 'placeProviderRefId']);
  }
  for (const row of providerRefs.values()) {
    expect(row).not.toHaveProperty('rating');
    expect(row).not.toHaveProperty('openingPeriods');
    expect(row).not.toHaveProperty('evidence');
  }
});

test('a persisted negative grounding result avoids another billable search and records its cache hit', async () => {
  const events: ProviderUsageEvent[] = [];
  setProviderUsageSink((event) => events.push(event));
  const provider = new GooglePlacesProvider({
    apiKey: 'test-key',
    source: 'ai-planner',
    fetcher: async () => Response.json({ places: [] }),
  });
  const canonical = {
    async resolveProviderPlaceFromIdentity() {
      throw new Error('must not canonicalise');
    },
  };
  const place = {
    id: 'candidate:missing',
    name: 'Unknown venue',
    searchQuery: 'Unknown venue Singapore',
    note: null,
  };
  const first = await new AiPlaceGrounder(provider, canonical).groundCandidate(place);
  const second = await new AiPlaceGrounder(provider, canonical).groundCandidate({
    ...place,
    id: 'candidate:other-run',
  });
  expect(getProviderCallCounts()['google:textSearch']).toBe(1);
  expect(second.evidence).toMatchObject({
    code: 'place_unresolved',
    checkedAt: first.evidence.checkedAt,
  });
  expect([...groundingMappings.values()]).toEqual([
    expect.objectContaining({ outcome: 'unresolved', placeProviderRefId: null }),
  ]);
  expect(events).toContainEqual({
    cache: 'place-grounding',
    kind: 'negative_cache_hit',
    operation: 'textSearch',
    provider: 'google',
    source: 'ai-planner',
  });
});

test('concurrent rich details across service instances acquire once and persist original evidence age', async () => {
  seedProviderRef('ChIJmuseum');
  const { provider, calls } = countingPlacesProvider();
  const request = { externalPlaceId: 'ChIJmuseum', detail: 'evidence' as const };
  const [a, b] = await Promise.all([
    new CachedPlacesService(provider).getDetails(request),
    new CachedPlacesService(provider).getDetails(request),
  ]);
  expect(calls()).toBe(1);
  expect(a).toEqual(b);
  resetCachedPlacesMemo();
  const c = await new CachedPlacesService(provider).getDetails(request);
  expect(calls()).toBe(1);
  expect(c.status === 'ok' && c.freshness.fetchedAt).toBe(
    a.status === 'ok' && a.freshness.fetchedAt,
  );
});

test('concurrent route acquisition across instances buys one leg', async () => {
  const { provider, calls } = countingRoutesProvider();
  const request: RouteRequest = {
    origin: { latitude: 1, longitude: 2 },
    destination: { latitude: 2, longitude: 3 },
    mode: 'walk',
  };
  const [a, b] = await Promise.all([
    new CachedRoutesService(provider).computeRoute(request),
    new CachedRoutesService(provider).computeRoute(request),
  ]);
  expect(calls()).toBe(1);
  expect(a).toEqual(b);
});

test.each(['saved', 'itinerary'] as const)(
  'explicit %s resolution acquires one rich response and persists both caches for concurrent selections',
  async (purpose) => {
    const now = new Date('2026-09-29T01:00:00Z');
    seedProviderRef('ChIJmuseum');
    const { provider, calls } = countingPlacesProvider();
    const request = {
      externalPlaceId: 'ChIJmuseum',
      detail: 'evidence' as const,
      purpose,
    };
    const [a, b] = await Promise.all([
      new CachedPlacesService(provider, () => now).getDetails(request),
      new CachedPlacesService(provider, () => now).getDetails(request),
    ]);
    expect(calls()).toBe(1);
    expect(a).toEqual(b);
    const row = providerRefs.get('ChIJmuseum') as any;
    expect(row.cachedAt).toEqual(now);
    expect(row.cachedEvidenceAt).toEqual(now);
    expect(row.cachedLatitude.toNumber()).toBe(1.2966);
    resetCachedPlacesMemo();
    await new CachedPlacesService(provider, () => new Date(now.getTime() + DAY_MS)).getDetails(
      request,
    );
    expect(calls()).toBe(1);
    expect(row.cachedAt).toEqual(now);
    expect(row.cachedEvidenceAt).toEqual(now);
    expect(GOOGLE_PLACE_EVIDENCE_FIELD_MASK).toContain(GOOGLE_PLACE_LOCATION_FIELD_MASK);
  },
);

test('an opened sheet buys only its cover; selected photos resolve once and survive reopening', async () => {
  const now = new Date('2026-10-01T00:00:00Z');
  seedProviderRef('ChIJmuseum');
  const { provider, details, media } = photoPlacesProvider();
  const request = {
    detail: 'evidence' as const,
    externalPlaceId: 'ChIJmuseum',
    languageCode: 'en',
    purpose: 'details' as const,
  };

  const [first, concurrent] = await Promise.all([
    new CachedPlacesService(provider, () => now).getDetails(request),
    new CachedPlacesService(provider, () => now).getDetails(request),
  ]);
  expect(details()).toBe(1);
  expect(media()).toBe(1);
  expect(concurrent).toEqual(first);
  expect(first.status === 'ok' && first.place.photos?.map((photo) => photo.uri)).toStrictEqual([
    'https://lh3.googleusercontent.com/places/ChIJmuseum/photos/p1',
    null,
    null,
  ]);

  // Stored with the evidence, at the evidence's own acquisition time.
  const row = providerRefs.get('ChIJmuseum') as unknown as {
    cachedEvidence: ProviderPlaceDetails;
    cachedEvidenceAt: Date;
  };
  expect(row.cachedEvidenceAt).toEqual(now);
  expect(row.cachedEvidence.photos?.filter((photo) => photo.uri !== null)).toHaveLength(1);
  const photoRequest = { ...request, evidenceFetchedAt: now.toISOString() };
  const service = new CachedPlacesService(provider, () => now);
  await Promise.all([
    service.getPhoto({ ...photoRequest, photoId: placePhotoId('places/ChIJmuseum/photos/p2') }),
    new CachedPlacesService(provider, () => now).getPhoto({
      ...photoRequest,
      photoId: placePhotoId('places/ChIJmuseum/photos/p2'),
    }),
    service.getPhoto({ ...photoRequest, photoId: placePhotoId('places/ChIJmuseum/photos/p3') }),
  ]);
  expect(media()).toBe(3);
  expect(row.cachedEvidence.photos?.every((photo) => photo.uri !== null)).toBe(true);
  expect(row.cachedEvidenceAt).toEqual(now);
  await rememberPlaceEvidence(request, {
    ...(first as Extract<typeof first, { status: 'ok' }>),
    place: {
      ...row.cachedEvidence,
      photos: row.cachedEvidence.photos?.map((photo) => ({ ...photo, uri: null })),
    },
  });
  expect(row.cachedEvidence.photos?.every((photo) => photo.uri !== null)).toBe(true);

  resetCachedPlacesMemo();
  const later = new Date(now.getTime() + 29 * DAY_MS);
  const reopened = await new CachedPlacesService(provider, () => later).getDetails(request);
  expect(details()).toBe(1);
  expect(media()).toBe(3);
  expect(reopened.status === 'ok' && reopened.freshness).toStrictEqual({
    fetchedAt: now.toISOString(),
    source: 'cache',
  });
  expect(reopened.status === 'ok' && reopened.place).toEqual(row.cachedEvidence);
  expect(row.cachedEvidenceAt).toEqual(now);
  expect(getProviderCallCounts()['google:getPhotoMedia']).toBe(3);
});

test('only an opened sheet buys photo images; every other evidence reader buys none', async () => {
  const now = new Date('2026-10-01T00:00:00Z');
  seedProviderRef('ChIJmuseum');
  const { provider, details, media } = photoPlacesProvider();
  const base = { detail: 'evidence' as const, externalPlaceId: 'ChIJmuseum', languageCode: 'en' };

  // Itinerary selection acquires the evidence, photo references included.
  await new CachedPlacesService(provider, () => now).getDetails({
    ...base,
    purpose: 'itinerary',
  });
  await new CachedPlacesService(provider, () => now).getDetails(base);
  expect(details()).toBe(1);
  expect(media()).toBe(0);

  // The sheet reuses that answer and only buys the images.
  await new CachedPlacesService(provider, () => now).getDetails({ ...base, purpose: 'details' });
  expect(details()).toBe(1);
  expect(media()).toBe(1);
});

test('legacy incomplete evidence enriches once on explicit selection, then the sheet reuses it', async () => {
  const now = new Date('2026-10-01T00:00:00Z');
  seedProviderRef('ChIJmuseum');
  const request = { externalPlaceId: 'ChIJmuseum', languageCode: 'en' };
  await rememberPlaceEvidence(request, {
    freshness: { fetchedAt: new Date(now.getTime() - DAY_MS).toISOString(), source: 'live' },
    place: detailsFor('ChIJmuseum'),
    provider: 'google',
    status: 'ok',
  });
  resetCachedPlacesMemo();
  const { provider, details, media } = photoPlacesProvider();
  const service = () => new CachedPlacesService(provider, () => now);

  await service().getDetails({ ...request, detail: 'evidence' });
  expect(details()).toBe(0);
  await service().getDetails({ ...request, detail: 'evidence', purpose: 'itinerary' });
  expect(details()).toBe(1);
  expect(media()).toBe(0);

  await service().getDetails({ ...request, detail: 'evidence', purpose: 'details' });
  await service().getDetails({ ...request, detail: 'evidence', purpose: 'details' });
  expect(details()).toBe(1);
  expect(media()).toBe(1);
});

test('failed secondary photos do not trigger retries or adjacent requests on opening', async () => {
  const now = new Date('2026-10-01T00:00:00Z');
  seedProviderRef('ChIJmuseum');
  const { provider, media } = photoPlacesProvider({
    'places/ChIJmuseum/photos/p2': ['not_found'],
    'places/ChIJmuseum/photos/p3': ['unavailable'],
  });
  const request = {
    detail: 'evidence' as const,
    externalPlaceId: 'ChIJmuseum',
    languageCode: 'en',
    purpose: 'details' as const,
  };
  const service = () => new CachedPlacesService(provider, () => now);
  await service().getDetails(request);
  expect(media()).toBe(1);
  const photoRequest = { ...request, evidenceFetchedAt: now.toISOString() };
  await expect(
    service().getPhoto({ ...photoRequest, photoId: placePhotoId('places/ChIJmuseum/photos/p2') }),
  ).resolves.toEqual({ status: 'not_found' });
  await expect(
    service().getPhoto({ ...photoRequest, photoId: placePhotoId('places/ChIJmuseum/photos/p3') }),
  ).resolves.toEqual({ status: 'unavailable' });
  expect(media()).toBe(3);
  resetCachedPlacesMemo();
  await service().getDetails(request);
  expect(media()).toBe(3);
  await expect(
    service().getPhoto({ ...photoRequest, photoId: placePhotoId('places/ChIJmuseum/photos/p3') }),
  ).resolves.toMatchObject({ status: 'ok' });
  expect(media()).toBe(4);
});

test('photo write failures still reuse resolved URLs in the current API instance', async () => {
  const now = new Date('2026-10-01T00:00:00Z');
  seedProviderRef('ChIJmuseum');
  const { provider, media } = photoPlacesProvider();
  const prisma = (globalThis as { trovePrismaClient?: { $queryRaw: () => Promise<unknown> } })
    .trovePrismaClient!;
  const write = vi.spyOn(prisma, '$queryRaw').mockRejectedValue(new Error('Database unavailable'));
  const request = {
    externalPlaceId: 'ChIJmuseum',
    languageCode: 'en',
    detail: 'evidence' as const,
    purpose: 'details' as const,
  };
  const service = () => new CachedPlacesService(provider, () => now);
  try {
    await service().getDetails(request);
    const reopened = await service().getDetails(request);
    expect(media()).toBe(1);
    expect(reopened.status === 'ok' && reopened.place.photos?.[0]?.uri).not.toBeNull();
    const selected = {
      ...request,
      evidenceFetchedAt: now.toISOString(),
      photoId: placePhotoId('places/ChIJmuseum/photos/p2'),
    };
    await service().getPhoto(selected);
    await service().getPhoto(selected);
    expect(media()).toBe(2);
  } finally {
    write.mockRestore();
  }
});

test('unknown, mismatched and expired photo references cost zero provider requests', async () => {
  const now = new Date('2026-10-01T00:00:00Z');
  seedProviderRef('ChIJmuseum');
  const { provider, media, details } = photoPlacesProvider();
  const service = new CachedPlacesService(provider, () => now);
  const request = {
    externalPlaceId: 'ChIJmuseum',
    languageCode: 'en',
    evidenceFetchedAt: now.toISOString(),
  };
  await service.getDetails({ ...request, detail: 'evidence', purpose: 'saved' });
  expect(media()).toBe(0);
  await expect(service.getPhoto({ ...request, photoId: '0'.repeat(24) })).resolves.toEqual({
    status: 'not_found',
  });
  const valid = { ...request, photoId: placePhotoId('places/ChIJmuseum/photos/p2') };
  await expect(
    service.getPhoto({ ...valid, evidenceFetchedAt: new Date(now.getTime() - 1).toISOString() }),
  ).resolves.toEqual({ status: 'stale' });
  resetCachedPlacesMemo();
  await expect(
    new CachedPlacesService(provider, () => new Date(now.getTime() + 30 * DAY_MS)).getPhoto(valid),
  ).resolves.toEqual({ status: 'stale' });
  expect(details()).toBe(1);
  expect(media()).toBe(0);
});
