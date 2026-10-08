import { beforeEach, expect, test } from 'vitest';

import { createItineraryItem } from '../src/services/itineraries.js';
import { parseLocalTime } from '../src/services/itinerary-rules.js';
import { installFakePrismaClient, resetStore, store } from './support/fake-prisma.js';

installFakePrismaClient();
beforeEach(resetStore);

function seedDay() {
  store.trip.push({
    endDate: new Date('2026-09-06T00:00:00.000Z'),
    id: 'trip',
    name: 'Trip',
    ownerId: 'user',
    referenceTimeZone: 'Asia/Singapore',
    startDate: new Date('2026-09-05T00:00:00.000Z'),
  });
  store.itineraryDay.push({
    dailyBaseDepartureTripPlaceId: null,
    dailyBaseTripPlaceId: null,
    date: new Date('2026-09-05T00:00:00.000Z'),
    defaultTimeZone: 'Asia/Singapore',
    defaultTimeZoneSource: 'TRIP_REFERENCE',
    defaultTimeZoneSourceItemId: null,
    defaultTimeZoneSourceTripPlaceId: null,
    id: 'day',
    notes: null,
    tripId: 'trip',
  });
}

function seedItem(id: string, position: number, localTime: string | null) {
  store.itineraryItem.push({
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    customLabel: id,
    customLocation: null,
    customLocationTimeZone: null,
    durationMinutes: null,
    notes: null,
    plannedCostAmount: null,
    plannedCostCurrencyCode: null,
    priority: null,
    travelModeToNext: 'DRIVE',
    travelStatus: 'UPCOMING',
    dayPart: null,
    id,
    itineraryDayId: 'day',
    localEndTime: null,
    localStartTime: localTime ? parseLocalTime(localTime) : null,
    position,
    startInstant: null,
    timeSemantics: localTime ? 'FLOATING_LOCAL' : null,
    timeZone: 'Asia/Singapore',
    timeZoneSource: 'DAY_DEFAULT',
    tripId: 'trip',
    tripPlaceId: null,
  });
}

/** The day as the traveller reads it: labels in position order, positions packed. */
function dayOrder() {
  const items = store.itineraryItem
    .filter((item) => item.itineraryDayId === 'day')
    .sort((left, right) => (left.position as number) - (right.position as number));
  return {
    labels: items.map((item) => item.customLabel),
    positions: items.map((item) => item.position),
  };
}

function seedThreeUntimed() {
  seedDay();
  seedItem('breakfast', 0, null);
  seedItem('museum', 1, null);
  seedItem('dinner', 2, null);
}

test('an untimed stop inserted between two others lands between them', async () => {
  seedThreeUntimed();

  await createItineraryItem('user', 'trip', {
    customLabel: 'coffee',
    itineraryDayId: 'day',
    position: 1,
    schedule: { kind: 'none' },
  });

  expect(dayOrder()).toStrictEqual({
    labels: ['breakfast', 'coffee', 'museum', 'dinner'],
    positions: [0, 1, 2, 3],
  });
});

test('a stop inserted first or past the end lands at that end', async () => {
  seedThreeUntimed();

  await createItineraryItem('user', 'trip', {
    customLabel: 'first',
    itineraryDayId: 'day',
    position: 0,
    schedule: { kind: 'none' },
  });
  await createItineraryItem('user', 'trip', {
    customLabel: 'last',
    itineraryDayId: 'day',
    position: 99,
    schedule: { kind: 'none' },
  });

  expect(dayOrder().labels).toStrictEqual(['first', 'breakfast', 'museum', 'dinner', 'last']);
});

test('a timed stop still goes where its time puts it, wherever it was inserted', async () => {
  seedDay();
  seedItem('08:00', 0, '08:00');
  seedItem('14:00', 1, '14:00');
  seedItem('19:00', 2, '19:00');

  await createItineraryItem('user', 'trip', {
    customLabel: '16:00',
    itineraryDayId: 'day',
    position: 0,
    schedule: { kind: 'exact', localTime: '16:00' },
  });

  expect(dayOrder().labels).toStrictEqual(['08:00', '14:00', '16:00', '19:00']);
});

test('without a position a new stop joins the end, as before', async () => {
  seedThreeUntimed();

  await createItineraryItem('user', 'trip', {
    customLabel: 'nightcap',
    itineraryDayId: 'day',
    schedule: { kind: 'none' },
  });

  expect(dayOrder().labels).toStrictEqual(['breakfast', 'museum', 'dinner', 'nightcap']);
});
