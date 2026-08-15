import assert from 'node:assert/strict';
import test from 'node:test';

type Row = Record<string, unknown>;
type Where = Record<string, unknown> | undefined;

type ModelName =
  'itineraryDay' | 'itineraryItem' | 'memory' | 'memoryPhoto' | 'place' | 'trip' | 'tripPlace';

const store: Record<ModelName, Row[]> = {
  itineraryDay: [],
  itineraryItem: [],
  memory: [],
  memoryPhoto: [],
  place: [],
  trip: [],
  tripPlace: [],
};

/**
 * Only the nested filter the Memory services actually use: a photo reached
 * through the Memory that owns it.
 */
function matches(row: Row, where: Where): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => {
    if (key === 'memory') {
      const owner = store.memory.find((candidate) => candidate.id === row.memoryId);
      return owner ? matches(owner, value as Where) : false;
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

/** Returns rows with their relations attached, which covers every include and select in use. */
function hydrate(name: ModelName, row: Row): Row {
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
 * A Memory holds `ON DELETE NO ACTION` keys to its day, item, and Place, so the
 * database refuses to delete any of them while a Memory still points at one.
 */
function assertNoBlockingMemory(name: ModelName, row: Row) {
  const keys: Partial<Record<ModelName, string>> = {
    itineraryDay: 'itineraryDayId',
    itineraryItem: 'itineraryItemId',
    tripPlace: 'tripPlaceId',
  };
  const key = keys[name];
  if (key && store.memory.some((memory) => memory[key] === row.id)) {
    throw new Error(`memories_${key}_fkey`);
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
      assertNoBlockingMemory(name, row);
      const hydrated = hydrate(name, row);
      removeRow(name, row);
      return hydrated;
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

function createFakePrismaClient(): Record<string, unknown> {
  const models = Object.fromEntries(
    (Object.keys(store) as ModelName[]).map((name) => [name, createModel(name)]),
  );
  return {
    ...models,
    $transaction: async (operations: unknown) =>
      typeof operations === 'function'
        ? (operations as (client: unknown) => unknown)(createFakePrismaClient())
        : Promise.all(operations as Promise<unknown>[]),
  };
}

(globalThis as { trovePrismaClient?: unknown }).trovePrismaClient = createFakePrismaClient();

const {
  addMemoryPhoto,
  createMemory,
  deleteMemory,
  deleteMemoryPhoto,
  listMemories,
  MemoryNotFoundError,
  MemoryValidationError,
  reorderHighlights,
  reorderMemoryPhotos,
  setStoryCoverPhoto,
  updateMemory,
} = await import('../src/services/memories.js');
const { removeTripPlace, TripPlaceReferencedError } =
  await import('../src/services/trip-places.js');
const { deleteTrip, getTrip, updateTripExperienceRating } =
  await import('../src/services/trips.js');
const { updateItineraryDayExperienceRating } = await import('../src/services/itineraries.js');

const OWNER = 'owner-user-id';
const INTRUDER = 'intruder-user-id';
const TRIP = 'trip-new-york-to-tokyo';
const OTHER_TRIP = 'trip-owned-by-the-intruder';
const DEPARTURE_DAY = 'itinerary-day-departure';
const ARRIVAL_DAY = 'itinerary-day-arrival';
const YOYOGI = 'trip-place-yoyogi-park';
const KIYOSUMI = 'trip-place-kiyosumi-garden';

/**
 * A trip that crosses the date line: the trip reference and its first day sit in
 * New York, while the Places the traveller visits sit in Tokyo. That is what
 * makes a Place correction able to move a Memory to another calendar day.
 */
function seed() {
  for (const name of Object.keys(store) as ModelName[]) store[name] = [];

  store.trip.push(
    {
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      endDate: new Date('2026-09-12T00:00:00.000Z'),
      experienceNote: null,
      experienceRating: null,
      id: TRIP,
      name: 'New York to Tokyo',
      notes: null,
      ownerId: OWNER,
      partySize: 2,
      planningReadiness: 'READY',
      referenceTimeZone: 'America/New_York',
      referenceTimeZoneSource: 'STARTING_LOCATION',
      startDate: new Date('2026-09-05T00:00:00.000Z'),
      storyCoverMemoryPhotoId: null,
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    },
    {
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      endDate: new Date('2026-09-20T00:00:00.000Z'),
      experienceNote: null,
      experienceRating: null,
      id: OTHER_TRIP,
      name: 'Somebody else’s trip',
      notes: null,
      ownerId: INTRUDER,
      partySize: 1,
      planningReadiness: 'IN_PROGRESS',
      referenceTimeZone: 'Europe/Lisbon',
      referenceTimeZoneSource: 'DESTINATION',
      startDate: new Date('2026-09-15T00:00:00.000Z'),
      storyCoverMemoryPhotoId: null,
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    },
  );

  store.place.push(
    {
      customName: null,
      customTimeZone: 'Asia/Tokyo',
      id: 'place-yoyogi',
      kind: 'PROVIDER',
      providerRefs: [{ externalPlaceId: 'ChIJyoyogi', provider: 'GOOGLE' }],
    },
    {
      customName: 'Kiyosumi Garden',
      customTimeZone: 'Asia/Tokyo',
      id: 'place-kiyosumi',
      kind: 'CUSTOM',
      providerRefs: [],
    },
  );

  store.tripPlace.push(
    { id: YOYOGI, placeId: 'place-yoyogi', tripId: TRIP },
    { id: KIYOSUMI, placeId: 'place-kiyosumi', tripId: TRIP },
  );

  store.itineraryDay.push(
    {
      dailyBaseTripPlaceId: null,
      date: new Date('2026-09-05T00:00:00.000Z'),
      defaultTimeZone: 'America/New_York',
      defaultTimeZoneSourceTripPlaceId: null,
      experienceNote: null,
      experienceRating: null,
      id: DEPARTURE_DAY,
      tripId: TRIP,
    },
    {
      dailyBaseTripPlaceId: null,
      date: new Date('2026-09-06T00:00:00.000Z'),
      defaultTimeZone: 'Asia/Tokyo',
      defaultTimeZoneSourceTripPlaceId: null,
      experienceNote: null,
      experienceRating: null,
      id: ARRIVAL_DAY,
      tripId: TRIP,
    },
  );

  // Yoyogi Park is scheduled; Kiyosumi Garden is only saved to the trip.
  store.itineraryItem.push({
    customLabel: 'Morning walk',
    id: 'itinerary-item-yoyogi',
    itineraryDayId: ARRIVAL_DAY,
    timeZone: null,
    tripId: TRIP,
    tripPlaceId: YOYOGI,
  });
}

function photoInput(memoryId: string, fileName: string, overrides: Record<string, unknown> = {}) {
  return {
    contentType: 'image/jpeg',
    fileName,
    path: `${OWNER}/${TRIP}/${memoryId}/${fileName}`,
    sizeBytes: 1_024,
    ...overrides,
  };
}

function isNotFound(code: string) {
  return (error: unknown) => error instanceof MemoryNotFoundError && error.code === code;
}

test('another authenticated user cannot reach a private Memory or its media', async () => {
  seed();
  const memory = await createMemory(OWNER, TRIP, { note: 'Sunrise over the bay' }, null);
  const photo = await addMemoryPhoto(
    OWNER,
    TRIP,
    memory.id,
    photoInput(memory.id, 'bay.jpg'),
    null,
  );

  const denied = isNotFound('trip_not_found');
  await assert.rejects(listMemories(INTRUDER, TRIP, null), denied);
  await assert.rejects(updateMemory(INTRUDER, TRIP, memory.id, { note: 'mine now' }, null), denied);
  await assert.rejects(deleteMemory(INTRUDER, TRIP, memory.id, null), denied);
  await assert.rejects(deleteMemoryPhoto(INTRUDER, TRIP, memory.id, photo.id, null), denied);
  await assert.rejects(reorderHighlights(INTRUDER, TRIP, [memory.id], null), denied);
  await assert.rejects(reorderMemoryPhotos(INTRUDER, TRIP, memory.id, [photo.id], null), denied);
  await assert.rejects(setStoryCoverPhoto(INTRUDER, TRIP, photo.id, null), denied);
  // Even a path the intruder is allowed to write to in Storage is refused here.
  await assert.rejects(
    addMemoryPhoto(
      INTRUDER,
      TRIP,
      memory.id,
      { ...photoInput(memory.id, 'bay.jpg'), path: `${INTRUDER}/${TRIP}/${memory.id}/bay.jpg` },
      null,
    ),
    denied,
  );

  const owned = await listMemories(OWNER, TRIP, null);
  assert.equal(owned.memories.length, 1);
  assert.equal(owned.memories[0]?.note, 'Sunrise over the bay');
  assert.deepEqual(
    owned.memories[0]?.photos.map((entry) => entry.fileName),
    ['bay.jpg'],
  );
});

test('only files the traveller uploaded to their own folder become Memory media', async () => {
  seed();
  const memory = await createMemory(OWNER, TRIP, { note: 'Torii gate' }, null);
  const invalid = (error: unknown) =>
    error instanceof MemoryValidationError && error.code === 'invalid_memory_photo';

  const rejected = [
    // A provider photo reference is never copied in as user-owned Memory media.
    photoInput(memory.id, 'yoyogi.jpg', {
      path: 'https://places.googleapis.com/v1/places/ChIJyoyogi/photos/abc/media',
    }),
    photoInput(memory.id, 'yoyogi.jpg', {
      path: `${INTRUDER}/${TRIP}/${memory.id}/yoyogi.jpg`,
    }),
    photoInput(memory.id, 'yoyogi.jpg', {
      path: `${OWNER}/${OTHER_TRIP}/${memory.id}/yoyogi.jpg`,
    }),
    photoInput(memory.id, 'yoyogi.jpg', {
      path: `${OWNER}/${TRIP}/${memory.id}/../../escape.jpg`,
    }),
    photoInput(memory.id, 'diagram.svg', { contentType: 'image/svg+xml' }),
    photoInput(memory.id, 'huge.jpg', { sizeBytes: 16 * 1024 * 1024 }),
  ];

  for (const input of rejected) {
    await assert.rejects(addMemoryPhoto(OWNER, TRIP, memory.id, input, null), invalid);
  }

  const listed = await listMemories(OWNER, TRIP, null);
  assert.deepEqual(listed.memories[0]?.photos, []);
});

test('a retried offline capture resolves to the Memory and photo it already created', async () => {
  seed();
  const clientMemoryId = 'client-chosen-memory-id';
  const input = {
    capturedAt: '2026-09-06T02:15:00.000Z',
    itineraryDayId: ARRIVAL_DAY,
    note: 'Queued while offline',
  };

  const first = await createMemory(OWNER, TRIP, input, null, clientMemoryId);
  const replay = await createMemory(
    OWNER,
    TRIP,
    { ...input, note: 'A retry must not rewrite this' },
    null,
    clientMemoryId,
  );

  assert.equal(replay.id, first.id);
  assert.equal(replay.note, 'Queued while offline');

  const photo = await addMemoryPhoto(
    OWNER,
    TRIP,
    first.id,
    photoInput(first.id, 'queued.jpg'),
    null,
  );
  const photoReplay = await addMemoryPhoto(
    OWNER,
    TRIP,
    first.id,
    photoInput(first.id, 'queued.jpg'),
    null,
  );

  assert.equal(photoReplay.id, photo.id);
  assert.equal(photoReplay.position, 0);

  const listed = await listMemories(OWNER, TRIP, null);
  assert.equal(listed.memories.length, 1);
  assert.deepEqual(
    listed.memories[0]?.photos.map((entry) => entry.fileName),
    ['queued.jpg'],
  );
});

test('correcting a Memory moves it deliberately; an ordinary edit leaves its capture alone', async () => {
  seed();
  const captured = await createMemory(
    OWNER,
    TRIP,
    { capturedAt: '2026-09-05T15:30:00.000Z', itineraryDayId: DEPARTURE_DAY, note: 'Wheels up' },
    null,
  );

  assert.deepEqual(
    {
      date: captured.capturedLocalDate,
      source: captured.timeZoneSource,
      time: captured.capturedLocalTime,
      timeZone: captured.timeZone,
    },
    {
      date: '2026-09-05',
      source: 'itinerary_day',
      time: '11:30',
      timeZone: 'America/New_York',
    },
  );

  // Correcting the Place re-resolves the timezone and says so, rather than moving
  // the Memory to another story day quietly.
  const corrected = await updateMemory(OWNER, TRIP, captured.id, { tripPlaceId: YOYOGI }, null);
  assert.equal(corrected.localDateChanged, true);
  assert.deepEqual(
    {
      date: corrected.memory.capturedLocalDate,
      instant: corrected.memory.capturedAt,
      source: corrected.memory.timeZoneSource,
      time: corrected.memory.capturedLocalTime,
      timeZone: corrected.memory.timeZone,
    },
    {
      date: '2026-09-06',
      instant: captured.capturedAt,
      source: 'trip_place',
      time: '00:30',
      timeZone: 'Asia/Tokyo',
    },
  );

  const edited = await updateMemory(OWNER, TRIP, captured.id, { note: 'Landed at last' }, null);
  assert.equal(edited.localDateChanged, false);
  assert.deepEqual(
    {
      date: edited.memory.capturedLocalDate,
      instant: edited.memory.capturedAt,
      note: edited.memory.note,
      time: edited.memory.capturedLocalTime,
      timeZone: edited.memory.timeZone,
    },
    {
      date: '2026-09-06',
      instant: captured.capturedAt,
      note: 'Landed at last',
      time: '00:30',
      timeZone: 'Asia/Tokyo',
    },
  );
});

test('reading a Memory from a device in another timezone reports the same trip-local capture', async () => {
  seed();
  const originalTimeZone = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    const captured = await createMemory(
      OWNER,
      TRIP,
      { capturedAt: '2026-09-05T15:30:00.000Z', tripPlaceId: YOYOGI, note: 'Yoyogi at dawn' },
      null,
    );

    process.env.TZ = 'Pacific/Auckland';
    const reread = await listMemories(OWNER, TRIP, null);

    assert.deepEqual(
      {
        date: reread.memories[0]?.capturedLocalDate,
        time: reread.memories[0]?.capturedLocalTime,
        timeZone: reread.memories[0]?.timeZone,
      },
      {
        date: captured.capturedLocalDate,
        time: captured.capturedLocalTime,
        timeZone: 'Asia/Tokyo',
      },
    );
  } finally {
    process.env.TZ = originalTimeZone;
  }
});

test('removing one photo or one Memory leaves every other record intact', async () => {
  seed();
  const ramen = await createMemory(OWNER, TRIP, { note: 'Ramen counter' }, null);
  const train = await createMemory(OWNER, TRIP, { note: 'Night train' }, null);
  const cover = await addMemoryPhoto(
    OWNER,
    TRIP,
    ramen.id,
    photoInput(ramen.id, 'ramen.jpg'),
    null,
  );
  await addMemoryPhoto(OWNER, TRIP, ramen.id, photoInput(ramen.id, 'counter.jpg'), null);
  await addMemoryPhoto(OWNER, TRIP, train.id, photoInput(train.id, 'train.jpg'), null);
  await setStoryCoverPhoto(OWNER, TRIP, cover.id, null);

  await deleteMemoryPhoto(OWNER, TRIP, ramen.id, cover.id, null);
  const afterPhoto = await listMemories(OWNER, TRIP, null);
  assert.deepEqual(
    afterPhoto.memories.map((memory) => memory.photos.map((entry) => entry.fileName)),
    [['counter.jpg'], ['train.jpg']],
  );
  // The story cover pointed at that photo, so it clears; nothing else does.
  assert.equal(afterPhoto.storyCover, null);

  await deleteMemory(OWNER, TRIP, ramen.id, null);
  const afterMemory = await listMemories(OWNER, TRIP, null);
  assert.deepEqual(
    afterMemory.memories.map((memory) => memory.note),
    ['Night train'],
  );
  assert.deepEqual(
    afterMemory.memories.map((memory) => memory.photos.map((entry) => entry.fileName)),
    [['train.jpg']],
  );

  // The trip's day and Place survive their Memory and can still be captured against.
  const replacement = await createMemory(
    OWNER,
    TRIP,
    { itineraryDayId: ARRIVAL_DAY, note: 'Added afterwards', tripPlaceId: YOYOGI },
    null,
  );
  assert.equal(replacement.tripPlace?.id, YOYOGI);
  assert.equal(replacement.itineraryDay?.id, ARRIVAL_DAY);
});

test('a Trip Story cover can only be one of the traveller’s own Memory photos', async () => {
  seed();
  const memory = await createMemory(OWNER, TRIP, { note: 'Lantern street' }, null);
  const photo = await addMemoryPhoto(
    OWNER,
    TRIP,
    memory.id,
    photoInput(memory.id, 'lantern.jpg'),
    null,
  );

  await assert.rejects(
    setStoryCoverPhoto(OWNER, TRIP, 'a-photo-from-nowhere', null),
    isNotFound('memory_photo_not_found'),
  );

  const chosen = await setStoryCoverPhoto(OWNER, TRIP, photo.id, null);
  assert.equal(chosen?.photoId, photo.id);

  const cleared = await setStoryCoverPhoto(OWNER, TRIP, null, null);
  assert.equal(cleared, null);
  const listed = await listMemories(OWNER, TRIP, null);
  assert.deepEqual(
    listed.memories[0]?.photos.map((entry) => entry.fileName),
    ['lantern.jpg'],
  );
});

test('removing a Trip Place keeps the Memory captured there and its resolved timezone', async () => {
  seed();
  const memory = await createMemory(
    OWNER,
    TRIP,
    { note: 'Under the ginkgo', tripPlaceId: KIYOSUMI },
    null,
  );
  assert.equal(memory.timeZone, 'Asia/Tokyo');

  // A Place the itinerary still schedules stays protected.
  await assert.rejects(
    removeTripPlace(OWNER, TRIP, YOYOGI),
    (error: unknown) => error instanceof TripPlaceReferencedError,
  );

  await removeTripPlace(OWNER, TRIP, KIYOSUMI);

  const listed = await listMemories(OWNER, TRIP, null);
  assert.equal(listed.memories.length, 1);
  assert.deepEqual(
    {
      note: listed.memories[0]?.note,
      timeZone: listed.memories[0]?.timeZone,
      tripPlace: listed.memories[0]?.tripPlace,
    },
    { note: 'Under the ginkgo', timeZone: 'Asia/Tokyo', tripPlace: null },
  );
});

test('deleting a trip takes its Memories and their private media with it', async () => {
  seed();
  const memory = await createMemory(OWNER, TRIP, { note: 'Last night out' }, null);
  const photo = await addMemoryPhoto(
    OWNER,
    TRIP,
    memory.id,
    photoInput(memory.id, 'last-night.jpg'),
    null,
  );

  const storageRequests: Array<{ body: string; url: string }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    storageRequests.push({ body: String(init?.body ?? ''), url: String(input) });
    return new Response('[]', { headers: { 'content-type': 'application/json' }, status: 200 });
  }) as typeof globalThis.fetch;

  try {
    await deleteTrip(OWNER, 'access-token', TRIP);
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.deepEqual(store.memory, []);
  assert.deepEqual(store.memoryPhoto, []);
  // The traveller's photos must not outlive the trip in private Storage.
  const removal = storageRequests.find((request) => request.url.includes('memory-photos'));
  assert.ok(removal, `expected a memory-photos removal, got ${JSON.stringify(storageRequests)}`);
  assert.ok(removal.body.includes(photo.id) || removal.body.includes('last-night.jpg'));
});

test('Experience Rating is entered per target and never averaged or inferred', async () => {
  seed();
  await updateItineraryDayExperienceRating(OWNER, TRIP, DEPARTURE_DAY, 5, 'Perfect departure');
  await updateItineraryDayExperienceRating(OWNER, TRIP, ARRIVAL_DAY, 1, null);

  const beforeOverall = await getTrip(OWNER, '', TRIP);
  assert.equal(beforeOverall.experienceRating, null);
  assert.equal(beforeOverall.experienceNote, null);

  // Not the 3 an average of the day ratings would produce.
  const rated = await updateTripExperienceRating(OWNER, '', TRIP, 4, 'Worth every hour');
  assert.equal(rated.experienceRating, 4);
  assert.deepEqual(
    store.itineraryDay.map((day) => day.experienceRating),
    [5, 1],
  );

  const cleared = await updateTripExperienceRating(OWNER, '', TRIP, null, null);
  assert.equal(cleared.experienceRating, null);
  assert.deepEqual(
    store.itineraryDay.map((day) => day.experienceRating),
    [5, 1],
  );

  // Capture asks for no rating, and a Memory carries none of its own.
  const memory = await createMemory(OWNER, TRIP, { note: 'No rating asked for' }, null);
  assert.equal('experienceRating' in memory, false);
  assert.equal('experienceNote' in memory, false);
});
