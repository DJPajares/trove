import { expect, test } from 'vitest';

import type { Itinerary, ItineraryItem } from '../lib/itinerary/api.ts';
import { dropPosition } from '../lib/itinerary/optimistic.ts';
import { itineraryDayRouteRevision } from '../lib/itinerary/routes.ts';
import { applyOfflineMutation } from '../lib/offline/trip-store.ts';

function item(id: string, dayId: string, position: number, localStartTime: string | null = null) {
  return {
    createdAt: '2026-09-05T00:00:00.000Z',
    customLabel: id,
    customLocation: null,
    dayPart: null,
    durationMinutes: null,
    id,
    itineraryDayId: dayId,
    localStartTime,
    notes: null,
    plannedCost: null,
    position,
    priority: null,
    startInstant: null,
    timeSemantics: localStartTime ? 'floating_local' : null,
    timeZone: 'Pacific/Auckland',
    timeZoneSource: 'day_default',
    travelStatus: 'upcoming',
    tripPlace: null,
    updatedAt: '2026-09-05T00:00:00.000Z',
  } satisfies ItineraryItem;
}

function day(id: string, items: ItineraryItem[]) {
  return {
    dailyBaseDepartureTripPlaceId: null,
    dailyBaseTripPlaceId: null,
    date: id === 'one' ? '2026-09-05' : '2026-09-06',
    defaultTimeZone: 'Pacific/Auckland',
    defaultTimeZoneSource: 'trip_reference' as const,
    defaultTimeZoneSourceTripPlaceId: null,
    experienceNote: null,
    experienceRating: null,
    id,
    items,
    name: null,
    notes: null,
    routeStartTravelMode: 'drive' as const,
  };
}

function itinerary(days: Itinerary['days']): Itinerary {
  return {
    days,
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

const order = (plan: Itinerary, dayId: string) =>
  plan.days.find((candidate) => candidate.id === dayId)?.items.map((entry) => entry.id);

test('a dropped stop goes to the index it was dropped on, and a drop in place sends nothing', () => {
  const ids = ['a', 'b', 'c', 'd'];

  expect(dropPosition({ activeId: 'a', ids, overId: 'c' })).toBe(2);
  expect(dropPosition({ activeId: 'd', ids, overId: 'a' })).toBe(0);
  expect(dropPosition({ activeId: 'b', ids, overId: 'b' })).toBeNull();
  expect(dropPosition({ activeId: 'b', ids, overId: null })).toBeNull();
  expect(dropPosition({ activeId: 'b', ids, overId: 'gone' })).toBeNull();
});

test('a reorder shown before the server answers asks for the same legs as the answer', () => {
  // Positions as the server can leave them: a day a stop left keeps its gaps.
  const before = itinerary([
    day('one', [item('a', 'one', 0), item('b', 'one', 3), item('c', 'one', 7)]),
  ]);
  const shown = applyOfflineMutation(before, {
    baseItem: item('c', 'one', 7),
    input: { itineraryDayId: 'one', position: 0 },
    itemId: 'c',
    kind: 'itinerary_item_organize',
  });
  // What the server answers: the same order, renumbered on its own terms.
  const answered = itinerary([
    day('one', [item('c', 'one', 0), item('a', 'one', 1), item('b', 'one', 2)]),
  ]);

  expect(order(shown, 'one')).toStrictEqual(['c', 'a', 'b']);
  expect(itineraryDayRouteRevision(shown.days[0] ?? null)).toBe(
    itineraryDayRouteRevision(answered.days[0] ?? null),
  );
});

test('moving a stop to another day shows it there at once', () => {
  const before = itinerary([
    day('one', [item('a', 'one', 0), item('b', 'one', 1)]),
    day('two', [item('x', 'two', 0)]),
  ]);
  const shown = applyOfflineMutation(before, {
    baseItem: item('b', 'one', 1),
    input: { itineraryDayId: 'two', position: 0 },
    itemId: 'b',
    kind: 'itinerary_item_organize',
  });

  expect(order(shown, 'one')).toStrictEqual(['a']);
  expect(order(shown, 'two')).toStrictEqual(['b', 'x']);
});

test('a stop inserted offline lands where it was inserted, and a timed one where its time says', () => {
  const before = itinerary([
    day('one', [item('a', 'one', 0), item('b', 'one', 1), item('c', 'one', 2)]),
  ]);
  const untimed = applyOfflineMutation(before, {
    clientItemId: 'new',
    input: { customLabel: 'New', itineraryDayId: 'one', position: 1, schedule: { kind: 'none' } },
    kind: 'itinerary_item_create',
  });
  expect(order(untimed, 'one')).toStrictEqual(['a', 'new', 'b', 'c']);
  expect(untimed.days[0]?.items.map((entry) => entry.position)).toStrictEqual([0, 1, 2, 3]);

  const timedDay = itinerary([
    day('one', [item('morning', 'one', 0, '08:00'), item('evening', 'one', 1, '19:00')]),
  ]);
  const timed = applyOfflineMutation(timedDay, {
    clientItemId: 'lunch',
    input: {
      customLabel: 'Lunch',
      itineraryDayId: 'one',
      position: 0,
      schedule: { kind: 'exact', localTime: '12:30' },
    },
    kind: 'itinerary_item_create',
  });
  expect(order(timed, 'one')).toStrictEqual(['morning', 'lunch', 'evening']);
});
