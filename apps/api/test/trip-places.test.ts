import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { test } from 'vitest';

const TRIP_ID = '00000000-0000-4000-8000-000000000001';
const TRIP_PLACE_ID = '00000000-0000-4000-8000-000000000002';
const USER_ID = 'owner-user-id';

type RecordedUpdate = { customName?: string | null; note?: string | null };

const updates: RecordedUpdate[] = [];

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
    tripPlace: {
      findFirst: () => Promise.resolve(storedTripPlace),
      updateMany: (args: { data: RecordedUpdate }) => {
        updates.push(args.data);
        return Promise.resolve({ count: 1 });
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

  assert.deepEqual(updates, [{ customName: "Ben's hotel" }]);
  assert.equal(tripPlace.customName, "Ben's hotel");
});

test('clearing the name hands the Place back to its provider', async () => {
  const { updateTripPlace } = await import('../src/services/trip-places.js');

  for (const customName of [null, '', '   ']) {
    updates.length = 0;
    await updateTripPlace(USER_ID, TRIP_ID, TRIP_PLACE_ID, { customName });
    assert.deepEqual(updates, [{ customName: null }], `${JSON.stringify(customName)} must clear`);
  }
});

test('editing only the note leaves an existing rename alone', async () => {
  const { updateTripPlace } = await import('../src/services/trip-places.js');
  updates.length = 0;

  await updateTripPlace(USER_ID, TRIP_ID, TRIP_PLACE_ID, { note: 'Ask for a room upstairs' });

  assert.deepEqual(updates, [{ note: 'Ask for a room upstairs' }]);
  assert.equal('customName' in updates[0]!, false, 'an untouched name must not be written');
});

test('a request carrying only a rename is a complete request', async () => {
  const app = await buildApp();

  const response = await patch(app, { customName: 'Airport lounge' });

  assert.equal(response.statusCode, 200);
  assert.equal(
    (response.json() as { tripPlace: { customName: string | null } }).tripPlace.customName,
    "Ben's hotel",
  );
});

test('an empty or oversized name is refused rather than stored', async () => {
  const app = await buildApp();

  for (const customName of ['', '   ', 'x'.repeat(201)]) {
    const response = await patch(app, { customName });
    assert.equal(response.statusCode, 400, `${JSON.stringify(customName)} must be refused`);
    assert.equal((response.json() as { code: string }).code, 'invalid_trip_place');
  }
});

test('an empty body and an unknown field are both refused', async () => {
  const app = await buildApp();

  assert.equal((await patch(app, {})).statusCode, 400);
  assert.equal((await patch(app, { displayName: 'Airport lounge' })).statusCode, 400);
});
