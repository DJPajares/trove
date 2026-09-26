import { expect, test } from 'vitest';

import {
  floatingLocalTimeToInstant,
  resolveDayTimeZone,
  resolveItemTimeZone,
} from '../src/services/itinerary-rules.js';
import { timeZoneAtCoordinates } from '../src/services/coordinate-time-zone.js';
import { resolvedPlaceTimeZone } from '../src/services/place-data.js';
import { resolveTripTimeZone } from '../src/services/trip-rules.js';

const NOW = new Date('2026-09-26T00:00:00.000Z');

function providerPlace(latitude: number, longitude: number, cachedAt = NOW) {
  return {
    customTimeZone: null,
    kind: 'PROVIDER' as const,
    providerRefs: [
      {
        cachedAt,
        cachedLatitude: latitude,
        cachedLongitude: longitude,
        cachedTimeZone: null as string | null,
        externalPlaceId: 'review-place',
        provider: 'GOOGLE' as const,
      },
    ],
  };
}

test('precise provider coordinates beat a multi-zone country default for a stop and base', () => {
  const phoenix = resolvedPlaceTimeZone(providerPlace(33.4484, -112.074), NOW);
  expect(phoenix).toBe('America/Phoenix');
  const trip = resolveTripTimeZone({
    countries: ['US'],
    destinations: [],
    deviceTimeZone: 'Asia/Singapore',
    profileHome: null,
    startingLocation: null,
  });
  expect(trip.timeZone).not.toBe(phoenix);
  expect(
    resolveItemTimeZone({
      customLocationTimeZone: null,
      dayTimeZone: trip.timeZone,
      tripPlaceTimeZone: phoenix,
    }),
  ).toStrictEqual({ source: 'PLACE', timeZone: phoenix });
  expect(
    resolveDayTimeZone({
      accommodations: [],
      dailyBase: { timeZone: phoenix, tripPlaceId: 'base' },
      items: [],
      tripTimeZone: trip.timeZone,
    }),
  ).toMatchObject({ source: 'EXPLICIT_DAILY_BASE', timeZone: phoenix });
});

test('cross-border stops use their own zones and keep floating local clocks', () => {
  const newYork = resolvedPlaceTimeZone(providerPlace(40.7128, -74.006), NOW);
  const vancouver = resolvedPlaceTimeZone(providerPlace(49.2827, -123.1207), NOW);
  expect(newYork).toBe('America/New_York');
  expect(vancouver).toBe('America/Vancouver');
  expect(floatingLocalTimeToInstant('2026-09-26', '09:00', newYork!).toISOString()).toBe(
    '2026-09-26T13:00:00.000Z',
  );
  expect(floatingLocalTimeToInstant('2026-09-26', '09:00', vancouver!).toISOString()).toBe(
    '2026-09-26T16:00:00.000Z',
  );
});

test('location-derived zones retain DST gap and fold behavior', () => {
  const zone = resolvedPlaceTimeZone(providerPlace(40.7128, -74.006), NOW)!;
  expect(() => floatingLocalTimeToInstant('2026-03-08', '02:30', zone)).toThrow(
    /invalid_local_time/,
  );
  const folded = floatingLocalTimeToInstant('2026-11-01', '01:30', zone).toISOString();
  expect(['2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z']).toContain(folded);
  expect(floatingLocalTimeToInstant('2026-11-01', '01:30', zone).toISOString()).toBe(folded);
});

test('explicit corrections win and a moved or stale snapshot cannot masquerade as current location', () => {
  const place = providerPlace(33.4484, -112.074);
  expect(resolvedPlaceTimeZone({ ...place, customTimeZone: 'America/Denver' }, NOW)).toBe(
    'America/Denver',
  );
  expect(resolvedPlaceTimeZone(place, NOW)).toBe('America/Phoenix');
  expect(resolvedPlaceTimeZone(providerPlace(40.7128, -74.006), NOW)).toBe('America/New_York');
  expect(
    resolvedPlaceTimeZone(providerPlace(33.4484, -112.074, new Date('2026-08-01')), NOW),
  ).toBeNull();
  expect(timeZoneAtCoordinates({ latitude: 99, longitude: 1 })).toBeNull();
  expect(
    resolvedPlaceTimeZone(
      {
        ...place,
        providerRefs: [
          { ...place.providerRefs[0]!, cachedLatitude: null, cachedTimeZone: 'America/Phoenix' },
        ],
      },
      NOW,
    ),
  ).toBeNull();
});

test('a refreshed location replaces its stored timezone without a provider timezone request', () => {
  const place = providerPlace(33.4484, -112.074);
  place.providerRefs[0]!.cachedTimeZone = 'America/Phoenix';
  expect(resolvedPlaceTimeZone(place, NOW)).toBe('America/Phoenix');

  const refreshed = providerPlace(40.7128, -74.006);
  refreshed.providerRefs[0]!.cachedTimeZone = timeZoneAtCoordinates({
    latitude: 40.7128,
    longitude: -74.006,
  });
  expect(resolvedPlaceTimeZone(refreshed, NOW)).toBe('America/New_York');
  expect(resolvedPlaceTimeZone({ ...refreshed, customTimeZone: 'America/Denver' }, NOW)).toBe(
    'America/Denver',
  );
});
