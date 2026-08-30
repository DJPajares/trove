import { fetchItinerary } from '@/lib/itinerary/api';
import { getCurrenciesWithCache, getRateBoardWithCache } from '@/lib/currency/api';
import { fetchExpenses } from '@/lib/expenses/api';
import { fetchReservations } from '@/lib/reservations/api';
import { fetchTasks } from '@/lib/tasks/api';
import { fetchTripInfo } from '@/lib/trip-info/api';
import { fetchTrip } from '@/lib/trips/api';
import { storageCacheKey, USER_MEDIA_CACHE } from '@/lib/media/storage-cache-key';

import {
  isOfflineApiReachable,
  listOfflineReservationDocuments,
  markTripPrepared,
  recordTripPreparationError,
  removeTripOfflineData,
  selectOfflineReservationDocument,
} from './trip-store';
import { getOfflineAuthContext, OfflineSyncError, syncOfflineMutations } from './trip-sync';

function errorCode(error: unknown) {
  if (error instanceof OfflineSyncError) return error.code;
  if (error instanceof Error) return error.message;
  return 'offline_preparation_failed';
}

async function refreshSelectedDocuments(userId: string, tripId: string) {
  const documents = await listOfflineReservationDocuments(userId, tripId);
  await Promise.all(
    documents.map(async (document) => {
      if (document.blob || !document.sourceUrl) return;
      const response = await fetch(document.sourceUrl);
      if (!response.ok) throw new Error('offline_document_download_failed');
      await selectOfflineReservationDocument({
        ...document,
        blob: await response.blob(),
        savedAt: new Date().toISOString(),
      });
    }),
  );
}

async function cacheTripPages(tripId: string) {
  if (!('caches' in window)) return;
  const cache = await caches.open('trove-pwa-trip-mode-pages');
  const paths = [
    'expenses',
    'info',
    'itinerary',
    'mode',
    'mode/map',
    'mode/trip',
    'mode/today',
    'places',
    'reservations',
    'tasks',
  ];
  await Promise.all(
    paths.map((path) =>
      cache.add(new Request(`/trips/${tripId}/${path}`, { credentials: 'same-origin' })),
    ),
  );
}

/**
 * Warms the trip's own cover into the image cache.
 *
 * Only media the traveller owns in Trove Storage: editorial photography is
 * hotlinked from the provider by contract, and pre-downloading it for a trip
 * that may never be opened offline is closer to keeping a copy than that
 * contract allows. `useEditorialImages` already declines to resolve offline,
 * and the branded fallback is a designed state rather than a failure.
 *
 * `cache.add` would fetch and store under the request's own URL, which for a
 * signed URL is a key nothing will ever ask for again - so the normalizer is
 * applied here by hand, exactly as the service worker applies it as a plugin.
 *
 * A photograph is decoration, so unlike the pages above, failing to warm one
 * must not fail the preparation.
 */
async function cacheTripCover(coverPhotoUrl: string | null) {
  if (!coverPhotoUrl || !('caches' in window)) return;

  try {
    const response = await fetch(coverPhotoUrl);
    if (!response.ok) return;
    const cache = await caches.open(USER_MEDIA_CACHE);
    await cache.put(new Request(storageCacheKey(coverPhotoUrl)), response);
  } catch {
    // The cover falls back to the branded gradient offline.
  }
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
    // The board covers every pair, so warming it makes the converter work for
    // any currency the trip turns out to need, not just the ones seen online.
    void getCurrenciesWithCache().catch(() => undefined);
    void getRateBoardWithCache().catch(() => undefined);
    const [, tripResult] = await Promise.all([
      fetchItinerary(tripId),
      fetchTrip(tripId),
      fetchReservations(tripId),
      fetchTasks(tripId),
      fetchTripInfo(tripId),
      fetchExpenses(tripId),
      refreshSelectedDocuments(userId, tripId),
      cacheTripPages(tripId),
    ]);
    await cacheTripCover(tripResult.trip.coverPhotoUrl);
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
