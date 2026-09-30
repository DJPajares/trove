import { expect, test } from 'vitest';

import type { SavedPlace } from '@/lib/saved/api';
import { DESTINATION_REACH_KM, savedPlacesNearTrip } from '@/lib/trip-places/saved-near-trip';

// One degree of longitude at the equator is ~111 km.
const at = (km: number) => ({ latitude: 0, longitude: km / 111.32 });

const saved = (
  id: string,
  km: number | null,
  overrides: { stale?: boolean; placeId?: string } = {},
): SavedPlace =>
  ({
    collections: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    id,
    note: null,
    place: {
      id: overrides.placeId ?? `place-${id}`,
      kind: 'provider',
      location: km === null ? null : { ...at(km), timeZone: null },
      name: id,
      note: null,
      providerAddress: null,
      providerLabel: null,
      providerRefs: [],
      snapshot: overrides.stale ? ({ stale: true } as never) : null,
    },
  }) as SavedPlace;

const kyoto = { location: at(0), name: 'Kyoto' };
const tokyo = { location: at(400), name: 'Tokyo' };

test('saved places in a destination are grouped under its name', () => {
  const groups = savedPlacesNearTrip({
    destinations: [kyoto, tokyo],
    saved: [saved('a', 5), saved('b', 395), saved('c', 10)],
    tripPlaceIds: new Set(),
  });

  expect(
    groups.map((group) => [group.destinationName, group.places.map((p) => p.id)]),
  ).toStrictEqual([
    ['Kyoto', ['a', 'c']],
    ['Tokyo', ['b']],
  ]);
});

test('already on the trip, too far, unlocated or with an expired location: not offered', () => {
  const groups = savedPlacesNearTrip({
    destinations: [kyoto],
    saved: [
      saved('on-trip', 1, { placeId: 'already' }),
      saved('far', DESTINATION_REACH_KM + 5),
      saved('nowhere', null),
      saved('stale', 1, { stale: true }),
      saved('ok', 2),
    ],
    tripPlaceIds: new Set(['already']),
  });

  expect(groups.flatMap((group) => group.places.map((p) => p.id))).toStrictEqual(['ok']);
});

test('a trip with no located destination offers nothing', () => {
  expect(
    savedPlacesNearTrip({
      destinations: [{ name: 'Somewhere', location: null }, { name: 'Elsewhere' }],
      saved: [saved('a', 0)],
      tripPlaceIds: new Set(),
    }),
  ).toStrictEqual([]);
});
