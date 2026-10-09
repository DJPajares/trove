import { WEATHER_CACHE_TTL_MS } from '@trove/types';

/** TanStack receipt time controls scheduling without renewing provider age. */
export function weatherQueryStaleTime(query: {
  state: { data: { fetchedAt?: string; refreshAfter?: number } | undefined; dataUpdatedAt: number };
}) {
  if (!query.state.data) return WEATHER_CACHE_TTL_MS;
  if (query.state.data.refreshAfter !== undefined)
    return Math.max(0, query.state.data.refreshAfter - query.state.dataUpdatedAt);
  const fetchedAt = Date.parse(query.state.data.fetchedAt ?? '');
  if (!Number.isFinite(fetchedAt) || fetchedAt > query.state.dataUpdatedAt) return 0;
  return Math.max(0, fetchedAt + WEATHER_CACHE_TTL_MS - query.state.dataUpdatedAt);
}
