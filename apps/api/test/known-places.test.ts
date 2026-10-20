import { beforeEach, expect, test, vi } from 'vitest';

const provider = vi.hoisted(() => ({ getDetails: vi.fn(), search: vi.fn() }));
vi.mock('../src/services/places-runtime.js', () => ({
  createPlacesService: () => provider,
}));

import { listKnownPlaces } from '../src/services/known-places.js';

const now = new Date('2026-10-20T00:00:00Z');
const day = 24 * 60 * 60 * 1000;

function providerPlace(id: string, name: string, cachedAt: Date) {
  return {
    categories: [],
    customLatitude: null,
    customLongitude: null,
    customName: null,
    customNote: null,
    customTimeZone: null,
    id,
    kind: 'PROVIDER',
    providerAddress: `${name} street`,
    providerLabel: `${name} (label)`,
    providerRefs: [
      {
        cachedAt,
        cachedLanguageCode: 'en',
        cachedLatitude: 35,
        cachedLongitude: 139,
        cachedName: name,
        cachedTypes: ['lodging'],
        externalPlaceId: `${id}-google`,
        provider: 'GOOGLE',
      },
    ],
  };
}

let findMany: ReturnType<typeof vi.fn>;

beforeEach(() => {
  provider.getDetails.mockReset();
  provider.search.mockReset();
  findMany = vi.fn(async () => [
    {
      ...providerPlace('hotel', 'Hotel Gracery', new Date(now.getTime() - day)),
      savedPlaces: [],
      tripPlaces: [
        {
          categories: [],
          createdAt: new Date(now.getTime() - 30 * day),
          customName: 'Our Tokyo hotel',
          trip: { id: 'archived-trip', name: 'Tokyo 2025' },
        },
      ],
    },
    {
      ...providerPlace('museum', 'Mori Art Museum', new Date(now.getTime() - 400 * day)),
      savedPlaces: [{ createdAt: new Date(now.getTime() - day) }],
      tripPlaces: [],
    },
  ]);
  (globalThis as { trovePrismaClient?: unknown }).trovePrismaClient = {
    place: { findMany },
  };
});

test('lists only the traveller’s own places, most recently used first', async () => {
  const places = await listKnownPlaces('user-id', { now });

  const where = findMany.mock.calls[0]![0].where;
  expect(where).toEqual({
    OR: [
      { ownerId: 'user-id' },
      { savedPlaces: { some: { ownerId: 'user-id' } } },
      { tripPlaces: { some: { trip: { ownerId: 'user-id' } } } },
    ],
  });
  // An archived trip is still the traveller's: its places are not filtered out.
  expect(JSON.stringify(where)).not.toContain('archivedAt');
  expect(places.map((entry) => entry.place.id)).toEqual(['museum', 'hotel']);
});

test('names provider places from the snapshot and says which trip they came from', async () => {
  const [museum, hotel] = await listKnownPlaces('user-id', { now });

  expect(hotel).toMatchObject({
    lastTrip: { id: 'archived-trip', name: 'Tokyo 2025' },
    place: { snapshot: { name: 'Hotel Gracery' } },
    tripName: 'Our Tokyo hotel',
  });
  expect(hotel!.place.categories).toContain('stay');
  // An old snapshot is marked stale exactly as everywhere else, and is not refreshed here.
  expect(museum!.place.snapshot).toMatchObject({ stale: true });
  expect(museum!.place.providerLabel).toBe('Mori Art Museum (label)');
  expect(museum!.lastTrip).toBeNull();
});

test('never asks the places provider', async () => {
  await listKnownPlaces('user-id', { now });

  expect(provider.getDetails).not.toHaveBeenCalled();
  expect(provider.search).not.toHaveBeenCalled();
});
