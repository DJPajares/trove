import { expect, test } from 'vitest';

import {
  createTripPlacesInTransaction,
  TRIP_CREATE_PLACE_LIMIT,
} from '../src/services/trip-create-places.js';

function fakeTransaction() {
  const places: Array<Record<string, unknown>> = [];
  const tripPlaces: Array<Record<string, unknown>> = [];
  return {
    places,
    tripPlaces,
    transaction: {
      place: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          places.push(data);
          return { id: `place-${places.length}` };
        },
      },
      tripPlace: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          tripPlaces.push(data);
          return data;
        },
      },
    } as never,
  };
}

test('each place becomes the owner’s Custom Place on the trip, in order', async () => {
  const fake = fakeTransaction();
  await createTripPlacesInTransaction(fake.transaction, 'owner', 'trip', [
    {
      category: 'things_to_do',
      latitude: 11.18,
      longitude: 119.39,
      name: ' El Dive ',
      priority: 'must_go',
    },
    { category: 'food_and_drink', latitude: 11.2, name: 'Art Cafe', priority: 'interested' },
    { name: 'Unsorted' },
  ]);

  expect(fake.places).toEqual([
    {
      categories: ['THINGS_TO_DO'],
      customLatitude: 11.18,
      customLongitude: 119.39,
      customName: 'El Dive',
      kind: 'CUSTOM',
      ownerId: 'owner',
    },
    // Half a coordinate is no location at all.
    {
      categories: ['FOOD_AND_DRINK'],
      customLatitude: null,
      customLongitude: null,
      customName: 'Art Cafe',
      kind: 'CUSTOM',
      ownerId: 'owner',
    },
    {
      categories: [],
      customLatitude: null,
      customLongitude: null,
      customName: 'Unsorted',
      kind: 'CUSTOM',
      ownerId: 'owner',
    },
  ]);
  expect(fake.tripPlaces).toEqual([
    { placeId: 'place-1', priority: 'MUST_GO', tripId: 'trip' },
    { placeId: 'place-2', priority: 'INTERESTED', tripId: 'trip' },
    { placeId: 'place-3', priority: null, tripId: 'trip' },
  ]);
});

test('a trip never carries more than the real-place limit', async () => {
  const fake = fakeTransaction();
  await createTripPlacesInTransaction(
    fake.transaction,
    'owner',
    'trip',
    Array.from({ length: TRIP_CREATE_PLACE_LIMIT + 5 }, (_, index) => ({ name: `Place ${index}` })),
  );
  expect(fake.places).toHaveLength(TRIP_CREATE_PLACE_LIMIT);
});
