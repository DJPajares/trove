import { expect, test } from 'vitest';

import {
  calculateItineraryCoverage,
  deriveTripLifecycle,
  enumerateDateRange,
  getDateRangeChanges,
  isValidIanaTimeZone,
  resolveCountryPrimaryTimeZone,
  resolveTripWeatherLocation,
  resolveTripTimeZone,
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

test('accepts IANA timezone identifiers and safely rejects invalid values', () => {
  expect(isValidIanaTimeZone('Asia/Singapore')).toBe(true);
  expect(isValidIanaTimeZone('UTC')).toBe(true);
  expect(isValidIanaTimeZone('not-a-timezone')).toBe(false);
});

test('uses a country primary timezone only for a country-only destination', () => {
  expect(resolveCountryPrimaryTimeZone('New Zealand')).toBe('Pacific/Auckland');
  expect(resolveCountryPrimaryTimeZone('  new   zealand  ')).toBe('Pacific/Auckland');
  expect(resolveCountryPrimaryTimeZone('Auckland')).toBeNull();
  expect(resolveCountryPrimaryTimeZone('Auckland, New Zealand')).toBeNull();
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
