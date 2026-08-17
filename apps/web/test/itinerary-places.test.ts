import assert from 'node:assert/strict';
import { test } from 'vitest';

import type { Itinerary, ItineraryDay, ItineraryItem } from '../lib/itinerary/api.ts';
import { scheduledPlaceUse } from '../lib/itinerary/places.ts';

function tripPlace(id: string) {
  return {
    customName: null,
    id,
    note: null,
    place: {
      id: `place-${id}`,
      kind: 'custom' as const,
      location: null,
      name: id,
      note: null,
      providerAddress: null,
      providerLabel: null,
      providerRefs: [],
      timeZone: null,
    },
    priority: null,
  };
}

function item(id: string, placeId: string | null): ItineraryItem {
  return {
    createdAt: '2026-09-05T00:00:00.000Z',
    customLabel: placeId ? null : id,
    customLocation: null,
    dayPart: null,
    durationMinutes: null,
    id,
    itineraryDayId: null,
    localStartTime: null,
    notes: null,
    plannedCost: null,
    position: 0,
    priority: null,
    startInstant: null,
    timeSemantics: null,
    timeZone: null,
    timeZoneSource: null,
    travelStatus: 'upcoming',
    tripPlace: placeId ? tripPlace(placeId) : null,
    updatedAt: '2026-09-05T00:00:00.000Z',
  };
}

function day(date: string, items: ItineraryItem[]): ItineraryDay {
  return {
    dailyBaseTripPlaceId: null,
    date,
    defaultTimeZone: 'Asia/Tokyo',
    defaultTimeZoneSource: 'trip_reference',
    defaultTimeZoneSourceTripPlaceId: null,
    experienceNote: null,
    experienceRating: null,
    id: `day-${date}`,
    items,
    notes: null,
    routeStartTravelMode: 'walk',
  } as ItineraryDay;
}

function itinerary(days: ItineraryDay[], unscheduledItems: ItineraryItem[] = []): Itinerary {
  return {
    days,
    trip: {
      endDate: '2026-09-07',
      id: 'trip',
      name: 'Trip',
      referenceTimeZone: 'Asia/Tokyo',
      startDate: '2026-09-05',
    },
    tripPlaces: [],
    unscheduledItems,
  };
}

test('a Place visited twice in one day counts once against that day', () => {
  const uses = scheduledPlaceUse(
    itinerary([day('2026-09-05', [item('morning', 'market'), item('evening', 'market')])]),
  );

  assert.deepEqual(uses.market, { dayNumbers: [1], itemCount: 2, unscheduledCount: 0 });
});

test('a Place spread across days reports every day it lands on, in order', () => {
  const uses = scheduledPlaceUse(
    itinerary([
      day('2026-09-05', [item('first', 'park')]),
      day('2026-09-06', [item('second', 'shrine')]),
      day('2026-09-07', [item('third', 'park')]),
    ]),
  );

  assert.deepEqual(uses.park, { dayNumbers: [1, 3], itemCount: 2, unscheduledCount: 0 });
  assert.deepEqual(uses.shrine, { dayNumbers: [2], itemCount: 1, unscheduledCount: 0 });
});

test('a Place only parked in Unscheduled is accounted for but on no day', () => {
  const uses = scheduledPlaceUse(itinerary([day('2026-09-05', [])], [item('someday', 'museum')]));

  assert.deepEqual(uses.museum, { dayNumbers: [], itemCount: 1, unscheduledCount: 1 });
});

test('a Place both scheduled and parked reports both without double counting the day', () => {
  const uses = scheduledPlaceUse(
    itinerary([day('2026-09-05', [item('booked', 'garden')])], [item('maybe', 'garden')]),
  );

  assert.deepEqual(uses.garden, { dayNumbers: [1], itemCount: 2, unscheduledCount: 1 });
});

test('Places with nothing scheduled against them are simply absent', () => {
  const uses = scheduledPlaceUse(
    itinerary([day('2026-09-05', [item('custom-only', null)])], [item('also-custom', null)]),
  );

  assert.deepEqual(uses, {});
});
