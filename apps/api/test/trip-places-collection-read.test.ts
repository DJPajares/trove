import Fastify from 'fastify';
import { beforeEach, expect, test, vi } from 'vitest';

const provider = vi.hoisted(() => ({ getDetails: vi.fn() }));
vi.mock('../src/services/places-runtime.js', () => ({
  createPlacesService: () => provider,
}));

import { listItinerary } from '../src/services/itineraries.js';
import { listTripPlaces } from '../src/services/trip-places.js';
import { createItineraryControllers } from '../src/controllers/itineraries.js';

const reference = {
  cachedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
  cachedLanguageCode: 'en',
  cachedLatitude: 1,
  cachedLongitude: 2,
  cachedName: 'Expired provider name',
  cachedTypes: ['museum'],
  externalPlaceId: 'museum-id',
  provider: 'GOOGLE',
};
const tripPlace = {
  _count: { itineraryItems: 0 },
  createdAt: new Date(),
  customName: 'Our museum',
  id: 'trip-place-id',
  note: 'Book ahead',
  place: {
    customLatitude: null,
    customLongitude: null,
    customName: null,
    customNote: null,
    customTimeZone: null,
    id: 'place-id',
    kind: 'PROVIDER',
    providerLabel: 'Museum',
    providerRefs: [reference],
    savedPlaces: [{ id: 'saved-id' }],
  },
  priority: 'MUST_GO',
};
let owned = true;

beforeEach(() => {
  owned = true;
  provider.getDetails.mockReset().mockResolvedValue({ status: 'unavailable' });
  (globalThis as { trovePrismaClient?: unknown }).trovePrismaClient = {
    placeProviderRef: { findMany: async () => [reference] },
    tripPlace: { findMany: async () => [tripPlace] },
    trip: {
      findFirst: async () =>
        owned
          ? {
              id: 'trip-id',
              name: 'Kyoto',
              startDate: new Date('2026-10-10'),
              endDate: new Date('2026-10-12'),
              referenceTimeZone: 'Asia/Tokyo',
              dayExperiences: [],
              itineraryDays: [],
              itineraryItems: [],
              reservations: [],
              tripPlaces: [tripPlace],
            }
          : null,
    },
  };
});

test('a collection read preserves trip metadata and Saved membership without refreshing stale evidence', async () => {
  const result = await listTripPlaces('owner', 'trip-id', 'en');
  expect(result.tripPlaces[0]).toMatchObject({
    customName: 'Our museum',
    isSaved: true,
    note: 'Book ahead',
    priority: 'must_go',
  });
  expect(provider.getDetails).not.toHaveBeenCalled();
});

test('the drawer can read itinerary use without acquiring provider data', async () => {
  const result = await listItinerary('owner', 'trip-id', 'en', { cachedOnly: true });
  expect(result.tripPlaces[0]).toMatchObject({ id: 'trip-place-id', customName: 'Our museum' });
  expect(provider.getDetails).not.toHaveBeenCalled();
});

test('cache-only reads preserve ownership checks', async () => {
  owned = false;
  await expect(listTripPlaces('other-user', 'trip-id')).rejects.toThrow('trip_not_found');
  await expect(listItinerary('other-user', 'trip-id', 'en', { cachedOnly: true })).rejects.toThrow(
    'trip_not_found',
  );
  expect(provider.getDetails).not.toHaveBeenCalled();
});

test('the itinerary endpoint honors cache-only reads and rejects invalid options', async () => {
  const app = Fastify();
  app.decorateRequest('authUserId', 'owner');
  app.get('/trips/:tripId/itinerary', createItineraryControllers().getItinerary);
  const url = '/trips/00000000-0000-4000-8000-000000000001/itinerary';
  expect((await app.inject(`${url}?cachedOnly=1`)).statusCode).toBe(200);
  expect((await app.inject(`${url}?cachedOnly=0`)).statusCode).toBe(400);
  expect(provider.getDetails).not.toHaveBeenCalled();
  await app.close();
});
