import { expect, test } from 'vitest';

import {
  accommodationStay,
  resolveDayStay,
  type StayAccommodation,
} from '../src/services/day-stay.js';
import { buildItineraryRoutePlan, type RoutePoint } from '../src/services/itinerary-routes.js';

function point(id: string, kind: RoutePoint['kind'] = 'itinerary_item'): RoutePoint {
  return { coordinates: { latitude: 0, longitude: 0 }, id, kind, label: null };
}

const place = (id: string) => ({ id });
const DAY = { id: 'day', date: new Date('2026-09-03') };
function stay(
  id: string,
  checkIn: string | null,
  checkOut: string | null,
  linkedDayIds: string[] = [],
): StayAccommodation<{ id: string }> {
  return {
    checkInDate: checkIn ? new Date(checkIn) : null,
    checkOutDate: checkOut ? new Date(checkOut) : null,
    linkedDayIds,
    tripPlace: place(id),
  };
}
const ends = (result: ReturnType<typeof accommodationStay<{ id: string }>>) => [
  result.start?.id ?? null,
  result.end?.id ?? null,
];

test('a hand-linked accommodation is both ends of its day', () => {
  expect(ends(accommodationStay(DAY, [stay('a', '2026-09-01', '2026-09-05', ['day'])]))).toEqual([
    'a',
    'a',
  ]);
});

test('two hand-linked stays split cleanly on the change-over day, and otherwise give nothing', () => {
  const changeOver = [
    stay('a', '2026-09-01', '2026-09-03', ['day']),
    stay('b', '2026-09-03', '2026-09-05', ['day']),
  ];
  expect(ends(accommodationStay(DAY, changeOver))).toEqual(['a', 'b']);
  const overlapping = [
    stay('a', '2026-09-01', '2026-09-05', ['day']),
    stay('b', '2026-09-01', '2026-09-05', ['day']),
  ];
  expect(ends(accommodationStay(DAY, overlapping))).toEqual([null, null]);
});

test('without linked days, check-in and check-out dates decide each end', () => {
  const hotel = [stay('a', '2026-09-03', '2026-09-05')];
  // Check-in day: the day ends there but did not start there.
  expect(ends(accommodationStay(DAY, hotel))).toEqual([null, 'a']);
  expect(ends(accommodationStay({ id: 'mid', date: new Date('2026-09-04') }, hotel))).toEqual([
    'a',
    'a',
  ]);
  // Check-out day: the day starts there and ends elsewhere.
  expect(ends(accommodationStay({ id: 'out', date: new Date('2026-09-05') }, hotel))).toEqual([
    'a',
    null,
  ]);
});

test('a transfer day starts at one stay and ends at the next, with nothing picked', () => {
  expect(
    ends(
      accommodationStay(DAY, [
        stay('a', '2026-09-01', '2026-09-03'),
        stay('b', '2026-09-03', '2026-09-06'),
      ]),
    ),
  ).toEqual(['a', 'b']);
});

test('linked days override dates, and a stay without a place or dates is ignored', () => {
  const linkedElsewhere = stay('a', '2026-09-01', '2026-09-05', ['other-day']);
  expect(ends(accommodationStay(DAY, [linkedElsewhere]))).toEqual([null, null]);
  expect(
    ends(
      accommodationStay(DAY, [
        { ...stay('x', '2026-09-01', '2026-09-05'), tripPlace: null },
        stay('y', null, null),
      ]),
    ),
  ).toEqual([null, null]);
  expect(ends(accommodationStay(DAY, []))).toEqual([null, null]);
});

test('what the traveller set wins over any booking, and the end falls back to the start', () => {
  const booked = [stay('hotel', '2026-09-01', '2026-09-05')];
  const explicit = resolveDayStay(
    { ...DAY, dailyBaseTripPlace: place('friend'), dailyBaseDepartureTripPlace: null },
    booked,
  );
  expect(explicit).toEqual({
    start: { place: { id: 'friend' }, source: 'explicit' },
    end: { place: { id: 'friend' }, source: 'explicit' },
  });
  expect(
    resolveDayStay({ ...DAY, dailyBaseTripPlace: null, dailyBaseDepartureTripPlace: null }, booked),
  ).toEqual({
    start: { place: { id: 'hotel' }, source: 'accommodation' },
    end: { place: { id: 'hotel' }, source: 'accommodation' },
  });
});

test('symmetric base adds a day-start leg and a return-to-base leg around the items', () => {
  const base = point('hotel', 'daily_base');
  const plans = buildItineraryRoutePlan({
    arrivalBase: base,
    dayId: 'day-1',
    dayStartMode: 'drive',
    departureBase: base,
    items: [{ mode: 'walk', point: point('museum') }],
    startingLocation: null,
  });

  expect(plans.length).toBe(2);
  expect([plans[0]?.modeOwner.kind, plans[0]?.origin.id, plans[0]?.destination.id]).toStrictEqual([
    'day_start',
    'hotel',
    'museum',
  ]);
  expect([plans[1]?.modeOwner.kind, plans[1]?.origin.id, plans[1]?.destination.id]).toStrictEqual([
    'item_departure',
    'museum',
    'hotel',
  ]);
});

test('an asymmetric base routes the day-start leg from arrival and the return leg to departure', () => {
  const plans = buildItineraryRoutePlan({
    arrivalBase: point('hotel-a', 'daily_base'),
    dayId: 'day-1',
    dayStartMode: 'drive',
    departureBase: point('hotel-b', 'daily_base'),
    items: [{ mode: 'walk', point: point('museum') }],
    startingLocation: null,
  });

  expect(plans.length).toBe(2);
  expect(plans[0]?.origin.id).toBe('hotel-a');
  expect(plans[1]?.destination.id).toBe('hotel-b');
});

test('an arrival base with no departure base adds no return leg', () => {
  const plans = buildItineraryRoutePlan({
    arrivalBase: point('hotel', 'daily_base'),
    dayId: 'day-1',
    dayStartMode: 'drive',
    departureBase: null,
    items: [{ mode: 'walk', point: point('museum') }],
    startingLocation: null,
  });

  expect(plans.length).toBe(1);
  expect(plans[0]?.modeOwner.kind).toBe('day_start');
});

test('no base and no starting location leaves only between-item legs', () => {
  const plans = buildItineraryRoutePlan({
    arrivalBase: null,
    dayId: 'day-1',
    dayStartMode: 'drive',
    departureBase: null,
    items: [
      { mode: 'walk', point: point('museum') },
      { mode: 'walk', point: point('park') },
    ],
    startingLocation: null,
  });

  expect(plans.length).toBe(1);
  expect(plans[0]?.modeOwner.kind).toBe('item_departure');
});

test('the leg chain follows item order, so reordering a day rewrites which stop each leg comes from', () => {
  const day = (items: string[]) =>
    buildItineraryRoutePlan({
      arrivalBase: point('hotel', 'daily_base'),
      dayId: 'day-1',
      dayStartMode: 'drive',
      departureBase: point('hotel', 'daily_base'),
      items: items.map((id) => ({ mode: 'drive' as const, point: point(id) })),
      startingLocation: null,
    });

  const chain = (plans: ReturnType<typeof day>) =>
    plans.map((plan) => [plan.origin.id, plan.destination.id]);

  expect(chain(day(['hobbiton', 'redwoods', 'blue-spring']))).toStrictEqual([
    ['hotel', 'hobbiton'],
    ['hobbiton', 'redwoods'],
    ['redwoods', 'blue-spring'],
    ['blue-spring', 'hotel'],
  ]);

  // The same three stops, one moved: every leg it touches names a new origin.
  expect(chain(day(['hobbiton', 'blue-spring', 'redwoods']))).toStrictEqual([
    ['hotel', 'hobbiton'],
    ['hobbiton', 'blue-spring'],
    ['blue-spring', 'redwoods'],
    ['redwoods', 'hotel'],
  ]);
});
