import { beforeEach, expect, test } from 'vitest';

import { searchTrove } from '../src/services/search.js';
import type { PlacesService } from '../src/services/places.js';

const trip = { id: 'trip-id', name: 'Kyoto' };
const empty = { findMany: async () => [] };

beforeEach(() => {
  (globalThis as { trovePrismaClient?: unknown }).trovePrismaClient = {
    trip: empty,
    savedPlace: empty,
    reservation: empty,
    tripInfo: empty,
    itineraryDay: empty,
    itineraryItem: empty,
    memory: empty,
    tripPlace: {
      findMany: async () => [
        { id: 'named-place', note: null, place: { customName: 'Museum', customNote: null }, trip },
        {
          id: 'noted-place',
          note: 'Museum tickets booked',
          place: { customName: 'Gallery', customNote: null },
          trip,
        },
      ],
    },
    placeProviderRef: {
      findMany: async () => [
        {
          externalPlaceId: 'provider-id',
          place: { savedPlaces: [], tripPlaces: [{ id: 'provider-place', trip }] },
        },
      ],
    },
  };
});

test('trip-place names and notes open the collection over the trip hub', async () => {
  const result = await searchTrove('owner', 'Museum');
  const places = result.groups.flatMap((group) => group.results);
  expect(places).toHaveLength(2);
  expect(places.map((place) => [place.kind, place.href])).toEqual([
    ['trip_place', '/trips/trip-id?places=1'],
    ['note', '/trips/trip-id?places=1'],
  ]);
});

test('provider matches already on a trip use the same contextual destination', async () => {
  const placesService = {
    search: async () => ({
      status: 'ok',
      suggestions: [
        {
          externalPlaceId: 'provider-id',
          name: 'Museum',
          description: 'Kyoto',
          provider: 'google',
        },
      ],
    }),
  } as unknown as PlacesService;
  const result = await searchTrove('owner', 'Museum', { includePlaces: true, placesService });
  const found = result.groups
    .flatMap((group) => group.results)
    .find((place) => place.id === 'provider-place');
  expect(found?.href).toBe('/trips/trip-id?places=1');
});
