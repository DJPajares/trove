import { expect, test } from 'vitest';

import {
  openingIntervalsForWeekday,
  resolveOpeningHoursForDay,
  weekdayForLocalDate,
} from '../src/services/place-opening-hours.js';
import type { PlaceOpeningPeriod } from '../src/services/places.js';

/** Minutes east of UTC for a zone right now, so the same-zone guard can be satisfied. */
function currentOffsetMinutes(timeZone: string) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(now);
  const field = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour') % 24,
    field('minute'),
    field('second'),
  );

  return Math.round((asUtc - Math.floor(now.getTime() / 1000) * 1000) / 60_000);
}

function period(
  openDay: number,
  openHour: number,
  closeDay: number,
  closeHour: number,
): PlaceOpeningPeriod {
  return {
    close: { day: closeDay, hour: closeHour, minute: 0 },
    open: { day: openDay, hour: openHour, minute: 0 },
  };
}

const SINGAPORE = 'Asia/Singapore';

test('maps every weekday from a local date, with Sunday as zero', () => {
  // 2026-08-16 is a Sunday.
  expect(
    [
      '2026-08-16',
      '2026-08-17',
      '2026-08-18',
      '2026-08-19',
      '2026-08-20',
      '2026-08-21',
      '2026-08-22',
    ].map(weekdayForLocalDate),
  ).toStrictEqual([0, 1, 2, 3, 4, 5, 6]);
});

test('reads a same-day period as plain minutes from midnight', () => {
  expect(openingIntervalsForWeekday([period(1, 9, 1, 17)], 1)).toStrictEqual([
    { endMinute: 1020, startMinute: 540 },
  ]);
});

test('a weekday with no period yields no intervals rather than throwing', () => {
  expect(openingIntervalsForWeekday([period(1, 9, 1, 17)], 2)).toStrictEqual([]);
});

test('an open-ended period covers every weekday, not just the one it is filed under', () => {
  // Google reports a 24/7 place as a single Sunday open point with no close.
  const alwaysOpen: PlaceOpeningPeriod[] = [{ close: null, open: { day: 0, hour: 0, minute: 0 } }];

  for (let weekday = 0; weekday < 7; weekday += 1) {
    expect(
      openingIntervalsForWeekday(alwaysOpen, weekday),
      `weekday ${weekday} should be fully open`,
    ).toStrictEqual([{ endMinute: 1440, startMinute: 0 }]);
  }
});

test('an overnight period runs past midnight on its opening day', () => {
  // Friday 20:00 to Saturday 02:00.
  expect(openingIntervalsForWeekday([period(5, 20, 6, 2)], 5)).toStrictEqual([
    { endMinute: 1560, startMinute: 1200 },
  ]);
});

test('an overnight period still has the next morning open', () => {
  expect(openingIntervalsForWeekday([period(5, 20, 6, 2)], 6)).toStrictEqual([
    { endMinute: 120, startMinute: 0 },
  ]);
});

test('spillover wraps from Saturday into Sunday', () => {
  expect(openingIntervalsForWeekday([period(6, 22, 0, 1)], 0)).toStrictEqual([
    { endMinute: 60, startMinute: 0 },
  ]);
});

test('a closed weekday is known to be closed, not unknown', () => {
  // The single most useful conflict this evidence exists to surface: the
  // provider gave a full week, and this day is not in it.
  const result = resolveOpeningHoursForDay({
    date: '2026-08-18', // Tuesday
    dayTimeZone: SINGAPORE,
    periods: [period(1, 9, 1, 17)], // Monday only
    utcOffsetMinutes: currentOffsetMinutes(SINGAPORE),
  });

  expect(result).toStrictEqual({ intervals: [], source: 'FRESH_PROVIDER', status: 'KNOWN' });
});

test('an open weekday resolves to its intervals', () => {
  const result = resolveOpeningHoursForDay({
    date: '2026-08-17', // Monday
    dayTimeZone: SINGAPORE,
    periods: [period(1, 9, 1, 17)],
    utcOffsetMinutes: currentOffsetMinutes(SINGAPORE),
  });

  expect(result).toStrictEqual({
    intervals: [{ endMinute: 1020, startMinute: 540 }],
    source: 'FRESH_PROVIDER',
    status: 'KNOWN',
  });
});

test('no periods at all is unknown, since absence of a schedule proves nothing', () => {
  expect(
    resolveOpeningHoursForDay({
      date: '2026-08-17',
      dayTimeZone: SINGAPORE,
      periods: [],
      utcOffsetMinutes: currentOffsetMinutes(SINGAPORE),
    }),
  ).toStrictEqual({ status: 'UNKNOWN' });
});

test('a missing provider offset is unknown rather than assumed to match', () => {
  expect(
    resolveOpeningHoursForDay({
      date: '2026-08-17',
      dayTimeZone: SINGAPORE,
      periods: [period(1, 9, 1, 17)],
      utcOffsetMinutes: null,
    }),
  ).toStrictEqual({ status: 'UNKNOWN' });
});

test('a place outside the day timezone is unknown, since its hours are stated elsewhere', () => {
  expect(
    resolveOpeningHoursForDay({
      date: '2026-08-17',
      dayTimeZone: SINGAPORE,
      periods: [period(1, 9, 1, 17)],
      utcOffsetMinutes: currentOffsetMinutes(SINGAPORE) + 60,
    }),
  ).toStrictEqual({ status: 'UNKNOWN' });
});

test('the same-zone guard holds across zones with different offsets', () => {
  for (const timeZone of ['Asia/Singapore', 'Pacific/Auckland', 'America/New_York', 'UTC']) {
    const matched = resolveOpeningHoursForDay({
      date: '2026-08-17',
      dayTimeZone: timeZone,
      periods: [period(1, 9, 1, 17)],
      utcOffsetMinutes: currentOffsetMinutes(timeZone),
    });

    expect(matched.status, `${timeZone} should match its own offset`).toBe('KNOWN');
  }
});
