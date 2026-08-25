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
      customLabel: 'Museum',
      itineraryDayId: 'day',
      localEndTime: '10:30',
      schedule: { kind: 'exact', localTime: '09:00' },
    },
    kind: 'itinerary_item_create',
  });

  expect(result.days[0]?.items[0]).toMatchObject({
    durationMinutes: 90,
    localEndTime: '10:30',
    localStartTime: '09:00',
  });
});

test('offline retiming preserves the explicit end and recalculates its duration', () => {
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
    input: { schedule: { kind: 'exact', localTime: '09:30' } },
    itemId: baseItem.id,
    kind: 'itinerary_item_update',
  });

  expect(result.days[0]?.items[0]).toMatchObject({
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
