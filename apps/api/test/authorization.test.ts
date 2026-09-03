import { expect, test } from 'vitest';

type RecordedQuery = { args: Record<string, unknown>; method: string; model: string };

const recorded: RecordedQuery[] = [];

const emptyResults: Record<string, unknown> = {
  aggregate: {},
  count: 0,
  deleteMany: { count: 0 },
  findFirst: null,
  findMany: [],
  findUnique: null,
  updateMany: { count: 0 },
};

/**
 * Records every query a service issues and answers as if nothing matched, which is what
 * the database returns when an owner-scoped filter excludes another user's rows.
 */
function createRecordingPrismaClient() {
  return new Proxy(
    {},
    {
      get(_target, model: string) {
        if (model === '$transaction') {
          return async (operations: unknown) =>
            typeof operations === 'function'
              ? (operations as (client: unknown) => unknown)(createRecordingPrismaClient())
              : Promise.all(operations as Promise<unknown>[]);
        }
        // Raw escapes (the `SELECT ... FOR UPDATE` owner lock) are calls on the
        // client itself rather than on a model, and are recorded the same way so
        // an ownership filter smuggled into raw SQL is still visible here.
        if (model.startsWith('$')) {
          return (...args: unknown[]) => {
            recorded.push({ args: { raw: args }, method: model, model: '$raw' });
            return Promise.resolve([]);
          };
        }
        return new Proxy(
          {},
          {
            get(_modelTarget, method: string) {
              return (args: Record<string, unknown> = {}) => {
                recorded.push({ args, method, model });
                return Promise.resolve(method in emptyResults ? emptyResults[method] : null);
              };
            },
          },
        );
      },
    },
  );
}

(globalThis as { trovePrismaClient?: unknown }).trovePrismaClient = createRecordingPrismaClient();

const OWNER_TRIP_ID = 'trip-owned-by-someone-else';
const INTRUDER_ID = 'intruder-user-id';

/** Walks a Prisma `where` clause looking for an ownership constraint bound to `userId`. */
function isScopedToUser(value: unknown, userId: string): boolean {
  if (Array.isArray(value)) return value.some((entry) => isScopedToUser(entry, userId));
  if (!value || typeof value !== 'object') return false;

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'ownerId' && nested === userId) return true;
    if (isScopedToUser(nested, userId)) return true;
  }
  return false;
}

async function assertDeniesCrossUserAccess(label: string, call: () => Promise<unknown>) {
  recorded.length = 0;

  await expect(
    call,
    `${label} must reject when the trip belongs to another user`,
  ).rejects.toSatisfy((error: unknown) => error instanceof Error);

  const [firstQuery] = recorded;
  expect(firstQuery, `${label} must consult the database before answering`).toBeTruthy();
  expect(
    isScopedToUser(firstQuery!.args.where, INTRUDER_ID),
    `${label} must scope its first query to the requesting user, got ${JSON.stringify(
      firstQuery!.args.where,
    )}`,
  ).toBeTruthy();
}

test('trip-scoped reads reject another user and never query without an ownership filter', async () => {
  const { listItinerary } = await import('../src/services/itineraries.js');
  const { listExpenses } = await import('../src/services/expenses.js');
  const { listTasks } = await import('../src/services/tasks.js');
  const { listTripInfo } = await import('../src/services/trip-info.js');
  const { listTripPlaces } = await import('../src/services/trip-places.js');
  const { listReservations } = await import('../src/services/reservations.js');
  const { getTrip } = await import('../src/services/trips.js');
  const { TripWeatherService } = await import('../src/services/trip-weather.js');

  await assertDeniesCrossUserAccess('listItinerary', () =>
    listItinerary(INTRUDER_ID, OWNER_TRIP_ID),
  );
  await assertDeniesCrossUserAccess('listExpenses', () => listExpenses(INTRUDER_ID, OWNER_TRIP_ID));
  await assertDeniesCrossUserAccess('listTasks', () => listTasks(INTRUDER_ID, OWNER_TRIP_ID));
  await assertDeniesCrossUserAccess('listTripInfo', () => listTripInfo(INTRUDER_ID, OWNER_TRIP_ID));
  await assertDeniesCrossUserAccess('listTripPlaces', () =>
    listTripPlaces(INTRUDER_ID, OWNER_TRIP_ID),
  );
  await assertDeniesCrossUserAccess('listReservations', () =>
    listReservations(INTRUDER_ID, OWNER_TRIP_ID, null),
  );
  await assertDeniesCrossUserAccess('getTrip', () => getTrip(INTRUDER_ID, '', OWNER_TRIP_ID));
  await assertDeniesCrossUserAccess('getTripWeather', () =>
    new TripWeatherService().getTripWeather(INTRUDER_ID, OWNER_TRIP_ID, {
      temperatureUnit: 'celsius',
    }),
  );
});

const OTHER_SESSION_ID = '00000000-0000-4000-8000-000000000001';

const WRITE_METHODS = new Set(['create', 'delete', 'deleteMany', 'update', 'updateMany', 'upsert']);

/**
 * Every AI planning entry point must answer for another user's session exactly
 * as it answers for one that never existed. A distinct "forbidden" would confirm
 * the session id, so `session_not_found` is the boundary, and the lookup that
 * reaches that verdict has to carry the requesting user's `ownerId` - a query
 * that finds the row first and compares afterwards is one refactor away from
 * leaking it.
 *
 * The owner Profile upsert that these paths take to lock the dispatch counter is
 * deliberately allowed: it writes a row keyed to the *requesting* user, never to
 * the owner of the session being probed.
 */
async function assertHidesAnotherUsersSession(label: string, call: () => Promise<unknown>) {
  recorded.length = 0;

  await expect(
    call,
    `${label} must answer for another user's session as if it did not exist`,
  ).rejects.toSatisfy(
    (error: unknown) =>
      error instanceof Error &&
      (error as { code?: unknown }).code === 'session_not_found' &&
      (error as { statusCode?: unknown }).statusCode === 404,
  );

  const lookups = recorded.filter((query) => query.model === 'aiPlanningSession');
  expect(lookups.length, `${label} must consult the database before answering`).toBeGreaterThan(0);

  const unscoped = lookups.filter((query) => !isScopedToUser(query.args.where, INTRUDER_ID));
  expect(
    unscoped.map((query) => `${query.model}.${query.method}: ${JSON.stringify(query.args.where)}`),
    `${label} must scope every session query to the requesting user`,
  ).toStrictEqual([]);

  const escapedWrites = recorded.filter(
    (query) => query.model !== 'profile' && WRITE_METHODS.has(query.method),
  );
  expect(
    escapedWrites.map((query) => `${query.model}.${query.method}`),
    `${label} must not write anything for a session it cannot see`,
  ).toStrictEqual([]);
}

test('every AI planning entry point hides another user behind the not-found boundary', async () => {
  const {
    acknowledgeAiPlanningWarnings,
    cancelAiPlanningSession,
    getAiPlanningSession,
    regenerateAiPlanningSession,
    setAiPlanningTripDescription,
    setAiPlanningTripName,
  } = await import('../src/services/ai-planning-sessions.js');
  const { applyAiPlanningSession } = await import('../src/services/ai-planning-apply.js');

  await assertHidesAnotherUsersSession('getAiPlanningSession', () =>
    getAiPlanningSession(INTRUDER_ID, OTHER_SESSION_ID),
  );
  await assertHidesAnotherUsersSession('setAiPlanningTripDescription', () =>
    setAiPlanningTripDescription(INTRUDER_ID, OTHER_SESSION_ID, 'intruding description'),
  );
  await assertHidesAnotherUsersSession('setAiPlanningTripName', () =>
    setAiPlanningTripName(INTRUDER_ID, OTHER_SESSION_ID, 'intruding name'),
  );
  await assertHidesAnotherUsersSession('regenerateAiPlanningSession', () =>
    regenerateAiPlanningSession(INTRUDER_ID, OTHER_SESSION_ID, 'three days in Tokyo', 0, 'key'),
  );
  await assertHidesAnotherUsersSession('acknowledgeAiPlanningWarnings', () =>
    acknowledgeAiPlanningWarnings(INTRUDER_ID, OTHER_SESSION_ID, 0),
  );
  await assertHidesAnotherUsersSession('cancelAiPlanningSession', () =>
    cancelAiPlanningSession(INTRUDER_ID, OTHER_SESSION_ID),
  );
  await assertHidesAnotherUsersSession('applyAiPlanningSession', () =>
    applyAiPlanningSession(INTRUDER_ID, OTHER_SESSION_ID, 0, 'UTC'),
  );
});

test("AI planning recovery returns nothing rather than another user's session", async () => {
  const { recoverLatestAiPlanningSession } =
    await import('../src/services/ai-planning-sessions.js');

  recorded.length = 0;
  await expect(recoverLatestAiPlanningSession(INTRUDER_ID)).resolves.toBeNull();

  const lookups = recorded.filter((query) => query.model === 'aiPlanningSession');
  expect(lookups.length, 'recovery must query the database').toBeGreaterThan(0);
  expect(
    lookups.filter((query) => !isScopedToUser(query.args.where, INTRUDER_ID)),
    'recovery must scope every session query to the requesting user',
  ).toStrictEqual([]);
});

test('trip-scoped mutations reject another user before writing', async () => {
  const { addTripPlace, removeTripPlace, updateTripPlace } =
    await import('../src/services/trip-places.js');
  const { createTripInfo } = await import('../src/services/trip-info.js');
  const { updateItineraryDayName, updateItineraryDayNote } =
    await import('../src/services/itineraries.js');

  await assertDeniesCrossUserAccess('addTripPlace', () =>
    addTripPlace(INTRUDER_ID, OWNER_TRIP_ID, 'place-id'),
  );
  await assertDeniesCrossUserAccess('updateTripPlace', () =>
    updateTripPlace(INTRUDER_ID, OWNER_TRIP_ID, 'trip-place-id', { note: 'intruding' }),
  );
  await assertDeniesCrossUserAccess('removeTripPlace', () =>
    removeTripPlace(INTRUDER_ID, OWNER_TRIP_ID, 'trip-place-id'),
  );
  await assertDeniesCrossUserAccess('createTripInfo', () =>
    createTripInfo(INTRUDER_ID, OWNER_TRIP_ID, {
      category: 'other',
      label: 'Intruding',
      value: 'value',
    }),
  );
  await assertDeniesCrossUserAccess('updateItineraryDayNote', () =>
    updateItineraryDayNote(INTRUDER_ID, OWNER_TRIP_ID, 'day-id', 'note'),
  );
  await assertDeniesCrossUserAccess('updateItineraryDayName', () =>
    updateItineraryDayName(INTRUDER_ID, OWNER_TRIP_ID, 'day-id', 'named day'),
  );

  const writeMethods = new Set([
    'create',
    'delete',
    'deleteMany',
    'update',
    'updateMany',
    'upsert',
  ]);
  expect(
    recorded.filter((query) => writeMethods.has(query.method)),
    'a rejected cross-user mutation must not reach a write',
  ).toStrictEqual([]);
});

test('global search only reads rows owned by the searching user', async () => {
  const { searchTrove } = await import('../src/services/search.js');

  recorded.length = 0;
  const results = await searchTrove(INTRUDER_ID, 'tokyo');

  expect(results.groups, 'no owned rows means no results').toStrictEqual([]);
  expect(recorded.length > 0, 'search must query the database').toBeTruthy();

  const unscoped = recorded.filter((query) => !isScopedToUser(query.args.where, INTRUDER_ID));
  expect(
    unscoped.map((query) => `${query.model}.${query.method}`),
    'every search query must be scoped to the searching user',
  ).toStrictEqual([]);
});
