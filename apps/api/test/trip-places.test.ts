import Fastify from 'fastify';
import { expect, test } from 'vitest';

const TRIP_ID = '00000000-0000-4000-8000-000000000001';
const TRIP_PLACE_ID = '00000000-0000-4000-8000-000000000002';
const USER_ID = 'owner-user-id';

type RecordedUpdate = { customName?: string | null; note?: string | null };

const updates: RecordedUpdate[] = [];
const upserts: Array<{ create: RecordedUpdate; update: RecordedUpdate }> = [];

/** The row `updateTripPlace` re-reads after writing, shaped as `tripPlaceInclude` asks for it. */
const storedTripPlace = {
  _count: { itineraryItems: 0 },
  createdAt: new Date('2026-08-17T00:00:00.000Z'),
  customName: "Ben's hotel",
  id: TRIP_PLACE_ID,
  note: 'Front desk closes at 22:00',
  place: {
    customLatitude: null,
    customLongitude: null,
    customName: null,
    customNote: null,
    customTimeZone: null,
    id: '00000000-0000-4000-8000-000000000003',
    kind: 'PROVIDER' as const,
    providerRefs: [{ externalPlaceId: 'ChIJhotel', provider: 'GOOGLE' as const }],
    savedPlaces: [],
  },
  priority: null,
};

/**
 * Answers the three queries `updateTripPlace` makes — the ownership check, the write,
 * and the re-read — while keeping every `data` payload for inspection.
 */
function createRecordingPrismaClient() {
  return {
    place: {
      findFirst: () => Promise.resolve({ id: storedTripPlace.place.id }),
    },
    tripPlace: {
      findFirst: () => Promise.resolve(storedTripPlace),
      updateMany: (args: { data: RecordedUpdate }) => {
        updates.push(args.data);
        return Promise.resolve({ count: 1 });
      },
      upsert: (args: { create: RecordedUpdate; update: RecordedUpdate }) => {
        upserts.push({ create: args.create, update: args.update });
        return Promise.resolve(storedTripPlace);
      },
    },
    trip: {
      findFirst: () => Promise.resolve({ id: TRIP_ID, name: 'Aotearoa' }),
    },
  };
}

(globalThis as { trovePrismaClient?: unknown }).trovePrismaClient = createRecordingPrismaClient();

async function buildApp() {
  const { createTripPlacesControllers } = await import('../src/controllers/trip-places.js');
  const controllers = createTripPlacesControllers();
  const app = Fastify();
  app.decorateRequest('authUserId', '');
  app.addHook('onRequest', async (request) => {
    request.authUserId = USER_ID;
  });
  app.patch('/trips/:tripId/places/:tripPlaceId', controllers.updateTripPlace);
  return app;
}

function patch(app: Awaited<ReturnType<typeof buildApp>>, payload: unknown) {
  return app.inject({
    method: 'PATCH',
    payload: payload as Record<string, unknown>,
    url: `/trips/${TRIP_ID}/places/${TRIP_PLACE_ID}`,
  });
}

test('a trip-level rename round-trips and is trimmed on the way in', async () => {
  const { updateTripPlace } = await import('../src/services/trip-places.js');
  updates.length = 0;

  const tripPlace = await updateTripPlace(USER_ID, TRIP_ID, TRIP_PLACE_ID, {
    customName: "  Ben's hotel  ",
  });

  expect(updates).toStrictEqual([{ customName: "Ben's hotel" }]);
  expect(tripPlace.customName).toBe("Ben's hotel");
});

test('clearing the name hands the Place back to its provider', async () => {
  const { updateTripPlace } = await import('../src/services/trip-places.js');

  for (const customName of [null, '', '   ']) {
    updates.length = 0;
    await updateTripPlace(USER_ID, TRIP_ID, TRIP_PLACE_ID, { customName });
    expect(updates, `${JSON.stringify(customName)} must clear`).toStrictEqual([
      { customName: null },
    ]);
  }
});

test('editing only the note leaves an existing rename alone', async () => {
  const { updateTripPlace } = await import('../src/services/trip-places.js');
  updates.length = 0;

  await updateTripPlace(USER_ID, TRIP_ID, TRIP_PLACE_ID, { note: 'Ask for a room upstairs' });

  expect(updates).toStrictEqual([{ note: 'Ask for a room upstairs' }]);
  expect('customName' in updates[0]!, 'an untouched name must not be written').toBe(false);
});

test('a request carrying only a rename is a complete request', async () => {
  const app = await buildApp();

  const response = await patch(app, { customName: 'Airport lounge' });

  expect(response.statusCode).toBe(200);
  expect(
    (response.json() as { tripPlace: { customName: string | null } }).tripPlace.customName,
  ).toBe("Ben's hotel");
});

test('an empty or oversized name is refused rather than stored', async () => {
  const app = await buildApp();

  for (const customName of ['', '   ', 'x'.repeat(201)]) {
    const response = await patch(app, { customName });
    expect(response.statusCode, `${JSON.stringify(customName)} must be refused`).toBe(400);
    expect((response.json() as { code: string }).code).toBe('invalid_trip_place');
  }
});

test('an empty body and an unknown field are both refused', async () => {
  const app = await buildApp();

  expect((await patch(app, {})).statusCode).toBe(400);
  expect((await patch(app, { displayName: 'Airport lounge' })).statusCode).toBe(400);
});

test('a Place can be named as it is added, and re-adding never erases that name', async () => {
  const { addTripPlace } = await import('../src/services/trip-places.js');
  upserts.length = 0;

  await addTripPlace(USER_ID, TRIP_ID, storedTripPlace.place.id, { customName: "  Mum's place  " });
  expect(upserts.at(-1)?.create.customName).toStrictEqual("Mum's place");
  expect(upserts.at(-1)?.update.customName).toStrictEqual("Mum's place");

  // Adding with no name is still idempotent: it must not blank an existing one.
  await addTripPlace(USER_ID, TRIP_ID, storedTripPlace.place.id);
  expect(upserts.at(-1)?.create.customName).toBe(null);
  expect(upserts.at(-1)?.update).toStrictEqual({});
});
