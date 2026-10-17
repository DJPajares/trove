import { beforeEach, expect, test } from 'vitest';

import { installFakePrismaClient, resetStore, store } from './support/fake-prisma.js';

installFakePrismaClient();
const { effectiveCategories, placeTypeCategories } =
  await import('../src/services/place-categories.js');
const { tripPlaceCategories } = await import('../src/services/place-serializer.js');
const { markTripPlacesAsStay } = await import('../src/services/place-category-signals.js');
const { updateTripPlace } = await import('../src/services/trip-places.js');

test('provider types become every Trove category they describe, primary first', () => {
  expect(placeTypeCategories(['restaurant', 'hotel', 'lodging'], 'hotel')).toEqual([
    'stay',
    'food_and_drink',
  ]);
  expect(placeTypeCategories(['hostel'])).toEqual(['stay']);
  expect(placeTypeCategories(['point_of_interest', 'establishment'])).toEqual(['other']);
  expect(placeTypeCategories([])).toEqual(['other']);
});

test('additions join what a place already is and never take it away', () => {
  expect(effectiveCategories(['other'], ['stay'])).toEqual(['stay']);
  expect(effectiveCategories(['food_and_drink'], [], ['stay'])).toEqual(['food_and_drink', 'stay']);
  expect(effectiveCategories(['other'], [])).toEqual(['other']);
  // A trip adds to a provider Place; the traveller edits only what they added.
  expect(
    tripPlaceCategories({ categories: ['other'], kind: 'provider', manualCategories: [] }, [
      'STAY',
    ]),
  ).toEqual({ categories: ['stay'], manualCategories: ['stay'] });
  // A Custom Place's own categories are what its owner edits, on any trip.
  expect(
    tripPlaceCategories({ categories: ['stay'], kind: 'custom', manualCategories: ['stay'] }, []),
  ).toEqual({ categories: ['stay'], manualCategories: ['stay'] });
});

beforeEach(() => {
  resetStore();
  store.trip.push({ id: 'trip', ownerId: 'owner' });
  const place = {
    customLatitude: null,
    customLongitude: null,
    customName: null,
    customNote: null,
    customTimeZone: null,
    providerAddress: null,
    providerLabel: null,
    providerRefs: [],
    savedPlaces: [],
  };
  store.place.push(
    { ...place, customName: 'Our flat', id: 'home', kind: 'CUSTOM', ownerId: 'owner' },
    { ...place, id: 'shared', kind: 'PROVIDER', ownerId: null },
  );
  const tripPlace = {
    createdAt: new Date(),
    customName: null,
    note: null,
    priority: null,
    tripId: 'trip',
  };
  store.tripPlace.push(
    { ...tripPlace, id: 'tp-home', placeId: 'home' },
    { ...tripPlace, id: 'tp-shared', placeId: 'shared' },
  );
});

test("a Custom Place's categories live on the Place; a shared Place's on the trip", async () => {
  await updateTripPlace('owner', 'trip', 'tp-home', { categories: ['stay'] });
  await updateTripPlace('owner', 'trip', 'tp-shared', { categories: ['stay', 'food_and_drink'] });

  expect(store.place.find((place) => place.id === 'home')?.categories).toEqual(['STAY']);
  expect(store.place.find((place) => place.id === 'shared')?.categories).toBeUndefined();
  expect(store.tripPlace.find((tripPlace) => tripPlace.id === 'tp-shared')?.categories).toEqual([
    'STAY',
    'FOOD_AND_DRINK',
  ]);
});

test('where a trip sleeps is marked a stay once, wherever it belongs', async () => {
  await markTripPlacesAsStay('trip', ['tp-home', 'tp-shared', 'tp-shared', null]);
  await markTripPlacesAsStay('trip', ['tp-home', 'tp-shared']);

  expect(store.place.find((place) => place.id === 'home')?.categories).toEqual(['STAY']);
  expect(store.tripPlace.find((tripPlace) => tripPlace.id === 'tp-shared')?.categories).toEqual([
    'STAY',
  ]);
});
