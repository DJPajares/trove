import { WEATHER_CACHE_POLICY } from '@trove/types';
import {
  readQueryCacheEntry,
  writeQueryCacheEntry,
  deleteQueryCacheEntry,
  claimWeatherLease,
  releaseWeatherLease,
} from '@/lib/offline/trip-store';

export interface WeatherStorage {
  read<T>(key: string): Promise<T | null>;
  write(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}
export function weatherStorageKey(userId: string, key: string) {
  return `trove.weather.v1:${userId}:${key}`;
}
export function createWeatherStorage(
  userId: string,
  signal?: AbortSignal,
  canWrite: () => boolean = () => true,
): WeatherStorage {
  return {
    async read<T>(key: string) {
      try {
        const value = await readQueryCacheEntry(weatherStorageKey(userId, key));
        const record = value ? JSON.parse(value) : null;
        return record?.version === 1 ? (record.value as T) : null;
      } catch {
        return null;
      }
    },
    async write(key, value) {
      try {
        await writeQueryCacheEntry(
          weatherStorageKey(userId, key),
          JSON.stringify({ version: 1, value }),
          () => !signal?.aborted && canWrite(),
        );
      } catch {
        /* Memory remains available when private persistence is unavailable. */
      }
    },
    async remove(key) {
      try {
        await deleteQueryCacheEntry(weatherStorageKey(userId, key));
      } catch {
        /* Best effort. */
      }
    },
  };
}

/** Recheck disk inside each lock. Sorted acquisition avoids overlapping-batch deadlocks. */
export async function withWeatherLocks<T>(
  userId: string,
  keys: readonly string[],
  signal: AbortSignal,
  work: () => Promise<T>,
): Promise<T> {
  const sorted = [...new Set(keys)].sort();
  async function acquire(index: number): Promise<T> {
    signal.throwIfAborted();
    if (index === sorted.length) return work();
    const key = weatherStorageKey(userId, `lease:${sorted[index]}`);
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return navigator.locks.request(key, { signal }, () => acquire(index + 1));
    }
    const owner = crypto.randomUUID();
    try {
      while (!(await claimWeatherLease(key, owner, Date.now() + WEATHER_CACHE_POLICY.leaseMs))) {
        signal.throwIfAborted();
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
      }
    } catch (error) {
      signal.throwIfAborted();
      // Disabled IndexedDB cannot supply a lease; the process/server still coalesce.
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      return acquire(index + 1);
    }
    // Keep earlier locks alive while waiting for another point in an overlapping batch.
    // A closed tab stops renewing, allowing the next reader to recover after expiry.
    const renewal = setInterval(() => {
      if (!signal.aborted)
        void claimWeatherLease(key, owner, Date.now() + WEATHER_CACHE_POLICY.leaseMs).catch(
          () => undefined,
        );
    }, WEATHER_CACHE_POLICY.leaseMs / 3);
    try {
      return await acquire(index + 1);
    } finally {
      clearInterval(renewal);
      await releaseWeatherLease(key, owner).catch(() => undefined);
    }
  }
  return acquire(0);
}
