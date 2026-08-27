import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';

import {
  deleteQueryCacheEntry,
  readQueryCacheEntry,
  writeQueryCacheEntry,
} from '@/lib/offline/trip-store';
import { QUERY_CACHE_VERSION } from '@/lib/query/client';

/**
 * One record per traveller.
 *
 * Keying by user id means a second account signing in on the same device reads
 * its own empty cache rather than the previous account's answers, even in the
 * window before the sign-out wipe has finished.
 */
function cacheKey(userId: string) {
  return `trove.query-cache.${QUERY_CACHE_VERSION}:${userId}`;
}

/**
 * The persister writes through IndexedDB rather than localStorage: a dehydrated
 * cache is far past what a 5 MB synchronous store should hold, and writing it
 * on the main thread would stall paint on every mutation.
 */
export function createQueryPersister(
  userId: string,
): ReturnType<typeof createAsyncStoragePersister> {
  const key = cacheKey(userId);

  return createAsyncStoragePersister({
    key,
    storage: {
      getItem: (itemKey: string) => readQueryCacheEntry(itemKey),
      removeItem: (itemKey: string) => deleteQueryCacheEntry(itemKey),
      setItem: (itemKey: string, value: string) => writeQueryCacheEntry(itemKey, value),
    },
    // Storage is unavailable in private-mode browsers and inside some
    // in-app webviews. Persistence is an optimisation, so a failure to write
    // is swallowed and the tab simply runs on its in-memory cache.
    throttleTime: 1_000,
  });
}

export async function removePersistedQueryCache(userId: string) {
  try {
    await deleteQueryCacheEntry(cacheKey(userId));
  } catch {
    // The in-memory cache is cleared by the caller regardless, and the whole
    // store is dropped by `clearAllOfflineTripData` on sign-out.
  }
}
