import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import Fastify from 'fastify';
import { beforeEach, expect, test } from 'vitest';

import { listPublicItinerary, PublicTripNotFoundError } from '../src/services/public-itinerary.js';
import { hydratePlaceSnapshots, resetFailedPlaceHydrations } from '../src/services/place-data.js';
import type { PlacesService } from '../src/services/places.js';
import { registerPublicTripRoutes } from '../src/routes/public-trips.js';

/**
 * The shared itinerary is the only route in Trove anybody can reach without an
 * account, so the two things worth guarding are the two a mistake would be
 * expensive in: what it lets out, and what it can be made to spend.
 */

const PUBLIC_TRIP_ID = '11111111-1111-4111-8111-111111111111';
const PRIVATE_TRIP_ID = '22222222-2222-4222-8222-222222222222';
const EXTERNAL_PLACE_ID = 'places/shared-museum';

/** A snapshot far past the 30-day ceiling, which is when a refresh would be due. */
const LONG_STALE = new Date(Date.now() - 400 * 24 * 60 * 60 * 1_000);

let detailsCalls = 0;

/** Counts what a provider would have been asked, without answering anything. */
const spyPlacesService = {
  getDetails: async () => {
    detailsCalls += 1;
    return { status: 'unavailable' as const };
  },
} as unknown as PlacesService;

function providerRef(overrides: Record<string, unknown> = {}) {
  return {
    cachedAt: LONG_STALE,
    cachedFormattedAddress: '1 Museum Way',
    cachedGoogleMapsUri: null,
    cachedLanguageCode: 'en',
    cachedLatitude: { toNumber: () => 1 },
    cachedLongitude: { toNumber: () => 2 },
    cachedName: 'The Museum',
    cachedPrimaryType: 'museum',
    cachedTypes: ['museum'],
    cachedUtcOffsetMinutes: 0,
    detailsFailedAt: null,
    detailsFailureCode: null,
    externalPlaceId: EXTERNAL_PLACE_ID,
    provider: 'GOOGLE',
    ...overrides,
  };
}

function tripFixture(visibility: 'PRIVATE' | 'PUBLIC') {
  return {
    endDate: new Date('2026-05-03T00:00:00.000Z'),
    id: visibility === 'PUBLIC' ? PUBLIC_TRIP_ID : PRIVATE_TRIP_ID,
    name: 'Kyoto in spring',
    startDate: new Date('2026-05-01T00:00:00.000Z'),
    visibility,
    itineraryDays: [
      {
        date: new Date('2026-05-01T00:00:00.000Z'),
        id: 'day-1',
        name: 'Arrival',
        notes: 'Drop bags first.',
        items: [
          {
            customLabel: null,
            customLocation: null,
            dayPart: 'MORNING',
            durationMinutes: 90,
            id: 'item-1',
            localEndTime: null,
            localStartTime: new Date(Date.UTC(2000, 0, 1, 10, 30)),
            notes: 'Book ahead.',
            plannedCostAmount: { toFixed: () => '42.00' },
            plannedCostCurrencyCode: 'JPY',
            position: 0,
            priority: 'MUST_GO',
            travelStatus: 'UPCOMING',
            tripPlace: {
              customName: null,
              id: 'trip-place-1',
              place: {
                customLatitude: null,
                customLongitude: null,
                customName: null,
                customNote: null,
                customTimeZone: null,
                id: 'place-1',
                kind: 'PROVIDER',
                providerAddress: '1 Museum Way',
                providerLabel: 'Museum',
                providerRefs: [providerRef()],
              },
            },
          },
        ],
      },
    ],
  };
}

let trips: ReturnType<typeof tripFixture>[] = [];

beforeEach(() => {
  detailsCalls = 0;
  resetFailedPlaceHydrations();
  trips = [tripFixture('PUBLIC'), tripFixture('PRIVATE')];

  (globalThis as { trovePrismaClient?: unknown }).trovePrismaClient = {
    placeProviderRef: {
      findMany: async (args: { where: { externalPlaceId: { in: string[] } } }) =>
        args.where.externalPlaceId.in.includes(EXTERNAL_PLACE_ID) ? [providerRef()] : [],
    },
    trip: {
      findFirst: async (args: { where: Record<string, unknown> }) =>
        trips.find(
          (trip) => trip.id === args.where.id && trip.visibility === args.where.visibility,
        ) ?? null,
    },
  };
});

test('a shared trip renders its days in travel order', async () => {
  const itinerary = await listPublicItinerary(PUBLIC_TRIP_ID);

  expect(itinerary.trip).toStrictEqual({
    endDate: '2026-05-03',
    id: PUBLIC_TRIP_ID,
    name: 'Kyoto in spring',
    startDate: '2026-05-01',
  });
  expect(itinerary.days).toHaveLength(1);
  expect(itinerary.days[0]?.items[0]).toMatchObject({
    dayPart: 'morning',
    durationMinutes: 90,
    localStartTime: '10:30',
    // Resolved from the snapshot the database already held, stale or not.
    name: 'The Museum',
  });
});

/**
 * A private trip and a trip that never existed have to be indistinguishable, or
 * the endpoint becomes a way to learn which trip ids are real.
 */
test('a private trip is as absent as one that never existed', async () => {
  await expect(listPublicItinerary(PRIVATE_TRIP_ID)).rejects.toBeInstanceOf(
    PublicTripNotFoundError,
  );
  await expect(listPublicItinerary('33333333-3333-4333-8333-333333333333')).rejects.toBeInstanceOf(
    PublicTripNotFoundError,
  );
});

/**
 * The private half of a plan. Sharing a serializer with `listItinerary` would
 * have made every one of these public by default, which is why the public shape
 * is written out separately.
 */
test('what the owner keeps to themselves stays with them', async () => {
  const itinerary = await listPublicItinerary(PUBLIC_TRIP_ID);
  const item = itinerary.days[0]?.items[0] as Record<string, unknown>;

  for (const field of [
    'plannedCost',
    'priority',
    'travelStatus',
    'position',
    'tripPlace',
    'location',
    'providerRefs',
  ]) {
    expect(item, `a shared itinerary must not carry ${field}`).not.toHaveProperty(field);
  }
  expect(JSON.stringify(itinerary)).not.toContain(EXTERNAL_PLACE_ID);
});

/**
 * The one that matters most. A shared link is opened by strangers, repeatedly,
 * on trips nobody is maintaining any more, so a stale snapshot must resolve from
 * the database rather than becoming a billed Google call per visit.
 *
 * The first half is what keeps the second from passing vacuously: the same
 * fixture, handed to the ordinary hydration path, does ask the provider. So the
 * zero below is the public path declining a refresh that was genuinely due,
 * rather than a snapshot that was never stale to begin with.
 */
test('a stale snapshot is served, never refreshed', async () => {
  await hydratePlaceSnapshots([EXTERNAL_PLACE_ID], { placesService: spyPlacesService });
  expect(detailsCalls, 'the fixture must be stale enough to be worth refreshing').toBe(1);

  detailsCalls = 0;
  resetFailedPlaceHydrations();

  const itinerary = await listPublicItinerary(PUBLIC_TRIP_ID);

  expect(itinerary.days[0]?.items[0]?.name).toBe('The Museum');
  expect(detailsCalls, 'the public itinerary must not reach a provider').toBe(0);
});

/**
 * Registered the way the app registers them, so this fails if the route ever
 * grows a `preHandler` or the registration is dropped - the wiring is the
 * feature here, not just the service behind it.
 */
async function publicApp() {
  const app = Fastify();
  registerPublicTripRoutes(app);
  await app.ready();
  return app;
}

test('the shared itinerary answers with no credentials at all', async () => {
  const app = await publicApp();

  const response = await app.inject({
    method: 'GET',
    url: `/public/trips/${PUBLIC_TRIP_ID}/itinerary`,
  });

  expect(response.statusCode, 'no Authorization header, and none required').toBe(200);
  expect(response.json().trip.name).toBe('Kyoto in spring');
  // Not a caching preference to tune later. Turning the switch off is a traveller
  // taking their plan back, and any window here is a window in which the link
  // they revoked still works.
  expect(response.headers['cache-control']).toBe('no-store');

  await app.close();
});

/**
 * Three ways of not being a shared trip, one answer. Any difference between them
 * - a status, a body, even a length - would let a stranger sort real trip ids
 * from invented ones.
 */
test('every way of not finding a trip looks the same', async () => {
  const app = await publicApp();

  const responses = await Promise.all(
    [PRIVATE_TRIP_ID, '33333333-3333-4333-8333-333333333333', 'not-a-uuid'].map((tripId) =>
      app.inject({ method: 'GET', url: `/public/trips/${tripId}/itinerary` }),
    ),
  );

  for (const response of responses) {
    expect(response.statusCode).toBe(404);
    expect(response.json()).toStrictEqual({ code: 'trip_not_found' });
    // The mirror of the 200's rule: a held 404 would keep a trip shared a moment
    // ago reading as private to the people it was just sent to.
    expect(response.headers['cache-control']).toBe('no-store');
  }

  await app.close();
});

/**
 * The schema said a trip could be `public` and the database said otherwise:
 * `trips_owner_only_visibility` pinned every row to `private` while visibility
 * was scaffolding nothing read, so the first write of a real value failed as a
 * 500 that no unit test could see - the fake Prisma client has no constraints to
 * violate.
 *
 * Reading the migrations is the only place that gap is visible without a live
 * database. It asserts what the service can write is what the table will accept.
 */
test('the database accepts every visibility the API can write', () => {
  const directory = new URL('../../../packages/db/prisma/migrations/', import.meta.url);
  const sql = readdirSync(fileURLToPath(directory))
    .filter((entry) => !entry.endsWith('.toml'))
    .sort()
    .map((entry) =>
      readFileSync(fileURLToPath(new URL(`${entry}/migration.sql`, directory)), 'utf8'),
    )
    .join('\n');

  // The last word on the column, whichever migration had it.
  const constraint = [...sql.matchAll(/CHECK \(\s*"visibility"([^)]*)\)/g)].at(-1)?.[1];
  if (constraint === undefined) throw new Error('no visibility CHECK constraint in any migration');

  expect(sql, 'the owner-only constraint must be dropped, not left in place').toContain(
    'DROP CONSTRAINT "trips_owner_only_visibility"',
  );
  // `updateTripVisibility` writes exactly these two, so the table must take both.
  expect(constraint).toContain("'private'");
  expect(constraint).toContain("'public'");
  // `shared` is for collaborators nothing implements; the database still refuses it.
  expect(constraint).not.toContain("'shared'");
});
