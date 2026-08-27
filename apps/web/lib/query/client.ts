import { QueryClient, type Query } from '@tanstack/react-query';

import { PERSISTED_QUERY_ROOTS, PROVIDER_BILLABLE_QUERY_ROOTS } from '@/lib/query/keys';

const MINUTE = 60 * 1_000;

/**
 * Bumped whenever a key's shape or a cached payload's shape changes. A restore
 * carrying a different version is discarded rather than reinterpreted, so a
 * released key change can never be read back as the key it replaced.
 */
export const QUERY_CACHE_VERSION = 'v1';

/** How long a restored cache stays usable. Must not exceed `gcTime`. */
export const QUERY_CACHE_MAX_AGE_MS = 24 * 60 * MINUTE;

/**
 * How long each root's answer is treated as fresh.
 *
 * `Infinity` is not "cache forever" - it means "only an explicit invalidation
 * or a change in the key itself may refetch this". Every provider-billable root
 * gets it, because the alternative is a timer quietly turning a screen visit
 * into a Google bill.
 */
const STALE_TIME_BY_ROOT: Record<string, number> = {
  currency: 12 * 60 * MINUTE,
  'editorial-images': Number.POSITIVE_INFINITY,
  expenses: MINUTE,
  itinerary: 15 * 1_000,
  'itinerary-day-routes': Number.POSITIVE_INFINITY,
  memories: MINUTE,
  notifications: MINUTE,
  'plan-score': Number.POSITIVE_INFINITY,
  profile: 5 * MINUTE,
  reservations: MINUTE,
  saved: MINUTE,
  'task-templates': 5 * MINUTE,
  tasks: MINUTE,
  trip: MINUTE,
  'trip-info': MINUTE,
  'trip-mode-context': Number.POSITIVE_INFINITY,
  'trip-places': MINUTE,
  trips: 30 * 1_000,
};

function queryRoot(query: Pick<Query, 'queryKey'>) {
  const [root] = query.queryKey;
  return typeof root === 'string' ? root : '';
}

/**
 * Decides what is allowed to reach disk.
 *
 * The offline trip snapshot in `lib/offline/trip-store.ts` is already a
 * persisted read cache for trips, itineraries, reservations, tasks, trip info,
 * expenses and memories - and it holds a *different* answer than the network
 * does, because it folds the pending offline mutation queue into what it
 * returns and deliberately drops `coverPhotoUrl`. Persisting those roots here
 * would put a second, subtly disagreeing copy on the same device. So only roots
 * the snapshot does not cover are written; the rest live in memory for the tab
 * and fall back to the snapshot exactly as they do today.
 */
export function shouldDehydrateQuery(query: Query) {
  if (query.state.status !== 'success') return false;
  return PERSISTED_QUERY_ROOTS.has(queryRoot(query));
}

/**
 * The HTTP status behind a domain API error, if it carries one.
 *
 * Every `*ApiError` in the domain api modules is its own class, but they all
 * expose a numeric `status`, so this reads the shape rather than naming each.
 */
export function apiErrorStatus(error: unknown) {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
}

export function createQueryClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: QUERY_CACHE_MAX_AGE_MS,
        // TanStack refetches on mount, reconnect and window focus by default.
        // Trove opts every one of those back off: several read endpoints reach
        // Google Places and Routes, so an automatic refetch is not a free
        // freshness win but a per-focus charge. Freshness comes from explicit
        // invalidation after a mutation instead.
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        // A 404 is an answer, not a failure, and a 401 will not fix itself on
        // a second try either. Only retry what a retry could actually change.
        retry: (failureCount, error) => {
          const status = apiErrorStatus(error);
          if (status !== null && status >= 400 && status < 500) return false;
          return failureCount < 1;
        },
        staleTime: MINUTE,
      },
    },
  });

  for (const [root, staleTime] of Object.entries(STALE_TIME_BY_ROOT)) {
    client.setQueryDefaults([root], { staleTime });
  }

  return client;
}

/**
 * The invariant the cost guard rests on, exported so a test can assert it
 * rather than trusting the table above to stay correct by inspection.
 */
export function billableRootsWithoutInfiniteStaleTime() {
  return [...PROVIDER_BILLABLE_QUERY_ROOTS].filter(
    (root) => STALE_TIME_BY_ROOT[root] !== Number.POSITIVE_INFINITY,
  );
}
