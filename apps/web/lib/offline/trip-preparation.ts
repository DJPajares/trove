import { fetchItinerary, fetchTripOfflineContext } from '@/lib/itinerary/api';
import { getCurrenciesWithCache, getRateBoardWithCache } from '@/lib/currency/api';
import { fetchExpenses } from '@/lib/expenses/api';
import { fetchReservations } from '@/lib/reservations/api';
import { fetchTasks } from '@/lib/tasks/api';
import { fetchTripInfo } from '@/lib/trip-info/api';
import { fetchTrip } from '@/lib/trips/api';
import { storageCacheKey, USER_MEDIA_CACHE } from '@/lib/media/storage-cache-key';
import { runningRelease } from '@/lib/updates/running-release';

import {
  isOfflineApiReachable,
  listOfflineReservationDocuments,
  listTripSnapshots,
  markTripPrepared,
  recordTripPreparationError,
  removeTripOfflineData,
  selectOfflineReservationDocument,
} from './trip-store';
import { offlineTripPageUrls } from './trip-pages';
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

const TRIP_PAGE_CACHE = 'trove-pwa-trip-mode-pages';
const TRIP_PAGES_RELEASE_KEY = 'trove.offline-pages-release';

async function cacheTripPages(tripId: string) {
  if (!('caches' in window)) return;
  const cache = await caches.open(TRIP_PAGE_CACHE);
  await Promise.all(
    offlineTripPageUrls(tripId).map((url) =>
      cache.add(new Request(url, { credentials: 'same-origin' })),
    ),
  );
}

/**
 * Re-warms prepared trips' pages once per release.
 *
 * A cached page is HTML naming the build's hashed chunks, and activating a new
 * worker drops the old build's chunks from the precache. Without this, every
 * prepared page except the one open during the update would fail offline until
 * its trip was prepared again. Own-origin pages only: no provider requests.
 */
export async function refreshPreparedTripPages() {
  const buildId = runningRelease?.buildId;
  if (!buildId || !('caches' in window) || !navigator.onLine) return;
  try {
    if (window.localStorage.getItem(TRIP_PAGES_RELEASE_KEY) === buildId) return;
  } catch {
    return;
  }

  const { accessToken, userId } = await getOfflineAuthContext();
  if (!accessToken) return;
  const prepared = (await listTripSnapshots(userId)).filter((snapshot) => snapshot.preparedAt);
  const results = await Promise.allSettled(
    prepared.map((snapshot) => cacheTripPages(snapshot.tripId)),
  );
  if (results.some((result) => result.status === 'rejected')) return;
  try {
    window.localStorage.setItem(TRIP_PAGES_RELEASE_KEY, buildId);
  } catch {
    // Retried on the next load.
  }
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
    const current = await fetchTrip(tripId);
    if (current.trip.archivedAt) throw new OfflineSyncError('trip_archived');
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
      // Legs and hours Trove already has stored, so offline Trip Mode can still
      // say when to leave and whether a stop is open. Never acquired here, and
      // only enrichment: failing to keep it must not stop a trip being Ready.
      fetchTripOfflineContext(tripId).catch(() => undefined),
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

/**
 * Clears a trip the server has already deleted.
 *
 * Unlike removing a downloaded copy, this discards the trip's queued mutations
 * rather than refusing: there is no longer a trip to send them to.
 */
export async function discardTripOfflineData(tripId: string) {
  const { userId } = await getOfflineAuthContext();
  await removeTripOfflineData(userId, tripId, { discardPendingMutations: true });
}
