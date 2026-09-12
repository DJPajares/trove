import { expect, test } from 'vitest';

import {
  calculateItineraryCoverage,
  dayOffset,
  deriveTripLifecycle,
  enumerateDateRange,
  getDateRangeChanges,
  isValidIanaTimeZone,
  resolveCountryPrimaryTimeZone,
  resolveDestinationCountryCode,
  resolveTripWeatherLocation,
  resolveTripTimeZone,
  shiftDateOnly,
} from '../src/services/trip-rules.js';

test('calculates itinerary coverage at zero, partial, and full day presence', () => {
  expect(calculateItineraryCoverage('2026-08-10', '2026-08-12', [])).toStrictEqual({
    percentage: 0,
    plannedDays: 0,
    totalDays: 3,
  });
  expect(
    calculateItineraryCoverage('2026-08-10', '2026-08-12', [
      { date: '2026-08-10', scheduledItemCount: 2 },
      { date: '2026-08-11', scheduledItemCount: 0 },
    ]),
  ).toStrictEqual({ percentage: 33, plannedDays: 1, totalDays: 3 });
  expect(
    calculateItineraryCoverage('2026-08-10', '2026-08-12', [
      { date: '2026-08-10', scheduledItemCount: 1 },
      { date: '2026-08-11', scheduledItemCount: 3 },
      { date: '2026-08-12', scheduledItemCount: 1 },
    ]),
  ).toStrictEqual({ percentage: 100, plannedDays: 3, totalDays: 3 });
});

test('excludes unscheduled items and records outside the trip range from coverage', () => {
  const unscheduledItems = [{ itineraryDayId: null }, { itineraryDayId: null }];
  const scheduledDayCounts = [
    { date: new Date('2026-08-10T00:00:00.000Z'), scheduledItemCount: 1 },
    { date: '2026-08-13', scheduledItemCount: 4 },
  ];

  expect(unscheduledItems.every((item) => item.itineraryDayId === null)).toBe(true);
  expect(calculateItineraryCoverage('2026-08-10', '2026-08-12', scheduledDayCounts)).toStrictEqual({
    percentage: 33,
    plannedDays: 1,
    totalDays: 3,
  });
});

test('uses the first located destination for weather and keeps its timezone', () => {
  expect(
    resolveTripWeatherLocation(
      [
        { location: null, timeZone: null },
        {
          location: { latitude: 35.68, longitude: 139.76, timeZone: null },
          timeZone: 'Asia/Tokyo',
        },
        {
          location: { latitude: 34.69, longitude: 135.5, timeZone: 'Asia/Tokyo' },
          timeZone: null,
        },
      ],
      'UTC',
    ),
  ).toStrictEqual({ latitude: 35.68, longitude: 139.76, timeZone: 'Asia/Tokyo' });
});

test('omits trip weather when no destination has cached coordinates', () => {
  expect(
    resolveTripWeatherLocation(
      [
        { location: null, timeZone: 'Europe/Paris' },
        { location: null, timeZone: null },
      ],
      'UTC',
    ),
  ).toBeNull();
});

test('derives lifecycle from the persisted trip timezone with inclusive date boundaries', () => {
  const instant = new Date('2026-08-10T15:00:00.000Z');

  expect(deriveTripLifecycle('2026-08-11', '2026-08-12', 'Asia/Tokyo', instant)).toBe('active');
  expect(deriveTripLifecycle('2026-08-11', '2026-08-12', 'America/New_York', instant)).toBe(
    'planning',
  );
  expect(
    deriveTripLifecycle(
      '2026-08-09',
      '2026-08-10',
      'Asia/Tokyo',
      new Date('2026-08-10T16:00:00.000Z'),
    ),
  ).toBe('completed');
});

test('enumerates every inclusive itinerary date and rejects inverted ranges', () => {
  expect(enumerateDateRange('2026-08-10', '2026-08-12')).toStrictEqual([
    '2026-08-10',
    '2026-08-11',
    '2026-08-12',
  ]);
  expect(() => enumerateDateRange('2026-08-12', '2026-08-10')).toThrow(/invalid_date_range/);
  expect(() => enumerateDateRange('2026-02-30', '2026-03-02')).toThrow(/invalid_date/);
});

test('separates removed, retained, and newly expanded itinerary dates', () => {
  expect(
    getDateRangeChanges(['2026-08-10', '2026-08-11', '2026-08-12'], '2026-08-11', '2026-08-14'),
  ).toStrictEqual({
    missingDates: ['2026-08-13', '2026-08-14'],
    removedDates: ['2026-08-10'],
    retainedDates: ['2026-08-11', '2026-08-12'],
  });
});

test('resolves reference timezone in the PRD fallback order', () => {
  const common = {
    destinations: [
      { placeId: 'destination-unresolved', timeZone: null },
      { placeId: 'destination-resolved', timeZone: 'Asia/Tokyo' },
    ],
    deviceTimeZone: 'Asia/Singapore',
    profileHome: { placeId: 'home', timeZone: 'Australia/Sydney' },
    startingLocation: { placeId: 'start', timeZone: 'Europe/Paris' },
  };

  expect(resolveTripTimeZone({ ...common, explicitTimeZone: 'America/New_York' })).toStrictEqual({
    source: 'EXPLICIT',
    sourcePlaceId: null,
    timeZone: 'America/New_York',
  });
  expect(resolveTripTimeZone(common)).toStrictEqual({
    source: 'DESTINATION',
    sourcePlaceId: 'destination-resolved',
    timeZone: 'Asia/Tokyo',
  });
  expect(resolveTripTimeZone({ ...common, destinations: [] })).toStrictEqual({
    source: 'STARTING_LOCATION',
    sourcePlaceId: 'start',
    timeZone: 'Europe/Paris',
  });
  expect(
    resolveTripTimeZone({ ...common, destinations: [], startingLocation: null }),
  ).toStrictEqual({
    source: 'PROFILE_HOME',
    sourcePlaceId: 'home',
    timeZone: 'Australia/Sydney',
  });
  expect(
    resolveTripTimeZone({
      ...common,
      destinations: [],
      profileHome: null,
      startingLocation: null,
    }),
  ).toStrictEqual({
    source: 'DEVICE_FALLBACK',
    sourcePlaceId: null,
    timeZone: 'Asia/Singapore',
  });
});

test('resolves the declared country below a destination and above the starting location', () => {
  const common = {
    countries: ['JP', 'KR'],
    deviceTimeZone: 'Asia/Singapore',
    destinations: [{ placeId: 'destination-resolved', timeZone: 'Europe/Rome' }],
    profileHome: { placeId: 'home', timeZone: 'Australia/Sydney' },
    startingLocation: { placeId: 'start', timeZone: 'Europe/Paris' },
  };

  // A destination that resolves still wins: it says where inside a country the
  // traveller actually is.
  expect(resolveTripTimeZone(common)).toStrictEqual({
    source: 'DESTINATION',
    sourcePlaceId: 'destination-resolved',
    timeZone: 'Europe/Rome',
  });
  // With no destination the first declared country answers, in the order the
  // traveller picked - not the place they are leaving from.
  expect(resolveTripTimeZone({ ...common, destinations: [] })).toStrictEqual({
    source: 'COUNTRY',
    sourcePlaceId: null,
    timeZone: 'Asia/Tokyo',
  });
  // A country Trove has no zone for is skipped rather than failing the trip.
  expect(
    resolveTripTimeZone({ ...common, countries: ['ZZ', 'KR'], destinations: [] }),
  ).toStrictEqual({
    source: 'COUNTRY',
    sourcePlaceId: null,
    timeZone: 'Asia/Seoul',
  });
  // A trip from before countries were asked for falls through untouched.
  expect(resolveTripTimeZone({ ...common, countries: [], destinations: [] })).toStrictEqual({
    source: 'STARTING_LOCATION',
    sourcePlaceId: 'start',
    timeZone: 'Europe/Paris',
  });
});

test('accepts IANA timezone identifiers and safely rejects invalid values', () => {
  expect(isValidIanaTimeZone('Asia/Singapore')).toBe(true);
  expect(isValidIanaTimeZone('UTC')).toBe(true);
  expect(isValidIanaTimeZone('not-a-timezone')).toBe(false);
});

test('uses a named country to infer a destination timezone without guessing bare cities', () => {
  expect(resolveCountryPrimaryTimeZone('Japan')).toBe('Asia/Tokyo');
  expect(resolveCountryPrimaryTimeZone('Kyoto, Japan')).toBe('Asia/Tokyo');
  expect(resolveCountryPrimaryTimeZone('New Zealand')).toBe('Pacific/Auckland');
  expect(resolveCountryPrimaryTimeZone('  new   zealand  ')).toBe('Pacific/Auckland');
  expect(resolveCountryPrimaryTimeZone('Auckland, New Zealand')).toBe('Pacific/Auckland');
  expect(resolveCountryPrimaryTimeZone('Queenstown, Otago, New Zealand')).toBe('Pacific/Auckland');
  expect(resolveCountryPrimaryTimeZone('Auckland')).toBeNull();
  expect(resolveCountryPrimaryTimeZone('Auckland, Somewhere unknown')).toBeNull();
});

test('gives a multi-zone country the zone most of it lives in', () => {
  expect(resolveCountryPrimaryTimeZone('United States of America')).toBe('America/New_York');
  expect(resolveCountryPrimaryTimeZone('Australia')).toBe('Australia/Sydney');
  expect(resolveCountryPrimaryTimeZone('Canada')).toBe('America/Toronto');
  expect(resolveCountryPrimaryTimeZone('Russia')).toBe('Europe/Moscow');
  expect(resolveCountryPrimaryTimeZone('Brazil')).toBe('America/Sao_Paulo');
  expect(resolveCountryPrimaryTimeZone('Mexico')).toBe('America/Mexico_City');
  expect(resolveCountryPrimaryTimeZone('Sydney, Australia')).toBe('Australia/Sydney');
  expect(resolveCountryPrimaryTimeZone('Toronto, Ontario, Canada')).toBe('America/Toronto');
});

test('resolves the everyday country name alongside the formal one', () => {
  expect(resolveCountryPrimaryTimeZone('United States')).toBe('America/New_York');
  expect(resolveCountryPrimaryTimeZone('New York, United States')).toBe('America/New_York');
  expect(resolveCountryPrimaryTimeZone('Cape Verde')).toBe('Atlantic/Cape_Verde');
  expect(resolveCountryPrimaryTimeZone('Cabo Verde')).toBe('Atlantic/Cape_Verde');
});

test('falls back to the library for countries the home-country map omits', () => {
  expect(resolveCountryPrimaryTimeZone('Antarctica')).toBe('Antarctica/Casey');
  expect(resolveCountryPrimaryTimeZone('South Georgia and the South Sandwich Islands')).toBe(
    'Atlantic/South_Georgia',
  );
});

test('keeps explicit and Place-specific timezones ahead of country inference', () => {
  const countryTimeZone = resolveCountryPrimaryTimeZone('New Zealand');

  expect(
    resolveTripTimeZone({
      destinations: [{ placeId: 'new-zealand', timeZone: countryTimeZone }],
      deviceTimeZone: 'Asia/Singapore',
      explicitTimeZone: 'Pacific/Chatham',
      profileHome: null,
      startingLocation: null,
    }),
  ).toEqual({
    source: 'EXPLICIT',
    sourcePlaceId: null,
    timeZone: 'Pacific/Chatham',
  });
  expect(
    resolveTripTimeZone({
      destinations: [{ placeId: 'new-zealand-place', timeZone: 'Pacific/Chatham' }],
      deviceTimeZone: 'Asia/Singapore',
      profileHome: null,
      startingLocation: null,
    }),
  ).toEqual({
    source: 'DESTINATION',
    sourcePlaceId: 'new-zealand-place',
    timeZone: 'Pacific/Chatham',
  });
});

test('shifts a date across month, year, and leap-day boundaries', () => {
  expect(shiftDateOnly('2026-09-28', 3)).toBe('2026-10-01');
  expect(shiftDateOnly('2026-01-02', -3)).toBe('2025-12-30');
  // 2028 is a leap year, so a week from the 26th lands on the 4th, not the 5th.
  expect(shiftDateOnly('2028-02-26', 7)).toBe('2028-03-04');
  expect(shiftDateOnly('2026-09-15', 0)).toBe('2026-09-15');
});

test('measures the signed distance between two dates in whole days', () => {
  expect(dayOffset('2026-09-15', '2026-09-22')).toBe(7);
  expect(dayOffset('2026-09-22', '2026-09-15')).toBe(-7);
  expect(dayOffset('2026-09-15', '2026-09-15')).toBe(0);
  // Daylight saving moves the clocks inside this range in most of Europe; a
  // date-only distance must not notice.
  expect(dayOffset('2026-10-24', '2026-10-26')).toBe(2);
});

test('a named country in a destination resolves to its code', () => {
  expect(resolveDestinationCountryCode('Vietnam')).toBe('VN');
  expect(resolveDestinationCountryCode('Hanoi, Vietnam')).toBe('VN');
  // The library carries the formal name, so the everyday one is registered too.
  expect(resolveDestinationCountryCode('United States')).toBe('US');
});

/**
 * The same restraint the time zone resolver shows: a bare city is ambiguous, so
 * it stays unresolved rather than being guessed at. An AI-applied trip lands
 * with no country instead of the wrong one.
 */
test('a bare city names no country', () => {
  expect(resolveDestinationCountryCode('Hanoi')).toBeNull();
  expect(resolveDestinationCountryCode('Springfield')).toBeNull();
  expect(resolveDestinationCountryCode('')).toBeNull();
});
