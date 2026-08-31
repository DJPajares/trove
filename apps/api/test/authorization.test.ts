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
});

test('AI planning-session recovery hides another user behind the same not-found boundary', async () => {
  const { getAiPlanningSession } = await import('../src/services/ai-planning-sessions.js');

  await assertDeniesCrossUserAccess('getAiPlanningSession', () =>
    getAiPlanningSession(INTRUDER_ID, '00000000-0000-4000-8000-000000000001'),
  );
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
