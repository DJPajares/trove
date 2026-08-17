import assert from 'node:assert/strict';
import { test } from 'vitest';

import { installFakePrismaClient, resetStore, store } from './support/fake-prisma.js';

installFakePrismaClient();

const { removeTripPlace, TripPlaceReferencedError } =
  await import('../src/services/trip-places.js');
const { updateTrip } = await import('../src/services/trips.js');

const OWNER = 'owner-user-id';
const TRIP = 'trip-kansai';
const FIRST_DAY = 'itinerary-day-one';
const LAST_DAY = 'itinerary-day-two';
const RYOKAN = 'trip-place-ryokan';
const MARKET = 'trip-place-market';

/**
 * A Place a traveller actually used gathers records around it — an expense, a
 * reservation, a Memory — and a day it anchored. Each of those is an
 * `ON DELETE NO ACTION` key, so seeding them is what makes removal realistic.
 */
function seed() {
  resetStore();

  store.trip.push({
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    endDate: new Date('2026-09-02T00:00:00.000Z'),
    id: TRIP,
    name: 'Kansai',
    ownerId: OWNER,
    partySize: 2,
    planningReadiness: 'READY',
    referenceTimeZone: 'Asia/Tokyo',
    referenceTimeZoneSource: 'DESTINATION',
    referenceTimeZoneSourcePlaceId: null,
    startDate: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  });

  store.place.push(
    {
      customName: 'Hoshi Ryokan',
      customTimeZone: 'Asia/Tokyo',
      id: 'place-ryokan',
      kind: 'CUSTOM',
      providerRefs: [],
    },
    {
      customName: null,
      customTimeZone: 'Asia/Tokyo',
      id: 'place-market',
      kind: 'PROVIDER',
      providerRefs: [{ externalPlaceId: 'ChIJmarket', provider: 'GOOGLE' }],
    },
  );

  store.tripPlace.push(
    { id: RYOKAN, placeId: 'place-ryokan', tripId: TRIP },
    { id: MARKET, placeId: 'place-market', tripId: TRIP },
  );

  store.itineraryDay.push(
    {
      dailyBaseTripPlaceId: RYOKAN,
      date: new Date('2026-09-01T00:00:00.000Z'),
      defaultTimeZone: 'Asia/Tokyo',
      defaultTimeZoneSource: 'EXPLICIT_DAILY_BASE',
      defaultTimeZoneSourceItemId: null,
      defaultTimeZoneSourceTripPlaceId: RYOKAN,
      id: FIRST_DAY,
      tripId: TRIP,
    },
    {
      dailyBaseTripPlaceId: null,
      date: new Date('2026-09-02T00:00:00.000Z'),
      defaultTimeZone: 'Asia/Tokyo',
      defaultTimeZoneSource: 'TRIP_REFERENCE',
      defaultTimeZoneSourceItemId: null,
      defaultTimeZoneSourceTripPlaceId: null,
      id: LAST_DAY,
      tripId: TRIP,
    },
  );
}

test('removing a Trip Place keeps the records the traveller built around it', async () => {
  seed();
  store.expense.push({ id: 'expense-breakfast', tripId: TRIP, tripPlaceId: MARKET });
  store.reservation.push({ id: 'reservation-tasting', tripId: TRIP, tripPlaceId: MARKET });
  store.memory.push({ id: 'memory-stalls', tripId: TRIP, tripPlaceId: MARKET });

  await removeTripPlace(OWNER, TRIP, MARKET);

  assert.equal(store.tripPlace.length, 1);
  // Every record survives, holding no reference the database would refuse.
  assert.deepEqual(
    {
      expense: store.expense[0]?.tripPlaceId,
      memory: store.memory[0]?.tripPlaceId,
      reservation: store.reservation[0]?.tripPlaceId,
    },
    { expense: null, memory: null, reservation: null },
  );
  assert.deepEqual(
    [store.expense.length, store.reservation.length, store.memory.length],
    [1, 1, 1],
  );
});

test('removing a Trip Place a day leaned on re-resolves that day rather than refusing', async () => {
  seed();

  await removeTripPlace(OWNER, TRIP, RYOKAN);

  const day = store.itineraryDay.find((candidate) => candidate.id === FIRST_DAY);
  assert.deepEqual(
    {
      dailyBase: day?.dailyBaseTripPlaceId,
      source: day?.defaultTimeZoneSource,
      sourceTripPlace: day?.defaultTimeZoneSourceTripPlaceId,
      timeZone: day?.defaultTimeZone,
    },
    {
      dailyBase: null,
      source: 'TRIP_REFERENCE',
      sourceTripPlace: null,
      timeZone: 'Asia/Tokyo',
    },
  );
});

test('a Trip Place the itinerary still schedules is refused, and nothing is detached', async () => {
  seed();
  store.itineraryItem.push({
    customLabel: null,
    id: 'itinerary-item-market',
    itineraryDayId: LAST_DAY,
    position: 0,
    tripId: TRIP,
    tripPlaceId: MARKET,
  });
  store.expense.push({ id: 'expense-breakfast', tripId: TRIP, tripPlaceId: MARKET });

  await assert.rejects(
    removeTripPlace(OWNER, TRIP, MARKET),
    (error: unknown) => error instanceof TripPlaceReferencedError && error.referenceCount === 1,
  );
  assert.equal(store.tripPlace.length, 2);
  assert.equal(store.expense[0]?.tripPlaceId, MARKET);
});

test('shortening a trip keeps the tasks, expenses, and Memories filed on a dropped day', async () => {
  seed();
  store.task.push({ id: 'task-laundry', itineraryDayId: LAST_DAY, tripId: TRIP });
  store.expense.push({ id: 'expense-dinner', itineraryDayId: LAST_DAY, tripId: TRIP });
  store.memory.push({ id: 'memory-lanterns', itineraryDayId: LAST_DAY, tripId: TRIP });

  await updateTrip(OWNER, '', TRIP, {
    confirmDateShrink: true,
    endDate: '2026-09-01',
    startDate: '2026-09-01',
  });

  assert.deepEqual(
    store.itineraryDay.map((day) => day.id),
    [FIRST_DAY],
  );
  assert.deepEqual(
    {
      expense: store.expense[0]?.itineraryDayId,
      memory: store.memory[0]?.itineraryDayId,
      task: store.task[0]?.itineraryDayId,
    },
    { expense: null, memory: null, task: null },
  );
});
