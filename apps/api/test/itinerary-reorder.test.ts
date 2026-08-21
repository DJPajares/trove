import { beforeEach, expect, test } from 'vitest';

import {
  moveItineraryDayPlan,
  planItineraryDayMoveWrites,
  planReorderWrites,
} from '../src/services/itineraries.js';
import { installFakePrismaClient, resetStore, store } from './support/fake-prisma.js';

installFakePrismaClient();
beforeEach(resetStore);

/**
 * Replays the writes against the slots rows actually occupy, the way Postgres
 * sees them: one row per slot, checked on every statement rather than at commit.
 * Returns the final id-per-slot layout, or throws on the first collision.
 */
function applyWrites(
  startingPositions: Record<string, number>,
  writes: ReturnType<typeof planReorderWrites>,
) {
  const occupant = new Map<number, string>();
  for (const [id, position] of Object.entries(startingPositions)) occupant.set(position, id);

  for (const write of writes) {
    const held = occupant.get(write.position);
    if (held !== undefined && held !== write.id) {
      throw new Error(`position ${write.position} still held by ${held}, wanted by ${write.id}`);
    }
    for (const [position, id] of occupant) if (id === write.id) occupant.delete(position);
    occupant.set(write.position, write.id);
  }

  return [...occupant.entries()].sort(([a], [b]) => a - b).map(([position, id]) => [position, id]);
}

test('moving an item into the middle of a full day never writes onto an occupied slot', () => {
  // The reported case: five stops, the last one moved up one place. Writing the
  // moved row straight to slot 3 used to collide with the row still sitting there.
  const starting = { a: 0, b: 1, c: 2, d: 3, e: 4 };
  const writes = planReorderWrites(['a', 'b', 'c', 'e', 'd'], 5);

  expect(applyWrites(starting, writes)).toStrictEqual([
    [0, 'a'],
    [1, 'b'],
    [2, 'c'],
    [3, 'e'],
    [4, 'd'],
  ]);
});

test('every rotation of a day survives the same replay', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const starting = Object.fromEntries(ids.map((id, index) => [id, index]));

  for (let from = 0; from < ids.length; from += 1) {
    for (let to = 0; to < ids.length; to += 1) {
      const order = ids.filter((_, index) => index !== from);
      order.splice(to, 0, ids[from]!);
      expect(
        applyWrites(starting, planReorderWrites(order, ids.length)).map(([, id]) => id),
        `moving ${ids[from]} to ${to}`,
      ).toStrictEqual(order);
    }
  }
});

test('parking clears the final range even when the day has no room above it', () => {
  // A day whose positions already sit at 0..n-1 leaves `above` equal to n, but a
  // day with gaps can report a lower ceiling; parking must still clear 0..n-1.
  const writes = planReorderWrites(['a', 'b', 'c'], 0);

  expect(writes.slice(0, 3).every((write) => write.position >= 3)).toBeTruthy();
  expect(applyWrites({ a: 0, b: 1, c: 2 }, writes).map(([, id]) => id)).toStrictEqual([
    'a',
    'b',
    'c',
  ]);
});

function applyDayWrites(
  starting: Record<string, { dayId: string; position: number }>,
  writes: ReturnType<typeof planItineraryDayMoveWrites>,
) {
  const rows = new Map(Object.entries(starting));
  const apply = (write: (typeof writes.parking)[number]) => {
    const collision = [...rows.entries()].find(
      ([id, value]) =>
        id !== write.id &&
        value.dayId === write.itineraryDayId &&
        value.position === write.position,
    );
    if (collision) throw new Error(`${write.itineraryDayId}:${write.position} is occupied`);
    rows.set(write.id, { dayId: write.itineraryDayId, position: write.position });
  };
  writes.parking.forEach(apply);
  writes.final.forEach(apply);
  return [...rows.entries()]
    .sort(([, left], [, right]) =>
      left.dayId === right.dayId
        ? left.position - right.position
        : left.dayId.localeCompare(right.dayId),
    )
    .map(([id, value]) => ({ id, ...value }));
}

test('appending a day parks both lists before combining them', () => {
  const writes = planItineraryDayMoveWrites(
    'source',
    ['s1', 's2'],
    'target',
    ['t1', 't2', 't3'],
    'append',
  );

  expect(
    applyDayWrites(
      {
        s1: { dayId: 'source', position: 0 },
        s2: { dayId: 'source', position: 1 },
        t1: { dayId: 'target', position: 0 },
        t2: { dayId: 'target', position: 1 },
        t3: { dayId: 'target', position: 2 },
      },
      writes,
    ),
  ).toStrictEqual([
    { dayId: 'target', id: 't1', position: 0 },
    { dayId: 'target', id: 't2', position: 1 },
    { dayId: 'target', id: 't3', position: 2 },
    { dayId: 'target', id: 's1', position: 3 },
    { dayId: 'target', id: 's2', position: 4 },
  ]);
});

test('swapping day plans preserves each list order without collisions', () => {
  const writes = planItineraryDayMoveWrites(
    'source',
    ['s1', 's2'],
    'target',
    ['t1', 't2', 't3'],
    'swap',
  );

  expect(
    applyDayWrites(
      {
        s1: { dayId: 'source', position: 0 },
        s2: { dayId: 'source', position: 1 },
        t1: { dayId: 'target', position: 0 },
        t2: { dayId: 'target', position: 1 },
        t3: { dayId: 'target', position: 2 },
      },
      writes,
    ),
  ).toStrictEqual([
    { dayId: 'source', id: 't1', position: 0 },
    { dayId: 'source', id: 't2', position: 1 },
    { dayId: 'source', id: 't3', position: 2 },
    { dayId: 'target', id: 's1', position: 0 },
    { dayId: 'target', id: 's2', position: 1 },
  ]);
});

test('the atomic service moves exact-time items and the daily base', async () => {
  const userId = 'user';
  const tripId = 'trip';
  const sourceDayId = 'source';
  const targetDayId = 'target';
  store.trip.push({
    endDate: new Date('2026-09-06T00:00:00.000Z'),
    id: tripId,
    name: 'Trip',
    ownerId: userId,
    referenceTimeZone: 'Pacific/Auckland',
    startDate: new Date('2026-09-05T00:00:00.000Z'),
  });
  store.itineraryDay.push(
    {
      dailyBaseDepartureTripPlaceId: null,
      dailyBaseTripPlaceId: 'source-base',
      date: new Date('2026-09-05T00:00:00.000Z'),
      defaultTimeZone: 'Asia/Singapore',
      defaultTimeZoneSource: 'TRIP_REFERENCE',
      defaultTimeZoneSourceItemId: null,
      defaultTimeZoneSourceTripPlaceId: null,
      id: sourceDayId,
      notes: 'Source note',
      tripId,
    },
    {
      dailyBaseDepartureTripPlaceId: 'target-departure',
      dailyBaseTripPlaceId: 'target-base',
      date: new Date('2026-09-06T00:00:00.000Z'),
      defaultTimeZone: 'Pacific/Auckland',
      defaultTimeZoneSource: 'TRIP_REFERENCE',
      defaultTimeZoneSourceItemId: null,
      defaultTimeZoneSourceTripPlaceId: null,
      id: targetDayId,
      notes: 'Target note',
      tripId,
    },
  );
  store.place.push(
    { customTimeZone: 'Pacific/Auckland', id: 'source-place' },
    { customTimeZone: 'Asia/Singapore', id: 'target-place' },
    { customTimeZone: 'Asia/Singapore', id: 'target-departure-place' },
  );
  store.tripPlace.push(
    { id: 'source-base', placeId: 'source-place', tripId },
    { id: 'target-base', placeId: 'target-place', tripId },
    { id: 'target-departure', placeId: 'target-departure-place', tripId },
  );
  store.itineraryItem.push({
    customLocationTimeZone: null,
    id: 'source-item',
    itineraryDayId: sourceDayId,
    localStartTime: new Date('1970-01-01T08:30:00.000Z'),
    position: 0,
    startInstant: new Date('2026-09-05T00:30:00.000Z'),
    timeSemantics: 'FLOATING_LOCAL',
    timeZone: 'Asia/Singapore',
    timeZoneSource: 'DAY_DEFAULT',
    tripId,
    tripPlaceId: null,
  });

  await moveItineraryDayPlan(userId, tripId, sourceDayId, {
    expectedSourceBase: {
      dailyBaseDepartureTripPlaceId: null,
      dailyBaseTripPlaceId: 'source-base',
    },
    expectedSourceItemIds: ['source-item'],
    expectedTargetBase: {
      dailyBaseDepartureTripPlaceId: 'target-departure',
      dailyBaseTripPlaceId: 'target-base',
    },
    expectedTargetItemIds: [],
    strategy: 'append',
    targetItineraryDayId: targetDayId,
  });

  expect(store.itineraryItem[0]).toMatchObject({
    itineraryDayId: targetDayId,
    position: 0,
    startInstant: new Date('2026-09-05T20:30:00.000Z'),
    timeZone: 'Pacific/Auckland',
  });
  expect(store.itineraryDay.map(({ notes }) => notes)).toStrictEqual([
    'Source note',
    'Target note',
  ]);
  expect(store.itineraryDay).toMatchObject([
    { dailyBaseDepartureTripPlaceId: null, dailyBaseTripPlaceId: null },
    { dailyBaseDepartureTripPlaceId: null, dailyBaseTripPlaceId: 'source-base' },
  ]);
});

test('a stale day move fails before either list changes', async () => {
  store.trip.push({
    id: 'trip',
    ownerId: 'user',
    referenceTimeZone: 'Pacific/Auckland',
  });
  store.itineraryDay.push(
    {
      dailyBaseDepartureTripPlaceId: null,
      dailyBaseTripPlaceId: null,
      date: new Date('2026-09-05T00:00:00.000Z'),
      id: 'source',
      tripId: 'trip',
    },
    {
      dailyBaseDepartureTripPlaceId: null,
      dailyBaseTripPlaceId: null,
      date: new Date('2026-09-06T00:00:00.000Z'),
      id: 'target',
      tripId: 'trip',
    },
  );
  store.itineraryItem.push({
    id: 'new-item',
    itineraryDayId: 'source',
    position: 0,
    tripId: 'trip',
  });

  await expect(
    moveItineraryDayPlan('user', 'trip', 'source', {
      expectedSourceBase: {
        dailyBaseDepartureTripPlaceId: null,
        dailyBaseTripPlaceId: null,
      },
      expectedSourceItemIds: ['old-item'],
      expectedTargetBase: {
        dailyBaseDepartureTripPlaceId: null,
        dailyBaseTripPlaceId: null,
      },
      expectedTargetItemIds: [],
      strategy: 'append',
      targetItineraryDayId: 'target',
    }),
  ).rejects.toThrow('itinerary_day_conflict');
  expect(store.itineraryItem[0]).toMatchObject({ itineraryDayId: 'source', position: 0 });
});
