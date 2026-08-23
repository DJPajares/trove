import { expect, test } from 'vitest';

import type { ItineraryItem, ItineraryRouteSegment } from '../lib/itinerary/api.ts';
import {
  buildDaySequence,
  dayStopNumbers,
  type DailyBaseIds,
  type DayTimelineEntry,
} from '../lib/itinerary/day-sequence.ts';

function item(id: string): ItineraryItem {
  return {
    createdAt: '2026-09-05T00:00:00.000Z',
    customLabel: id,
    customLocation: null,
    dayPart: null,
    durationMinutes: null,
    id,
    itineraryDayId: 'day',
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
    tripPlace: null,
    updatedAt: '2026-09-05T00:00:00.000Z',
  } as ItineraryItem;
}

function segment(
  input: Partial<ItineraryRouteSegment> &
    Pick<ItineraryRouteSegment, 'destination' | 'id' | 'origin'>,
): ItineraryRouteSegment {
  return {
    distanceMeters: null,
    durationSeconds: null,
    encodedPolyline: null,
    mode: 'walk',
    modeOwner: { id: 'day', kind: 'day_start' },
    provider: null,
    reason: null,
    scope: 'local',
    status: 'ok',
    ...input,
  } as ItineraryRouteSegment;
}

function toItem(id: string, from: string) {
  return segment({
    destination: { id, kind: 'itinerary_item', label: id },
    id: `leg-${id}`,
    origin: { id: from, kind: from === 'base' ? 'daily_base' : 'itinerary_item', label: from },
  });
}

function toBase(id: string, from: string) {
  return segment({
    destination: { id, kind: 'daily_base', label: id },
    id: `leg-${id}-from-${from}`,
    origin: { id: from, kind: 'itinerary_item', label: from },
  });
}

const bases = (input: Partial<DailyBaseIds> = {}): DailyBaseIds => ({
  arrivalTripPlaceId: null,
  departureTripPlaceId: null,
  ...input,
});

/** The shape of the day, as `kind:id` — what a reader would call the running order. */
function shape(entries: DayTimelineEntry[]) {
  return entries.map((entry) => {
    if (entry.kind === 'base') return `base:${entry.role}:${entry.stopNumber}`;
    if (entry.kind === 'leg') return `leg:${entry.segment.id}`;
    return `stop:${entry.item.id}:${entry.stopNumber}`;
  });
}

test('a day reads base, then each stop behind the leg that reaches it, then the way home', () => {
  const sequence = buildDaySequence({
    bases: bases({ arrivalTripPlaceId: 'base', departureTripPlaceId: 'base' }),
    items: [item('a'), item('b')],
    routeSegments: [toItem('a', 'base'), toItem('b', 'a'), toBase('base', 'b')],
  });

  expect(shape(sequence)).toStrictEqual([
    'base:arrival:1',
    'leg:leg-a',
    'stop:a:2',
    'leg:leg-b',
    'stop:b:3',
    'leg:leg-base-from-b',
    'base:departure:4',
  ]);
});

test('the leg that ends the day sits before the base it returns to, not after every item', () => {
  // The regression this replaces: base-destined legs were appended as their own
  // pass, so their position said which loop emitted them rather than when they
  // happen. Here the return leg is supplied first and must still land last.
  const sequence = buildDaySequence({
    bases: bases({ arrivalTripPlaceId: 'base', departureTripPlaceId: 'base' }),
    items: [item('a')],
    routeSegments: [toBase('base', 'a'), toItem('a', 'base')],
  });

  expect(shape(sequence)).toStrictEqual([
    'base:arrival:1',
    'leg:leg-a',
    'stop:a:2',
    'leg:leg-base-from-a',
    'base:departure:3',
  ]);
});

test('a transition day ends at a different base from the one it left', () => {
  const sequence = buildDaySequence({
    bases: bases({ arrivalTripPlaceId: 'morning', departureTripPlaceId: 'evening' }),
    items: [item('a')],
    routeSegments: [toItem('a', 'morning'), toBase('evening', 'a')],
  });

  expect(shape(sequence)).toStrictEqual([
    'base:arrival:1',
    'leg:leg-a',
    'stop:a:2',
    'leg:leg-evening-from-a',
    'base:departure:3',
  ]);
  const [arrival] = sequence;
  expect(arrival).toStrictEqual({
    kind: 'base',
    role: 'arrival',
    stopNumber: 1,
    tripPlaceId: 'morning',
  });
  expect(sequence.at(-1)).toStrictEqual({
    kind: 'base',
    role: 'departure',
    stopNumber: 3,
    tripPlaceId: 'evening',
  });
});

test('a day with no base numbers its stops from one', () => {
  const sequence = buildDaySequence({
    bases: bases(),
    items: [item('a'), item('b')],
    routeSegments: [toItem('b', 'a')],
  });

  expect(shape(sequence)).toStrictEqual(['stop:a:1', 'leg:leg-b', 'stop:b:2']);
});

test('a base at only one end still takes its place in the count', () => {
  expect(
    shape(
      buildDaySequence({
        bases: bases({ arrivalTripPlaceId: 'base' }),
        items: [item('a')],
      }),
    ),
  ).toStrictEqual(['base:arrival:1', 'stop:a:2']);

  expect(
    shape(
      buildDaySequence({
        bases: bases({ departureTripPlaceId: 'base' }),
        items: [item('a')],
      }),
    ),
  ).toStrictEqual(['stop:a:1', 'base:departure:2']);
});

test('a day whose routes have not arrived is still the day', () => {
  expect(
    shape(
      buildDaySequence({
        bases: bases({ arrivalTripPlaceId: 'base', departureTripPlaceId: 'base' }),
        items: [item('a'), item('b')],
      }),
    ),
  ).toStrictEqual(['base:arrival:1', 'stop:a:2', 'stop:b:3', 'base:departure:4']);
});

test('a leg for an item the day no longer has is dropped rather than orphaned', () => {
  const sequence = buildDaySequence({
    bases: bases(),
    items: [item('a')],
    routeSegments: [toItem('a', 'base'), toItem('ghost', 'a')],
  });

  expect(shape(sequence)).toStrictEqual(['leg:leg-a', 'stop:a:1']);
});

test('a starting location origin is not mistaken for a base the day returns to', () => {
  const sequence = buildDaySequence({
    bases: bases(),
    items: [item('a')],
    routeSegments: [
      segment({
        destination: { id: 'a', kind: 'itinerary_item', label: 'a' },
        id: 'leg-a',
        origin: { id: 'home', kind: 'starting_location', label: 'Home' },
      }),
    ],
  });

  expect(shape(sequence)).toStrictEqual(['leg:leg-a', 'stop:a:1']);
});

test('the sequence counts exactly as dayStopNumbers does', () => {
  // The map draws its circles from dayStopNumbers. A list that counted for
  // itself would eventually count differently.
  for (const dailyBases of [
    bases(),
    bases({ arrivalTripPlaceId: 'base' }),
    bases({ departureTripPlaceId: 'base' }),
    bases({ arrivalTripPlaceId: 'morning', departureTripPlaceId: 'evening' }),
  ]) {
    const items = [item('a'), item('b'), item('c')];
    const numbers = dayStopNumbers({ bases: dailyBases, itemCount: items.length });
    const sequence = buildDaySequence({ bases: dailyBases, items });

    const stops = sequence.filter((entry) => entry.kind === 'stop');
    expect(stops.map((entry) => (entry.kind === 'stop' ? entry.stopNumber : null))).toStrictEqual(
      items.map((_, index) => numbers.itemOffset + index + 1),
    );

    const arrival = sequence.find((entry) => entry.kind === 'base' && entry.role === 'arrival');
    expect(arrival && arrival.kind === 'base' ? arrival.stopNumber : null).toBe(numbers.arrival);

    const departure = sequence.find((entry) => entry.kind === 'base' && entry.role === 'departure');
    expect(departure && departure.kind === 'base' ? departure.stopNumber : null).toBe(
      numbers.departure,
    );
  }
});
