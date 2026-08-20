import { expect, test } from 'vitest';

import {
  describeCapturedLocalChange,
  deriveCapturedLocal,
  resolveMemoryTimeZone,
} from '../src/services/memories-rules.js';

const TRIP_TIME_ZONE = 'Asia/Singapore';

function resolve(overrides: Partial<Parameters<typeof resolveMemoryTimeZone>[0]>) {
  return resolveMemoryTimeZone({
    itineraryDayTimeZone: null,
    itineraryItemTimeZone: null,
    tripPlaceTimeZone: null,
    tripTimeZone: TRIP_TIME_ZONE,
    ...overrides,
  });
}

test('resolves memory timezone from item, then Place, then day, then trip reference', () => {
  expect(
    resolve({
      itineraryDayTimeZone: 'Europe/Lisbon',
      itineraryItemTimeZone: 'Pacific/Auckland',
      tripPlaceTimeZone: 'Australia/Sydney',
    }),
  ).toStrictEqual({ source: 'ITINERARY_ITEM', timeZone: 'Pacific/Auckland' });
  expect(
    resolve({ itineraryDayTimeZone: 'Europe/Lisbon', tripPlaceTimeZone: 'Australia/Sydney' }),
  ).toStrictEqual({ source: 'TRIP_PLACE', timeZone: 'Australia/Sydney' });
  expect(resolve({ itineraryDayTimeZone: 'Europe/Lisbon' })).toStrictEqual({
    source: 'ITINERARY_DAY',
    timeZone: 'Europe/Lisbon',
  });
  expect(resolve({})).toStrictEqual({ source: 'TRIP_REFERENCE', timeZone: TRIP_TIME_ZONE });
});

test('skips unusable timezone identifiers rather than trusting them', () => {
  expect(
    resolve({ itineraryDayTimeZone: 'Europe/Lisbon', itineraryItemTimeZone: 'Not/AZone' }),
  ).toStrictEqual({ source: 'ITINERARY_DAY', timeZone: 'Europe/Lisbon' });
});

test('derives the local representation from the authoritative captured instant', () => {
  const instant = new Date('2026-09-05T01:30:00.000Z');

  expect(deriveCapturedLocal(instant, 'Asia/Singapore')).toStrictEqual({
    date: '2026-09-05',
    time: '09:30',
  });
  expect(deriveCapturedLocal(instant, 'America/New_York')).toStrictEqual({
    date: '2026-09-04',
    time: '21:30',
  });
});

test('surfaces when correcting the timezone moves a memory to another calendar day', () => {
  const instant = new Date('2026-09-05T01:30:00.000Z');
  const acrossMidnight = describeCapturedLocalChange(
    instant,
    { timeZone: 'Asia/Singapore' },
    { timeZone: 'America/New_York' },
  );
  const sameDay = describeCapturedLocalChange(
    instant,
    { timeZone: 'Asia/Singapore' },
    { timeZone: 'Asia/Tokyo' },
  );

  expect(acrossMidnight).toStrictEqual({
    after: { date: '2026-09-04', time: '21:30' },
    before: { date: '2026-09-05', time: '09:30' },
    localDateChanged: true,
  });
  expect(sameDay.localDateChanged).toBe(false);
  expect(sameDay.after.time).toBe('10:30');
});
