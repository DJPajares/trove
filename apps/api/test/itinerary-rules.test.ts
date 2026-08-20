import { expect, test } from 'vitest';

import {
  floatingLocalTimeToInstant,
  formatInstantInTimeZone,
  formatLocalTime,
  parseLocalTime,
  resolveDayTimeZone,
  resolveItemTimeZone,
  resolveTaskTimeZone,
} from '../src/services/itinerary-rules.js';

test('persists a floating local plan as a deterministic derived instant', () => {
  expect(floatingLocalTimeToInstant('2026-08-12', '09:30', 'Asia/Singapore').toISOString()).toBe(
    '2026-08-12T01:30:00.000Z',
  );
  expect(formatLocalTime(parseLocalTime('09:30'))).toBe('09:30');
});

test('formats one authoritative instant independently for flight departure and arrival timezones', () => {
  const instant = new Date('2026-09-05T01:30:00.000Z');

  expect(formatInstantInTimeZone(instant, 'Asia/Singapore')).toStrictEqual({
    date: '2026-09-05',
    time: '09:30',
  });
  expect(formatInstantInTimeZone(instant, 'Pacific/Auckland')).toStrictEqual({
    date: '2026-09-05',
    time: '13:30',
  });
});

test('rejects local civil times that do not exist during a daylight-saving jump', () => {
  expect(() => floatingLocalTimeToInstant('2026-03-08', '02:30', 'America/New_York')).toThrow(
    /invalid_local_time/,
  );
});

test('resolves item timezone from location, Place, then persisted day context', () => {
  expect(
    resolveItemTimeZone({
      customLocationTimeZone: 'Pacific/Auckland',
      dayTimeZone: 'Asia/Singapore',
      tripPlaceTimeZone: 'Australia/Sydney',
    }),
  ).toStrictEqual({ source: 'EXPLICIT', timeZone: 'Pacific/Auckland' });
  expect(
    resolveItemTimeZone({
      customLocationTimeZone: null,
      dayTimeZone: 'Asia/Singapore',
      tripPlaceTimeZone: 'Australia/Sydney',
    }),
  ).toStrictEqual({ source: 'PLACE', timeZone: 'Australia/Sydney' });
  expect(
    resolveItemTimeZone({
      customLocationTimeZone: null,
      dayTimeZone: 'Asia/Singapore',
      tripPlaceTimeZone: null,
    }),
  ).toStrictEqual({ source: 'DAY_DEFAULT', timeZone: 'Asia/Singapore' });
});

test('resolves a day from daily base, first ordered located item, then trip timezone', () => {
  const items = [
    {
      customLocationTimeZone: null,
      id: 'unresolved',
      tripPlaceId: null,
      tripPlaceTimeZone: null,
    },
    {
      customLocationTimeZone: 'Pacific/Auckland',
      id: 'located',
      tripPlaceId: null,
      tripPlaceTimeZone: null,
    },
  ];

  expect(
    resolveDayTimeZone({
      accommodations: [],
      dailyBase: { timeZone: 'Australia/Sydney', tripPlaceId: 'base' },
      items,
      tripTimeZone: 'Asia/Singapore',
    }),
  ).toStrictEqual({
    source: 'EXPLICIT_DAILY_BASE',
    sourceItemId: null,
    sourceTripPlaceId: 'base',
    timeZone: 'Australia/Sydney',
  });
  expect(
    resolveDayTimeZone({
      accommodations: [],
      dailyBase: null,
      items,
      tripTimeZone: 'Asia/Singapore',
    }),
  ).toStrictEqual({
    source: 'FIRST_LOCATED_ITEM',
    sourceItemId: 'located',
    sourceTripPlaceId: null,
    timeZone: 'Pacific/Auckland',
  });
  expect(
    resolveDayTimeZone({
      accommodations: [],
      dailyBase: null,
      items: [],
      tripTimeZone: 'Asia/Singapore',
    }),
  ).toStrictEqual({
    source: 'TRIP_REFERENCE',
    sourceItemId: null,
    sourceTripPlaceId: null,
    timeZone: 'Asia/Singapore',
  });
});

test('uses one applicable accommodation as a day base without guessing across overlaps', () => {
  expect(
    resolveDayTimeZone({
      accommodations: [{ timeZone: 'Pacific/Auckland', tripPlaceId: 'stay' }],
      dailyBase: null,
      items: [],
      tripTimeZone: 'Asia/Singapore',
    }),
  ).toStrictEqual({
    source: 'ACCOMMODATION',
    sourceItemId: null,
    sourceTripPlaceId: 'stay',
    timeZone: 'Pacific/Auckland',
  });
  expect(
    resolveDayTimeZone({
      accommodations: [
        { timeZone: 'Pacific/Auckland', tripPlaceId: 'stay-one' },
        { timeZone: 'Australia/Sydney', tripPlaceId: 'stay-two' },
      ],
      dailyBase: null,
      items: [],
      tripTimeZone: 'Asia/Singapore',
    }),
  ).toStrictEqual({
    source: 'TRIP_REFERENCE',
    sourceItemId: null,
    sourceTripPlaceId: null,
    timeZone: 'Asia/Singapore',
  });
});

test('resolves task timezone from its item, then day, then trip reference', () => {
  expect(
    resolveTaskTimeZone({
      itineraryDayTimeZone: 'Asia/Singapore',
      itineraryItemTimeZone: 'Pacific/Auckland',
      tripTimeZone: 'Europe/London',
    }),
  ).toStrictEqual({ source: 'ITINERARY_ITEM', timeZone: 'Pacific/Auckland' });
  expect(
    resolveTaskTimeZone({
      itineraryDayTimeZone: 'Asia/Singapore',
      itineraryItemTimeZone: null,
      tripTimeZone: 'Europe/London',
    }),
  ).toStrictEqual({ source: 'ITINERARY_DAY', timeZone: 'Asia/Singapore' });
  expect(
    resolveTaskTimeZone({
      itineraryDayTimeZone: null,
      itineraryItemTimeZone: null,
      tripTimeZone: 'Europe/London',
    }),
  ).toStrictEqual({ source: 'TRIP_REFERENCE', timeZone: 'Europe/London' });
});
