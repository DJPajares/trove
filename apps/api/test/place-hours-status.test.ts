import { expect, test } from 'vitest';

import { placeHoursStatus } from '../src/services/place-hours-status.js';

const FETCHED = '2026-09-30T00:00:00.000Z';
// 2026-10-03 is a Saturday (Google day 6); 2026-10-04 is a Sunday (0).
const SATURDAY = '2026-10-03';
const SUNDAY = '2026-10-04';

const hours = (overrides: Record<string, unknown> = {}) =>
  ({
    fetchedAt: FETCHED,
    periods: [
      { open: { day: 6, hour: 9, minute: 0 }, close: { day: 6, hour: 17, minute: 0 } },
      // No Sunday period: shut that day.
    ],
    source: 'CACHED_PROVIDER',
    timeZone: 'Asia/Tokyo',
    utcOffsetMinutes: 540,
    ...overrides,
  }) as never;

test('a day with weekly opening hours says when the place opens and closes', () => {
  expect(placeHoursStatus({ date: SATURDAY, hours: hours(), zone: 'UTC' })).toStrictEqual({
    asOf: FETCHED,
    special: false,
    spans: [{ close: '17:00', open: '09:00' }],
    status: 'open',
  });
});

test('a weekday with no period is a closed day, not an unknown one', () => {
  expect(placeHoursStatus({ date: SUNDAY, hours: hours(), zone: 'UTC' })).toStrictEqual({
    asOf: FETCHED,
    status: 'closed',
  });
});

test('date-specific hours replace the weekly pattern inside their window', () => {
  const special = hours({
    currentPeriods: [
      {
        close: { date: SATURDAY, day: 6, hour: 15, minute: 0 },
        open: { date: SATURDAY, day: 6, hour: 10, minute: 0 },
      },
    ],
    validFrom: SATURDAY,
    validThrough: SATURDAY,
  });

  expect(placeHoursStatus({ date: SATURDAY, hours: special, zone: 'UTC' })).toMatchObject({
    special: true,
    spans: [{ close: '15:00', open: '10:00' }],
    status: 'open',
  });
  // Outside the window the ordinary weekly hours apply again.
  expect(placeHoursStatus({ date: '2026-10-10', hours: special, zone: 'UTC' })).toMatchObject({
    special: false,
    spans: [{ close: '17:00', open: '09:00' }],
  });
});

test('a place open past midnight is shown closing at the end of the day', () => {
  const late = hours({
    periods: [{ open: { day: 6, hour: 18, minute: 0 }, close: { day: 0, hour: 2, minute: 0 } }],
  });

  expect(placeHoursStatus({ date: SATURDAY, hours: late, zone: 'UTC' })).toMatchObject({
    spans: [{ close: '24:00', open: '18:00' }],
    status: 'open',
  });
});

test('no stored hours, or no date they were checked, is unknown', () => {
  expect(placeHoursStatus({ date: SATURDAY, hours: hours({ periods: [] }), zone: 'UTC' })).toEqual({
    status: 'unknown',
  });
  expect(
    placeHoursStatus({ date: SATURDAY, hours: hours({ fetchedAt: undefined }), zone: 'UTC' }),
  ).toEqual({ status: 'unknown' });
});
