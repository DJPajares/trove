import { expect, test } from 'vitest';

import type { Itinerary, ItineraryDay, ItineraryItem } from '../lib/itinerary/api.ts';
import { applyItineraryDayMove } from '../lib/itinerary/day-move.ts';

function item(id: string, itineraryDayId: string, position: number): ItineraryItem {
  return {
    createdAt: '2026-08-21T00:00:00.000Z',
    customLabel: id,
    customLocation: null,
    dayPart: null,
    durationMinutes: null,
    id,
    itineraryDayId,
    localStartTime: null,
    notes: null,
    plannedCost: null,
    position,
    priority: null,
    startInstant: null,
    timeSemantics: null,
    timeZone: 'Pacific/Auckland',
    timeZoneSource: 'day_default',
    travelStatus: 'upcoming',
    tripPlace: null,
    updatedAt: '2026-08-21T00:00:00.000Z',
  };
}

function day(
  id: string,
  date: string,
  ids: string[],
  base: Pick<ItineraryDay, 'dailyBaseDepartureTripPlaceId' | 'dailyBaseTripPlaceId'>,
): ItineraryDay {
  return {
    ...base,
    date,
    defaultTimeZone: 'Pacific/Auckland',
    defaultTimeZoneSource: 'trip_reference',
    defaultTimeZoneSourceTripPlaceId: null,
    experienceNote: null,
    experienceRating: null,
    id,
    items: ids.map((itemId, position) => item(itemId, id, position)),
    name: `${id} name`,
    notes: `${id} note`,
    routeStartTravelMode: 'drive',
  };
}

function itinerary(): Itinerary {
  return {
    days: [
      day('source', '2026-09-05', ['s1', 's2'], {
        dailyBaseDepartureTripPlaceId: 'source-departure',
        dailyBaseTripPlaceId: 'source-arrival',
      }),
      day('target', '2026-09-06', ['t1'], {
        dailyBaseDepartureTripPlaceId: 'target-departure',
        dailyBaseTripPlaceId: 'target-arrival',
      }),
    ],
    trip: {
      endDate: '2026-09-06',
      id: 'trip',
      name: 'Trip',
      referenceTimeZone: 'Pacific/Auckland',
      startDate: '2026-09-05',
    },
    tripPlaces: [],
    unscheduledItems: [],
  };
}

test('offline append moves the daily base with the items', () => {
  const result = applyItineraryDayMove(itinerary(), 'source', {
    expectedSourceBase: {
      dailyBaseDepartureTripPlaceId: 'source-departure',
      dailyBaseTripPlaceId: 'source-arrival',
    },
    expectedSourceItemIds: ['s1', 's2'],
    expectedTargetBase: {
      dailyBaseDepartureTripPlaceId: 'target-departure',
      dailyBaseTripPlaceId: 'target-arrival',
    },
    expectedTargetItemIds: ['t1'],
    strategy: 'append',
    targetItineraryDayId: 'target',
  });

  expect(result.days[0]?.items).toHaveLength(0);
  expect(
    result.days[1]?.items.map(({ id, itineraryDayId, position }) => ({
      id,
      itineraryDayId,
      position,
    })),
  ).toStrictEqual([
    { id: 't1', itineraryDayId: 'target', position: 0 },
    { id: 's1', itineraryDayId: 'target', position: 1 },
    { id: 's2', itineraryDayId: 'target', position: 2 },
  ]);
  expect(result.days[0]).toMatchObject({
    dailyBaseDepartureTripPlaceId: null,
    dailyBaseTripPlaceId: null,
  });
  expect(result.days[1]).toMatchObject({
    dailyBaseDepartureTripPlaceId: 'source-departure',
    dailyBaseTripPlaceId: 'source-arrival',
  });
  expect(result.days.map(({ notes }) => notes)).toStrictEqual(['source note', 'target note']);
  expect(result.days.map(({ name }) => name)).toStrictEqual(['source name', 'target name']);
});

test('offline swap exchanges the ordered item lists and is idempotent', () => {
  const operation = {
    expectedSourceBase: {
      dailyBaseDepartureTripPlaceId: 'source-departure',
      dailyBaseTripPlaceId: 'source-arrival',
    },
    expectedSourceItemIds: ['s1', 's2'],
    expectedTargetBase: {
      dailyBaseDepartureTripPlaceId: 'target-departure',
      dailyBaseTripPlaceId: 'target-arrival',
    },
    expectedTargetItemIds: ['t1'],
    strategy: 'swap' as const,
    targetItineraryDayId: 'target',
  };
  const moved = applyItineraryDayMove(itinerary(), 'source', operation);
  const replayed = applyItineraryDayMove(moved, 'source', operation);

  expect(replayed.days[0]?.items.map(({ id }) => id)).toStrictEqual(['t1']);
  expect(replayed.days[1]?.items.map(({ id }) => id)).toStrictEqual(['s1', 's2']);
  expect(replayed.days[0]).toMatchObject({
    dailyBaseDepartureTripPlaceId: 'target-departure',
    dailyBaseTripPlaceId: 'target-arrival',
  });
  expect(replayed.days[1]).toMatchObject({
    dailyBaseDepartureTripPlaceId: 'source-departure',
    dailyBaseTripPlaceId: 'source-arrival',
  });
});

test('offline move leaves a diverged snapshot unchanged for conflict resolution', () => {
  const current = itinerary();
  current.days[1]?.items.push(item('new', 'target', 1));

  const result = applyItineraryDayMove(current, 'source', {
    expectedSourceBase: {
      dailyBaseDepartureTripPlaceId: 'source-departure',
      dailyBaseTripPlaceId: 'source-arrival',
    },
    expectedSourceItemIds: ['s1', 's2'],
    expectedTargetBase: {
      dailyBaseDepartureTripPlaceId: 'target-departure',
      dailyBaseTripPlaceId: 'target-arrival',
    },
    expectedTargetItemIds: ['t1'],
    strategy: 'append',
    targetItineraryDayId: 'target',
  });

  expect(result.days[0]?.items.map(({ id }) => id)).toStrictEqual(['s1', 's2']);
  expect(result.days[1]?.items.map(({ id }) => id)).toStrictEqual(['t1', 'new']);
});
