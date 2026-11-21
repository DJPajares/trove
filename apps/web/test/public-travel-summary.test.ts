import { expect, test } from 'vitest';

import { summarizePublicTravels } from '../lib/profile/public-travel-summary.ts';

const trip = (id: string, startDate: string, endDate: string, countries: string[]) => ({
  countries,
  endDate,
  id,
  name: id,
  startDate,
});

test('public counts take in only listed trips that have ended', () => {
  const summary = summarizePublicTravels(
    [
      trip('kyoto', '2025-05-01', '2025-05-03', ['JP']),
      trip('osaka', '2026-03-10', '2026-03-12', ['JP']),
      trip('lisbon', '2026-01-02', '2026-01-02', ['PT', 'XX']),
      // Still to come, so it is a plan, not a place they have been.
      trip('peru', '2027-02-01', '2027-02-10', ['PE']),
    ],
    '2026-11-21',
  );

  expect(summary).toStrictEqual({ countries: 2, daysAway: 7, firstYear: 2025, trips: 3 });
});

test('no finished trips means nothing to count', () => {
  expect(summarizePublicTravels([], '2026-11-21')).toStrictEqual({
    countries: 0,
    daysAway: 0,
    firstYear: null,
    trips: 0,
  });
});
