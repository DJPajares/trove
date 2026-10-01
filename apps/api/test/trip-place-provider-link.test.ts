import { beforeEach, expect, test } from 'vitest';

const TRIP_ID = '00000000-0000-4000-8000-000000000001';
const TRIP_PLACE_ID = '00000000-0000-4000-8000-000000000002';
const CUSTOM_PLACE_ID = '00000000-0000-4000-8000-000000000003';
const PROVIDER_PLACE_ID = '00000000-0000-4000-8000-000000000004';
const EXISTING_TRIP_PLACE_ID = '00000000-0000-4000-8000-000000000005';
const USER_ID = 'owner-user-id';

type Where = Record<string, unknown>;
type Call = { data?: Record<string, unknown>; model: string; op: string; where: Where };

let calls: Call[] = [];
/** The located stop, as the ownership-checked read returns it; null when it is not the caller's Custom Place. */
let locatedStop: {
  id: string;
  note: string | null;
  place: { customNote: string | null; id: string };
} | null;
/** A Trip Place this trip already holds for the Google Place, if any. */
let existingProviderTripPlace: { id: string; note: string | null } | null;

const providerPlace = {
  customLatitude: null,
  customLongitude: null,
  customName: null,
  customNote: null,
  customTimeZone: null,
  id: PROVIDER_PLACE_ID,
  kind: 'PROVIDER' as const,
  providerRefs: [{ externalPlaceId: 'ChIJmarble', provider: 'GOOGLE' as const }],
  savedPlaces: [],
};

function record(model: string, op: string, result: unknown = { count: 1 }) {
  return (args: { data?: Record<string, unknown>; where: Where }) => {
    calls.push({ data: args.data, model, op, where: args.where });
    return Promise.resolve(result);
  };
}

const client = {
  $transaction: (run: (transaction: unknown) => Promise<unknown>) => run(client),
  expense: { updateMany: record('expense', 'updateMany') },
  itineraryDay: {
    findMany: () => Promise.resolve([]),
    updateMany: record('itineraryDay', 'updateMany'),
  },
  itineraryItem: { updateMany: record('itineraryItem', 'updateMany') },
  memory: { updateMany: record('memory', 'updateMany') },
  reservation: { updateMany: record('reservation', 'updateMany') },
  trip: {
    findFirst: () => Promise.resolve({ id: TRIP_ID, name: 'Da Nang' }),
    updateMany: record('trip', 'updateMany'),
  },
  tripDestination: {
    findFirst: () => Promise.resolve(null),
    updateMany: record('tripDestination', 'updateMany'),
  },
  tripPlace: {
    delete: record('tripPlace', 'delete'),
    findFirst: (args: { where: Where }) => {
      // The ownership-checked read of the stop being located.
      if ('place' in args.where) return Promise.resolve(locatedStop);
      // Whether the trip already holds the Google Place.
      if (args.where.placeId === PROVIDER_PLACE_ID) {
        return Promise.resolve(existingProviderTripPlace);
      }
      // The re-read of whichever Trip Place the stop now lives on.
      return Promise.resolve({
        _count: { itineraryItems: 1 },
        createdAt: new Date('2026-09-28T00:00:00.000Z'),
        customName: null,
        id: args.where.id,
        note: null,
        place: providerPlace,
        priority: null,
      });
    },
    update: record('tripPlace', 'update'),
  },
};

(globalThis as { trovePrismaClient?: unknown }).trovePrismaClient = client;

const resolved: Array<{ externalPlaceId: string; options: unknown }> = [];
const canonicalPlaces = {
  resolveProviderPlace: (
    _provider: string,
    externalPlaceId: string,
    _label: unknown,
    options: unknown,
  ) => {
    resolved.push({ externalPlaceId, options });
    return Promise.resolve({ id: PROVIDER_PLACE_ID });
  },
} as never;

beforeEach(() => {
  calls = [];
  resolved.length = 0;
  locatedStop = {
    id: TRIP_PLACE_ID,
    note: null,
    place: { customNote: 'Bring a torch for the caves', id: CUSTOM_PLACE_ID },
  };
  existingProviderTripPlace = null;
});

async function link() {
  const { linkTripPlaceToProvider } = await import('../src/services/trip-places.js');
  return linkTripPlaceToProvider(
    USER_ID,
    TRIP_ID,
    TRIP_PLACE_ID,
    { externalPlaceId: 'ChIJmarble', languageCode: 'en' },
    canonicalPlaces,
  );
}

test('the stop is pointed at the Google Place, resolved with its itinerary evidence', async () => {
  const tripPlace = await link();

  expect(resolved).toStrictEqual([
    { externalPlaceId: 'ChIJmarble', options: { languageCode: 'en', purpose: 'itinerary' } },
  ]);
  expect(calls.find((call) => call.model === 'tripPlace' && call.op === 'update')).toStrictEqual({
    data: { note: 'Bring a torch for the caves', placeId: PROVIDER_PLACE_ID },
    model: 'tripPlace',
    op: 'update',
    where: { id: TRIP_PLACE_ID },
  });
  expect(calls.some((call) => call.op === 'delete')).toBe(false);
  expect(tripPlace.place.kind).toBe('provider');
});

test("the Trip Place's own note wins over the Custom Place's", async () => {
  locatedStop = { ...locatedStop!, note: 'Go before the tour buses' };

  await link();

  expect(
    calls.find((call) => call.model === 'tripPlace' && call.op === 'update')?.data,
  ).toStrictEqual({ placeId: PROVIDER_PLACE_ID });
});

test('a trip already holding the Google Place folds the stop into it', async () => {
  existingProviderTripPlace = { id: EXISTING_TRIP_PLACE_ID, note: null };

  const tripPlace = await link();

  for (const model of ['itineraryItem', 'memory', 'expense', 'reservation']) {
    expect(calls, `${model} must follow the stop`).toContainEqual({
      data: { tripPlaceId: EXISTING_TRIP_PLACE_ID },
      model,
      op: 'updateMany',
      where: { tripId: TRIP_ID, tripPlaceId: TRIP_PLACE_ID },
    });
  }
  expect(calls).toContainEqual({
    data: undefined,
    model: 'tripPlace',
    op: 'delete',
    where: { id: TRIP_PLACE_ID },
  });
  expect(tripPlace.id).toBe(EXISTING_TRIP_PLACE_ID);
});

test("the trip's own references to the Custom Place move with it", async () => {
  await link();

  expect(calls).toContainEqual({
    data: { placeId: PROVIDER_PLACE_ID },
    model: 'tripDestination',
    op: 'updateMany',
    where: { placeId: CUSTOM_PLACE_ID, tripId: TRIP_ID },
  });
  expect(calls).toContainEqual({
    data: { startingPlaceId: PROVIDER_PLACE_ID },
    model: 'trip',
    op: 'updateMany',
    where: { id: TRIP_ID, startingPlaceId: CUSTOM_PLACE_ID },
  });
});

test('a stop that is not the caller’s Custom Place is refused before Google is asked', async () => {
  locatedStop = null;

  await expect(link()).rejects.toThrow('trip_place_not_found');
  expect(resolved).toHaveLength(0);
  expect(calls).toHaveLength(0);
});
