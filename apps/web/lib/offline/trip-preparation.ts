import { fetchItinerary } from '@/lib/itinerary/api';
import { fetchTrip } from '@/lib/trips/api';

import {
  isOfflineApiReachable,
  markTripPrepared,
  recordTripPreparationError,
  removeTripOfflineData,
} from './trip-store';
import { getOfflineAuthContext, OfflineSyncError, syncOfflineMutations } from './trip-sync';

function errorCode(error: unknown) {
  if (error instanceof OfflineSyncError) return error.code;
  if (error instanceof Error) return error.message;
  return 'offline_preparation_failed';
}

export async function prepareTripForOffline(tripId: string) {
  const { accessToken, userId } = await getOfflineAuthContext();
  if (!accessToken || !navigator.onLine) {
    const error = new OfflineSyncError('offline_preparation_requires_connection');
    await recordTripPreparationError(userId, tripId, error.code).catch(() => undefined);
    throw error;
  }

  try {
    await syncOfflineMutations();
    await Promise.all([fetchItinerary(tripId), fetchTrip(tripId)]);
    if (!isOfflineApiReachable()) throw new OfflineSyncError('offline_preparation_unavailable');
    await markTripPrepared(userId, tripId);
  } catch (error) {
    await recordTripPreparationError(userId, tripId, errorCode(error)).catch(() => undefined);
    throw error;
  }
}

export async function removePreparedTrip(tripId: string) {
  const { userId } = await getOfflineAuthContext();
  await removeTripOfflineData(userId, tripId);
}
