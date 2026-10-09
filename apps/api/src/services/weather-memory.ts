import { weatherCoordinate } from '@trove/types';
import { getPrismaClient } from '@trove/db';

/** Bounded process cache, partitioned by database client (also isolates tests). */
const caches = new WeakMap<object, Map<string, unknown>>();
export function weatherMemory() {
  const owner = getPrismaClient();
  let cache = caches.get(owner);
  if (!cache) caches.set(owner, (cache = new Map()));
  return {
    get<T>(key: string) {
      return cache!.get(key) as T | undefined;
    },
    set(key: string, value: unknown) {
      cache!.delete(key);
      cache!.set(key, value);
      if (cache!.size > 256) cache!.delete(cache!.keys().next().value!);
    },
    clear() {
      cache!.clear();
    },
  };
}

export function weatherFailureKey(point: {
  latitude: number;
  longitude: number;
  timeZone?: string;
}) {
  return `weather-failure:${weatherCoordinate(point.latitude)},${weatherCoordinate(point.longitude)}:${point.timeZone ?? 'auto'}`;
}
