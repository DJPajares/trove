import { expect, test } from 'vitest';

import { offlineTripModeContext, type Itinerary, type ItineraryItem } from '@/lib/itinerary/api';

const timeZone = 'Asia/Singapore';

function item(id: string, localStartTime: string | null, overrides: Partial<ItineraryItem> = {}) {
  return {
    createdAt: '2026-09-05T00:00:00.000Z',
    customLabel: id,
    customLocation: null,
    dayPart: null,
    durationMinutes: null,
    id,
    itineraryDayId: 'day',
    localStartTime,
    notes: null,
    plannedCost: null,
    position: 0,
    priority: null,
    startInstant: null,
    timeSemantics: localStartTime ? 'floating_local' : null,
    timeZone,
    timeZoneSource: 'day_default',
    travelStatus: 'upcoming',
    tripPlace: null,
    updatedAt: '2026-09-05T00:00:00.000Z',
    ...overrides,
  } satisfies ItineraryItem;
}

function itinerary(items: ItineraryItem[]): Itinerary {
  return {
    days: [
      {
        dailyBaseDepartureTripPlaceId: null,
        dailyBaseTripPlaceId: null,
        date: '2026-09-05',
        defaultTimeZone: timeZone,
        defaultTimeZoneSource: 'trip_reference',
        defaultTimeZoneSourceTripPlaceId: null,
        experienceNote: null,
        experienceRating: null,
        id: 'day',
        items,
        name: null,
        notes: null,
        routeStartTravelMode: 'drive',
      },
    ],
    trip: {
      endDate: '2026-09-06',
      id: 'trip',
      name: 'Trip',
      referenceTimeZone: timeZone,
      startDate: '2026-09-05',
    },
    tripPlaces: [],
    unscheduledItems: [],
  };
}

test('offline preview keeps a durationless item current until the next scheduled start', () => {
  const result = offlineTripModeContext(
    itinerary([item('breakfast', '08:00'), item('lunch', '12:00')]),
    {
      date: '2026-09-05',
      time: '10:00',
    },
  );

  expect(result.currentOrRelevant).toEqual({
    itemId: 'breakfast',
    kind: 'current',
    reason: 'exact_time',
  });
  expect(result.nextItemId).toBe('lunch');
  expect(result.contextAt).toBe('2026-09-05T02:00:00.000Z');
});

test('offline final durationless items expire exactly 60 minutes after starting', () => {
  const plan = itinerary([item('last', '10:00')]);

  expect(
    offlineTripModeContext(plan, { date: '2026-09-05', time: '10:59' }).currentOrRelevant?.itemId,
  ).toBe('last');
  const expired = offlineTripModeContext(plan, { date: '2026-09-05', time: '11:00' });
  expect(expired.currentOrRelevant).toBeNull();
  expect(expired.nextItemId).toBeNull();
  expect(expired.state).toBe('no_next_item');
});

test('offline overlap selects the most recently started item', () => {
  const result = offlineTripModeContext(
    itinerary([
      item('long', '09:00', { durationMinutes: 180 }),
      item('newer', '10:00', { durationMinutes: 60 }),
      item('later', '12:00'),
    ]),
    { date: '2026-09-05', time: '10:30' },
  );

  expect(result.currentOrRelevant?.itemId).toBe('newer');
  expect(result.nextItemId).toBe('later');
});

test('offline context excludes completed and skipped items from current and next', () => {
  const result = offlineTripModeContext(
    itinerary([
      item('completed', '09:00', { travelStatus: 'completed' }),
      item('skipped', '10:00', { travelStatus: 'skipped' }),
      item('next', '11:00'),
    ]),
    { date: '2026-09-05', time: '10:15' },
  );

  expect(result.currentOrRelevant).toBeNull();
  expect(result.nextItemId).toBe('next');
  expect(result.state).toBe('free_time');
});

test('offline dayparts are relevant rather than exact-time current', () => {
  const result = offlineTripModeContext(
    itinerary([item('morning', null, { dayPart: 'morning' }), item('lunch', '12:00')]),
    { date: '2026-09-05', time: '10:00' },
  );

  expect(result.currentOrRelevant).toEqual({
    itemId: 'morning',
    kind: 'relevant',
    reason: 'day_part',
  });
  expect(result.nextItemId).toBe('lunch');
});

test('offline explicit instants select the trip-local date rather than the machine date', () => {
  const result = offlineTripModeContext(itinerary([item('late', '23:30')]), {
    at: '2026-09-05T15:35:00.000Z',
  });

  expect(result.selectedDate).toBe('2026-09-05');
  expect(result.contextSource).toBe('preview');
  expect(result.currentOrRelevant?.itemId).toBe('late');
});
