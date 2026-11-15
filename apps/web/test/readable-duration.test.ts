import { expect, test } from 'vitest';

import { readableDuration } from '../lib/plan-score/readable-duration.ts';

test('under an hour stays in minutes', () => {
  expect(readableDuration(45)).toEqual({ count: 45, unit: 'minutes' });
  expect(readableDuration(59.4)).toEqual({ count: 59, unit: 'minutes' });
});

test('an hour and over reads in hours, to the nearest half', () => {
  expect(readableDuration(60)).toEqual({ count: 1, unit: 'hours' });
  expect(readableDuration(333)).toEqual({ count: 5.5, unit: 'hours' });
  expect(readableDuration(100)).toEqual({ count: 1.5, unit: 'hours' });
  expect(readableDuration(130)).toEqual({ count: 2, unit: 'hours' });
});
