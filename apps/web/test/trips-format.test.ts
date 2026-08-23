import { expect, test } from 'vitest';

import { formatTripDate, formatTripDateRange } from '../lib/trips/format.ts';

test('a trip date reads as the date it was entered, whatever the device zone', () => {
  // The day number is the invariant worth pinning: parsed at UTC midnight
  // rather than local, so a device behind UTC does not render the 5th as the
  // 4th. Month spelling belongs to the locale data and is not asserted.
  expect(formatTripDate('2026-09-05', 'en-GB')).toMatch(/^5\b/);
  expect(formatTripDate('2026-01-01', 'en-GB')).toMatch(/^1\b/);
  expect(formatTripDate('2026-12-31', 'en-GB')).toMatch(/^31\b/);
  expect(formatTripDate('2026-01-01', 'en-GB')).toContain('2026');
});

test('a range inside one month says the month and year once', () => {
  const range = formatTripDateRange('2026-09-05', '2026-09-21', 'en-GB');

  expect(range).toContain('5');
  expect(range).toContain('21');
  // Collapsing the shared parts is the whole reason this uses formatRange.
  expect(range.match(/2026/g)).toHaveLength(1);
});

test('a range across months and years keeps both ends legible', () => {
  const months = formatTripDateRange('2026-09-28', '2026-10-04', 'en-GB');
  expect(months).toContain('28');
  expect(months).toContain('4');
  expect(months.match(/2026/g)).toHaveLength(1);

  const years = formatTripDateRange('2026-12-28', '2027-01-04', 'en-GB');
  expect(years).toContain('2026');
  expect(years).toContain('2027');
});

test('formatting follows the locale it is given', () => {
  // Trove is localisation-ready, so a date is never assembled by hand: the
  // same day orders differently for a US reader than a British one.
  expect(formatTripDate('2026-09-05', 'en-US')).toMatch(/^\D+5, 2026$/);
  expect(formatTripDate('2026-09-05', 'en-GB')).toMatch(/^5\b/);
  expect(formatTripDate('2026-09-05', 'de-DE')).toContain('2026');
});
