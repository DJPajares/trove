export type Row = Record<string, unknown>;
export type Where = Record<string, unknown> | undefined;

export type ModelName =
  | 'expense'
  | 'itineraryDay'
  | 'itineraryItem'
  | 'memory'
  | 'memoryPhoto'
  | 'place'
  | 'reservation'
  | 'task'
  | 'trip'
  | 'tripPlace';

const MODELS: ModelName[] = [
  'expense',
  'itineraryDay',
  'itineraryItem',
  'memory',
  'memoryPhoto',
  'place',
  'reservation',
  'task',
  'trip',
  'tripPlace',
];

export const store: Record<ModelName, Row[]> = Object.fromEntries(
  MODELS.map((name) => [name, [] as Row[]]),
) as Record<ModelName, Row[]>;

export function resetStore() {
  for (const name of MODELS) store[name] = [];
}

/** The filter shapes the services actually use: equality, `in`, `not`, `OR`, and relation hops. */
function matches(row: Row, where: Where): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') {
      return (value as Where[]).some((clause) => matches(row, clause));
    }
    if (key === 'memory') {
      const owner = store.memory.find((candidate) => candidate.id === row.memoryId);
      return owner ? matches(owner, value as Where) : false;
    }
    if (key === 'trip') {
      const owner = store.trip.find((candidate) => candidate.id === row.tripId);
      return owner ? matches(owner, value as Where) : false;
    }
    if (value && typeof value === 'object' && 'in' in value) {
      return (value as { in: unknown[] }).in.includes(row[key]);
    }
    // `not` excludes one row from a set, which is how a reorder reads the
    // siblings of the item being placed.
    if (value && typeof value === 'object' && 'not' in value) {
      return row[key] !== (value as { not: unknown }).not;
    }
    return row[key] === value;
  });
}

function hydrateTripPlace(row: Row | undefined) {
  if (!row) return null;
  return {
    ...row,
    _count: {
      dailyBaseForDays: store.itineraryDay.filter((day) => day.dailyBaseTripPlaceId === row.id)
        .length,
      itineraryItems: store.itineraryItem.filter((item) => item.tripPlaceId === row.id).length,
      timeZoneSourceForDays: store.itineraryDay.filter(
        (day) => day.defaultTimeZoneSourceTripPlaceId === row.id,
      ).length,
    },
    place: store.place.find((candidate) => candidate.id === row.placeId) ?? null,
  };
}

function hydrateItem(row: Row) {
  return {
    ...row,
    // `itineraryItemInclude` selects the day's date and zone, which the update
    // path reads to re-resolve a schedule.
    itineraryDay: store.itineraryDay.find((day) => day.id === row.itineraryDayId) ?? null,
    tripPlace: hydrateTripPlace(store.tripPlace.find((place) => place.id === row.tripPlaceId)),
  };
}

/** Returns rows with their relations attached, which covers every include and select in use. */
function hydrate(name: ModelName, row: Row): Row {
  if (name === 'itineraryItem') return hydrateItem(row);
  if (name === 'itineraryDay') {
    return {
      ...row,
      accommodationReservations: [],
      dailyBaseTripPlace: hydrateTripPlace(
        store.tripPlace.find((place) => place.id === row.dailyBaseTripPlaceId),
      ),
      items: store.itineraryItem
        .filter((item) => item.itineraryDayId === row.id)
        .sort((left, right) => Number(left.position) - Number(right.position))
        .map(hydrateItem),
      trip: store.trip.find((trip) => trip.id === row.tripId) ?? null,
      _count: {
        items: store.itineraryItem.filter((item) => item.itineraryDayId === row.id).length,
      },
    };
  }
  if (name === 'memory') {
    return {
      ...row,
      itineraryDay: store.itineraryDay.find((day) => day.id === row.itineraryDayId) ?? null,
      itineraryItem: store.itineraryItem.find((item) => item.id === row.itineraryItemId) ?? null,
      photos: store.memoryPhoto
        .filter((photo) => photo.memoryId === row.id)
        .sort((left, right) => Number(left.position) - Number(right.position))
        .map((photo) => ({ ...photo })),
      tripPlace: hydrateTripPlace(
        store.tripPlace.find((tripPlace) => tripPlace.id === row.tripPlaceId),
      ),
    };
  }
  if (name === 'tripPlace') return hydrateTripPlace(row) as Row;
  if (name === 'trip') {
    return {
      ...row,
      _count: { memories: store.memory.filter((memory) => memory.tripId === row.id).length },
      destinations: [],
      memories: store.memory
        .filter((memory) => memory.tripId === row.id)
        .map((memory) => ({
          photos: store.memoryPhoto.filter((photo) => photo.memoryId === memory.id),
        })),
      owner: { homePlace: null },
      startingPlace: null,
      storyCoverPhoto:
        store.memoryPhoto.find((photo) => photo.id === row.storyCoverMemoryPhotoId) ?? null,
    };
  }
  return { ...row };
}

/**
 * Memories, tasks, expenses, and reservations all hold `ON DELETE NO ACTION` keys
 * to the day, item, and Place they were filed against, so the database refuses to
 * delete any of those while a row still points at one. Enforcing it here is what
 * keeps a test of "detach before deleting" from passing vacuously.
 */
function assertNoBlockingReference(name: ModelName, row: Row) {
  const foreignKey: Partial<Record<ModelName, string>> = {
    itineraryDay: 'itineraryDayId',
    itineraryItem: 'itineraryItemId',
    tripPlace: 'tripPlaceId',
  };
  const key = foreignKey[name];
  if (!key) return;

  for (const referencing of ['expense', 'memory', 'reservation', 'task'] as const) {
    if (store[referencing].some((candidate) => candidate[key] === row.id)) {
      throw new Error(`${referencing}s_${key}_fkey`);
    }
  }
}

/** Reassigns rather than splices, so a cascade can iterate the array it is emptying. */
function removeRow(name: ModelName, row: Row) {
  store[name] = store[name].filter((candidate) => candidate !== row);
  if (name === 'memoryPhoto') {
    for (const trip of store.trip) {
      if (trip.storyCoverMemoryPhotoId === row.id) trip.storyCoverMemoryPhotoId = null;
    }
  }
  if (name === 'memory') {
    for (const photo of store.memoryPhoto) {
      if (photo.memoryId === row.id) removeRow('memoryPhoto', photo);
    }
  }
  if (name === 'trip') {
    for (const memory of store.memory) {
      if (memory.tripId === row.id) removeRow('memory', memory);
    }
  }
}

function sortRows(rows: Row[], orderBy: unknown) {
  const clauses = (Array.isArray(orderBy) ? orderBy : [orderBy]).filter(
    (clause): clause is Record<string, string> => Boolean(clause) && typeof clause === 'object',
  );
  return [...rows].sort((left, right) => {
    for (const clause of clauses) {
      for (const [field, direction] of Object.entries(clause)) {
        const a = left[field];
        const b = right[field];
        const compared = a === b ? 0 : (a as never) < (b as never) ? -1 : 1;
        if (compared !== 0) return direction === 'desc' ? -compared : compared;
      }
    }
    return 0;
  });
}

let nextRowId = 0;

function createModel(name: ModelName) {
  return {
    aggregate: async (args: { _max?: Record<string, true>; where?: Where }) => {
      const selected = store[name].filter((row) => matches(row, args.where));
      const max: Record<string, number | null> = {};
      for (const field of Object.keys(args._max ?? {})) {
        const values = selected
          .map((row) => row[field])
          .filter((value): value is number => typeof value === 'number');
        max[field] = values.length ? Math.max(...values) : null;
      }
      return { _max: max };
    },
    create: async (args: { data: Row }) => {
      nextRowId += 1;
      const row: Row = {
        createdAt: new Date(),
        highlightPosition: null,
        id: `${name}-${nextRowId}`,
        updatedAt: new Date(),
        ...args.data,
      };
      store[name].push(row);
      return hydrate(name, row);
    },
    delete: async (args: { where: { id: string } }) => {
      const row = store[name].find((candidate) => candidate.id === args.where.id);
      if (!row) throw new Error(`${name}_not_found`);
      assertNoBlockingReference(name, row);
      const hydrated = hydrate(name, row);
      removeRow(name, row);
      return hydrated;
    },
    deleteMany: async (args: { where?: Where } = {}) => {
      const rows = store[name].filter((row) => matches(row, args.where));
      for (const row of rows) assertNoBlockingReference(name, row);
      for (const row of rows) removeRow(name, row);
      return { count: rows.length };
    },
    findFirst: async (args: { where?: Where } = {}) => {
      const row = store[name].find((candidate) => matches(candidate, args.where));
      return row ? hydrate(name, row) : null;
    },
    findFirstOrThrow: async (args: { where?: Where } = {}) => {
      const row = store[name].find((candidate) => matches(candidate, args.where));
      if (!row) throw new Error(`${name}_not_found`);
      return hydrate(name, row);
    },
    findMany: async (args: { orderBy?: unknown; where?: Where } = {}) => {
      const rows = store[name].filter((row) => matches(row, args.where));
      return sortRows(rows, args.orderBy).map((row) => hydrate(name, row));
    },
    update: async (args: { data: Row; where: { id: string } }) => {
      const row = store[name].find((candidate) => candidate.id === args.where.id);
      if (!row) throw new Error(`${name}_not_found`);
      Object.assign(row, args.data, { updatedAt: new Date() });
      return hydrate(name, row);
    },
    updateMany: async (args: { data: Row; where?: Where }) => {
      const rows = store[name].filter((row) => matches(row, args.where));
      for (const row of rows) Object.assign(row, args.data);
      return { count: rows.length };
    },
  };
}

export function createFakePrismaClient(): Record<string, unknown> {
  const models = Object.fromEntries(MODELS.map((name) => [name, createModel(name)]));
  return {
    ...models,
    $transaction: async (operations: unknown) =>
      typeof operations === 'function'
        ? (operations as (client: unknown) => unknown)(createFakePrismaClient())
        : Promise.all(operations as Promise<unknown>[]),
  };
}

/** Must run before the first service call, which is when the client is memoised. */
export function installFakePrismaClient() {
  (globalThis as { trovePrismaClient?: unknown }).trovePrismaClient = createFakePrismaClient();
}
