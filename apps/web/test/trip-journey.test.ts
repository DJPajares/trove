import { expect, test } from 'vitest';

import { tripJourneyStops } from '@/lib/trips/journey';

const day = (number: number, town: string | null, stopCount = 2) => ({
  id: `day-${number}`,
  date: `2026-10-${String(8 + number).padStart(2, '0')}`,
  number,
  name: null,
  town,
  stopCount,
});

test('consecutive days in one town become one stop, however the town is spelled', () => {
  const stops = tripJourneyStops([
    day(1, 'Hanoi'),
    day(2, 'Ha Long'),
    day(3, 'Ha Long', 0),
    day(4, 'Sa Pa', 0),
    day(5, 'Sa Pa'),
    day(6, 'Đà Nẵng'),
    day(7, 'Da Nang'),
  ]);
  expect(
    stops.map((stop) => [stop.town, stop.firstNumber, stop.lastNumber, stop.openDays]),
  ).toEqual([
    ['Hanoi', 1, 1, 0],
    ['Ha Long', 2, 3, 1],
    ['Sa Pa', 4, 5, 1],
    ['Đà Nẵng', 6, 7, 0],
  ]);
  expect(stops[1]).toMatchObject({ startDate: '2026-10-10', endDate: '2026-10-11' });
});

test('an unplaced day stays with its stop instead of splitting the journey', () => {
  const stops = tripJourneyStops([
    day(1, null, 0),
    day(2, 'Kyoto'),
    day(3, null),
    day(4, 'Kyoto'),
    day(5, 'Osaka'),
  ]);
  expect(stops.map((stop) => [stop.town, stop.days.map((entry) => entry.number)])).toEqual([
    ['Kyoto', [1, 2, 3, 4]],
    ['Osaka', [5]],
  ]);
});

test('a trip no day can place yields no stops, so the caller falls back', () => {
  expect(tripJourneyStops([day(1, null), day(2, null)])).toEqual([]);
  expect(tripJourneyStops([])).toEqual([]);
});
