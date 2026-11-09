import { expect, test } from 'vitest';

import { chronologicalPosition } from '../lib/itinerary/move-position.ts';

const day = (...times: Array<string | null>) => times.map((localStartTime) => ({ localStartTime }));

test('a timed stop goes before the first stop that starts later', () => {
  // The reported case: a 2:15 PM brunch moved to a day of 8:00 AM work and a 7:35 PM flight.
  expect(chronologicalPosition(day('08:00:00', '19:35:00'), '14:15:00')).toBe(1);
  expect(chronologicalPosition(day('08:00', '19:35'), '07:00')).toBe(0);
  expect(chronologicalPosition(day('08:00', '19:35'), '21:00')).toBe(2);
  // A stop at the same time goes after it.
  expect(chronologicalPosition(day('14:15', '19:35'), '14:15')).toBe(1);
});

test('untimed stops neither attract nor block a timed one', () => {
  expect(chronologicalPosition(day(null, '08:00', null, '19:35'), '14:15')).toBe(3);
  expect(chronologicalPosition(day(null, null), '14:15')).toBe(2);
});

test('a stop with no time of its own goes to the end, as before', () => {
  expect(chronologicalPosition(day('08:00', '19:35'), null)).toBe(2);
  expect(chronologicalPosition([], '14:15')).toBe(0);
});
