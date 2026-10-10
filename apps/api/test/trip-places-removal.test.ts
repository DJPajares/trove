import { beforeEach, expect, test, vi } from 'vitest';

import { removeTripPlace, TripPlaceReferencedError } from '../src/services/trip-places.js';

let referenceCount = 0;
let owned = true;
const deleteRelationship = vi.fn();
const deleteSaved = vi.fn();
const deleteCanonical = vi.fn();
const detach = vi.fn();

beforeEach(() => {
  referenceCount = 0;
  owned = true;
  vi.clearAllMocks();
  const transaction = {
    expense: { updateMany: detach },
    memory: { updateMany: detach },
    reservation: { updateMany: detach },
    itineraryDay: { findMany: async () => [], updateMany: detach },
    tripPlace: { delete: deleteRelationship },
    savedPlace: { delete: deleteSaved },
    place: { delete: deleteCanonical },
  };
  (globalThis as { trovePrismaClient?: unknown }).trovePrismaClient = {
    ...transaction,
    $transaction: async (run: (client: typeof transaction) => Promise<void>) => run(transaction),
    trip: { findFirst: async () => (owned ? { id: 'trip', name: 'Kyoto' } : null) },
    tripPlace: {
      findFirst: async () => ({ _count: { itineraryItems: referenceCount } }),
    },
  };
});

test('removing an unscheduled relationship leaves Saved Places and the shared Place intact', async () => {
  await removeTripPlace('owner', 'trip', 'trip-place');
  expect(deleteRelationship).toHaveBeenCalledExactlyOnceWith({ where: { id: 'trip-place' } });
  expect(deleteSaved).not.toHaveBeenCalled();
  expect(deleteCanonical).not.toHaveBeenCalled();
  expect(detach).toHaveBeenCalledWith({
    data: { tripPlaceId: null },
    where: { tripId: 'trip', tripPlaceId: 'trip-place' },
  });
});

test('a referenced place is refused before any relationship changes', async () => {
  referenceCount = 2;
  await expect(removeTripPlace('owner', 'trip', 'trip-place')).rejects.toEqual(
    new TripPlaceReferencedError(2),
  );
  expect(deleteRelationship).not.toHaveBeenCalled();
  expect(detach).not.toHaveBeenCalled();
});

test('removal retains the trip ownership guard', async () => {
  owned = false;
  await expect(removeTripPlace('other-owner', 'trip', 'trip-place')).rejects.toThrow(
    'trip_not_found',
  );
  expect(deleteRelationship).not.toHaveBeenCalled();
});
