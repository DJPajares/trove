import { beforeEach, expect, test, vi } from 'vitest';

import { createQueryClient } from '@/lib/query/client';
import { queryKeys } from '@/lib/query/keys';
import { deleteTripAndClearCaches, tripEditMovesPlan } from '@/lib/trips/actions';
import type { Trip } from '@/lib/trips/api';

const { deleteTrip, discardTripOfflineData } = vi.hoisted(() => ({
  deleteTrip: vi.fn(),
  discardTripOfflineData: vi.fn(),
}));
vi.mock('@/lib/trips/api', () => ({ deleteTrip }));
vi.mock('@/lib/offline/trip-preparation', () => ({ discardTripOfflineData }));

const trip = {
  id: 'trip-1',
  name: 'Trip',
  startDate: '2026-10-15',
  endDate: '2026-10-18',
  referenceTimeZone: 'Asia/Singapore',
  planningReadiness: 'in_progress',
  destinations: [{ name: 'Singapore' }],
  countries: ['SG'],
} as Trip;

beforeEach(() => {
  vi.resetAllMocks();
  deleteTrip.mockResolvedValue(undefined);
  discardTripOfflineData.mockResolvedValue(undefined);
});

test('identity edits do not refresh provider-billable planning queries', () => {
  expect(
    tripEditMovesPlan(trip, {
      ...trip,
      name: 'Renamed',
      countries: ['MY'],
      coverPhotoUrl: 'cover',
    }),
  ).toBe(false);
});

test.each<Partial<Trip>>([
  { startDate: '2026-10-16' },
  { endDate: '2026-10-19' },
  { referenceTimeZone: 'Asia/Tokyo' },
  { planningReadiness: 'ready' },
  { destinations: [{ ...trip.destinations[0]!, name: 'Tokyo' }] },
])('planning edits refresh derived planning data: %j', (edit) => {
  expect(tripEditMovesPlan(trip, { ...trip, ...edit })).toBe(true);
});

function cachedTrips() {
  const client = createQueryClient();
  client.setQueryData(queryKeys.trips(), { trips: [trip, { ...trip, id: 'other' }] });
  client.setQueryData(queryKeys.trip(trip.id), { trip });
  client.setQueryData(['itinerary', trip.id], { days: [] });
  client.setQueryData(['trip-overview', trip.id, 'UTC'], { days: [] });
  client.setQueryData(['itinerary', 'other'], { days: ['keep'] });
  return client;
}

test('successful deletion removes only the deleted trip and its local copies', async () => {
  const client = cachedTrips();
  await deleteTripAndClearCaches(client, trip.id);
  expect(deleteTrip).toHaveBeenCalledWith(trip.id);
  expect(client.getQueryData(queryKeys.trips())).toEqual({ trips: [{ ...trip, id: 'other' }] });
  expect(client.getQueryData(queryKeys.trip(trip.id))).toBeUndefined();
  expect(client.getQueryData(['itinerary', trip.id])).toBeUndefined();
  expect(client.getQueryData(['trip-overview', trip.id, 'UTC'])).toBeUndefined();
  expect(client.getQueryData(['itinerary', 'other'])).toEqual({ days: ['keep'] });
  expect(discardTripOfflineData).toHaveBeenCalledWith(trip.id);
});

test('failed server deletion preserves cached and offline data', async () => {
  const client = cachedTrips();
  deleteTrip.mockRejectedValue(new Error('failed'));
  await expect(deleteTripAndClearCaches(client, trip.id)).rejects.toThrow('failed');
  expect(client.getQueryData(queryKeys.trip(trip.id))).toEqual({ trip });
  expect(client.getQueryData(['itinerary', trip.id])).toEqual({ days: [] });
  expect(client.getQueryData(queryKeys.trips())).toMatchObject({
    trips: [{ id: trip.id }, { id: 'other' }],
  });
  expect(discardTripOfflineData).not.toHaveBeenCalled();
});

test('offline storage failure cannot turn a confirmed server deletion into a failure', async () => {
  const client = cachedTrips();
  discardTripOfflineData.mockRejectedValue(new Error('storage unavailable'));
  await expect(deleteTripAndClearCaches(client, trip.id)).resolves.toBeUndefined();
  expect(client.getQueryData(queryKeys.trip(trip.id))).toBeUndefined();
});
