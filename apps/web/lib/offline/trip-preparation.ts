import { fetchItinerary } from '@/lib/itinerary/api';
import { getCurrenciesWithCache } from '@/lib/currency/api';
import { fetchExpenses } from '@/lib/expenses/api';
import { fetchReservations } from '@/lib/reservations/api';
import { fetchTasks } from '@/lib/tasks/api';
import { fetchTripInfo } from '@/lib/trip-info/api';
import { fetchTrip } from '@/lib/trips/api';

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

export async function prepareTripForOffline(tripId: string) {
  const { accessToken, userId } = await getOfflineAuthContext();
  if (!accessToken || !navigator.onLine) {
    const error = new OfflineSyncError('offline_preparation_requires_connection');
    await recordTripPreparationError(userId, tripId, error.code).catch(() => undefined);
    throw error;
  }

  try {
    await syncOfflineMutations();
    void getCurrenciesWithCache().catch(() => undefined);
    await Promise.all([
      fetchItinerary(tripId),
      fetchTrip(tripId),
      fetchReservations(tripId),
      fetchTasks(tripId),
      fetchTripInfo(tripId),
      fetchExpenses(tripId),
      refreshSelectedDocuments(userId, tripId),
      cacheTripPages(tripId),
    ]);
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
