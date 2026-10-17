import { expect, test } from 'vitest';

import {
  openingIntervalsForWeekday,
  resolveOpeningHoursForDay,
  weekdayForLocalDate,
} from '../src/services/place-opening-hours.js';
import type { PlaceOpeningPeriod } from '../src/services/places.js';

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
  const result = resolveOpeningHoursForDay({ date: '2026-08-18', periods: [period(1, 9, 1, 17)] });

  expect(result).toStrictEqual({ intervals: [], source: 'FRESH_PROVIDER', status: 'KNOWN' });
});

test('an open weekday resolves to its intervals', () => {
  const result = resolveOpeningHoursForDay({ date: '2026-08-17', periods: [period(1, 9, 1, 17)] });

  expect(result).toStrictEqual({
    intervals: [{ endMinute: 1020, startMinute: 540 }],
    source: 'FRESH_PROVIDER',
    status: 'KNOWN',
  });
});

test('no periods at all is unknown, since absence of a schedule proves nothing', () => {
  expect(resolveOpeningHoursForDay({ date: '2026-08-17', periods: [] })).toStrictEqual({
    status: 'UNKNOWN',
  });
});

test('hours need only their destination-local periods, with no offset or timezone context', () => {
  expect(resolveOpeningHoursForDay({ date: '2026-08-17', periods: [period(1, 9, 1, 17)] })).toEqual(
    {
      status: 'KNOWN',
      source: 'FRESH_PROVIDER',
      intervals: [{ startMinute: 540, endMinute: 1020 }],
    },
  );
});
