import { expect, test } from 'vitest';

import type { Itinerary } from '../lib/itinerary/api.ts';
import { applyOfflineMutation } from '../lib/offline/trip-store.ts';

function itinerary(): Itinerary {
  return {
    days: [
      {
        dailyBaseDepartureTripPlaceId: null,
        dailyBaseTripPlaceId: null,
        date: '2026-09-05',
        defaultTimeZone: 'Pacific/Auckland',
        defaultTimeZoneSource: 'trip_reference',
        defaultTimeZoneSourceTripPlaceId: null,
        experienceNote: null,
        experienceRating: null,
        id: 'day',
        items: [],
        name: null,
        notes: null,
        routeStartTravelMode: 'drive',
      },
    ],
    trip: {
      endDate: '2026-09-05',
      id: 'trip',
      name: 'Trip',
      referenceTimeZone: 'Pacific/Auckland',
      startDate: '2026-09-05',
    },
    tripPlaces: [],
    unscheduledItems: [],
  };
}

test('offline creation keeps an explicit end and derives its effective duration', () => {
  const result = applyOfflineMutation(itinerary(), {
    clientItemId: 'museum',
    input: {
      blockType: 'activity',
      customLabel: 'Museum',
      itineraryDayId: 'day',
      localEndTime: '10:30',
      schedule: { kind: 'exact', localTime: '09:00' },
    },
    kind: 'itinerary_item_create',
  });

  expect(result.days[0]?.items[0]).toMatchObject({
    blockType: 'activity',
    durationMinutes: 90,
    localEndTime: '10:30',
    localStartTime: '09:00',
  });
});

test('offline retiming preserves the explicit end and recalculates its duration', () => {
  const created = applyOfflineMutation(itinerary(), {
    clientItemId: 'museum',
    input: {
      blockType: 'work',
      customLabel: 'Museum',
      itineraryDayId: 'day',
      localEndTime: '10:30',
      schedule: { kind: 'exact', localTime: '09:00' },
    },
    kind: 'itinerary_item_create',
  });
  const baseItem = created.days[0]!.items[0]!;

  const result = applyOfflineMutation(created, {
    baseItem,
    input: { schedule: { kind: 'exact', localTime: '09:30' } },
    itemId: baseItem.id,
    kind: 'itinerary_item_update',
  });

  expect(result.days[0]?.items[0]).toMatchObject({
    blockType: 'work',
    durationMinutes: 60,
    localEndTime: '10:30',
    localStartTime: '09:30',
  });
});

test('offline duration selection clears an existing explicit end time', () => {
  const created = applyOfflineMutation(itinerary(), {
    clientItemId: 'museum',
    input: {
      customLabel: 'Museum',
      itineraryDayId: 'day',
      localEndTime: '10:30',
      schedule: { kind: 'exact', localTime: '09:00' },
    },
    kind: 'itinerary_item_create',
  });
  const baseItem = created.days[0]!.items[0]!;

  const result = applyOfflineMutation(created, {
    baseItem,
    input: { durationMinutes: 45, localEndTime: null },
    itemId: baseItem.id,
    kind: 'itinerary_item_update',
  });

  expect(result.days[0]?.items[0]).toMatchObject({ durationMinutes: 45, localEndTime: null });
});

test('queued planner inserts and moves preserve position, flexibility and daypart intent', () => {
  const original = applyOfflineMutation(itinerary(), {
    clientItemId: 'first',
    kind: 'itinerary_item_create',
    input: {
      customLabel: 'First',
      itineraryDayId: 'day',
      durationMinutes: 60,
      schedule: { kind: 'exact', localTime: '09:00' },
    },
  });
  const inserted = applyOfflineMutation(original, {
    clientItemId: 'new',
    kind: 'itinerary_item_create',
    input: {
      customLabel: 'New',
      itineraryDayId: 'day',
      position: 0,
      durationMinutes: 90,
      schedule: { kind: 'exact', localTime: '14:00', dayPart: 'afternoon' },
      timingPolicy: 'reconcile_flexible',
      timingFlexibility: 'flexible',
      timeProvenance: 'app_estimated',
      durationProvenance: 'app_estimated',
    },
  });
  expect(inserted.days[0]!.items.map((item) => item.id)).toEqual(['new', 'first']);
  expect(inserted.days[0]!.items[0]).toMatchObject({
    dayPart: 'afternoon',
    timingFlexibility: 'flexible',
    timeProvenance: 'app_estimated',
    durationProvenance: 'app_estimated',
  });
  const moved = applyOfflineMutation(inserted, {
    baseItem: inserted.days[0]!.items[1]!,
    kind: 'itinerary_item_organize',
    itemId: 'first',
    input: { itineraryDayId: 'day', position: 0, timingPolicy: 'reconcile_flexible' },
  });
  expect(moved.days[0]!.items.map((item) => item.id)).toEqual(['first', 'new']);
});

test('offline explicit ends retain elapsed duration across daylight saving', () => {
  const snapshot = itinerary();
  snapshot.days[0]!.date = '2026-03-08';
  snapshot.days[0]!.defaultTimeZone = 'America/New_York';
  const created = applyOfflineMutation(snapshot, {
    clientItemId: 'dst',
    kind: 'itinerary_item_create',
    input: {
      customLabel: 'Early visit',
      itineraryDayId: 'day',
      localEndTime: '03:30',
      schedule: { kind: 'exact', localTime: '01:30' },
      timingPolicy: 'reconcile_flexible',
    },
  });
  expect(created.days[0]!.items[0]).toMatchObject({
    durationMinutes: 60,
    localEndTime: '03:30',
    localStartTime: '01:30',
  });
});
