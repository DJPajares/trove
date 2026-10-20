import { expect, test } from 'vitest';

import { reservationItemLabel, reservationPlaceName } from '../src/services/reservations.js';

function place(overrides: { customName?: string | null; cachedName?: string | null } = {}) {
  return {
    customLatitude: null,
    customLongitude: null,
    customName: overrides.customName ?? null,
    customNote: null,
    customTimeZone: null,
    id: 'place-1',
    kind: overrides.customName ? ('CUSTOM' as const) : ('PROVIDER' as const),
    providerAddress: null,
    providerLabel: 'Shinjuku Granbell',
    providerRefs: overrides.customName
      ? []
      : [
          {
            cachedAt: new Date(),
            cachedName: overrides.cachedName ?? 'Shinjuku Granbell Hotel',
            externalPlaceId: 'ChIJ-granbell',
            provider: 'GOOGLE' as const,
          },
        ],
  };
}

test('a Google place linked to a reservation is named, not left "Unnamed"', () => {
  // The regression: this service named trip places by `place.customName`,
  // which every provider-backed Place leaves null.
  expect(reservationPlaceName({ customName: null, place: place() })).toBe(
    'Shinjuku Granbell Hotel',
  );
});

test('the trip’s own name for a place wins', () => {
  expect(reservationPlaceName({ customName: 'Our hotel', place: place() })).toBe('Our hotel');
});

test('an itinerary stop backed by a place is named by that place', () => {
  expect(
    reservationItemLabel({
      customLabel: null,
      customLocation: null,
      tripPlace: { customName: null, place: place() },
    }),
  ).toBe('Shinjuku Granbell Hotel');
  expect(
    reservationItemLabel({
      customLabel: null,
      customLocation: 'Shibuya Crossing',
      tripPlace: null,
    }),
  ).toBe('Shibuya Crossing');
  expect(
    reservationItemLabel({ customLabel: 'Dinner', customLocation: null, tripPlace: null }),
  ).toBe('Dinner');
});
