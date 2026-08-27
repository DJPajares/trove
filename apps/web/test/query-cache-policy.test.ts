import { expect, test } from 'vitest';

import {
  billableRootsWithoutInfiniteStaleTime,
  createQueryClient,
  QUERY_CACHE_MAX_AGE_MS,
  shouldDehydrateQuery,
} from '../lib/query/client.ts';
import {
  PERSISTED_QUERY_ROOTS,
  PROVIDER_BILLABLE_QUERY_ROOTS,
  queryKeys,
  TRIP_SCOPED_QUERY_ROOTS,
} from '../lib/query/keys.ts';

/**
 * The cost guard. TanStack refetches on mount, reconnect and window focus by
 * default, and several of Trove's read endpoints reach Google Places and
 * Routes - so those defaults would turn tab focus into spend.
 */
test('never refetches automatically on mount, reconnect or window focus', () => {
  const defaults = createQueryClient().getDefaultOptions().queries;

  expect(defaults?.refetchOnMount).toBe(false);
  expect(defaults?.refetchOnReconnect).toBe(false);
  expect(defaults?.refetchOnWindowFocus).toBe(false);
});

test('every provider-billable root refetches only on invalidation or a key change', () => {
  expect(billableRootsWithoutInfiniteStaleTime()).toEqual([]);

  const client = createQueryClient();
  for (const root of PROVIDER_BILLABLE_QUERY_ROOTS) {
    expect(client.getQueryDefaults([root]).staleTime).toBe(Number.POSITIVE_INFINITY);
  }
});

test('no provider-billable root carries a refetch interval', () => {
  const client = createQueryClient();
  for (const root of PROVIDER_BILLABLE_QUERY_ROOTS) {
    expect(client.getQueryDefaults([root]).refetchInterval).toBeUndefined();
  }
});

/**
 * The offline trip snapshot already persists these roots, and it holds a
 * different answer than the network does - it folds the pending mutation queue
 * into what it returns. Persisting them here too would put two disagreeing
 * copies on one device.
 */
test('does not persist roots the offline trip snapshot already owns', () => {
  const snapshotOwned = [
    'expenses',
    'itinerary',
    'memories',
    'reservations',
    'tasks',
    'trip',
    'trip-info',
    'trips',
  ];

  for (const root of snapshotOwned) {
    expect(PERSISTED_QUERY_ROOTS.has(root)).toBe(false);
  }
});

test('persists only successful queries from permitted roots', () => {
  const dehydrate = (queryKey: readonly unknown[], status: string) =>
    shouldDehydrateQuery({ queryKey, state: { status } } as never);

  expect(dehydrate(queryKeys.savedPlaces(), 'success')).toBe(true);
  expect(dehydrate(queryKeys.savedPlaces(), 'error')).toBe(false);
  expect(dehydrate(queryKeys.savedPlaces(), 'pending')).toBe(false);
  expect(dehydrate(queryKeys.itinerary('trip-1'), 'success')).toBe(false);
  expect(dehydrate(queryKeys.trip('trip-1'), 'success')).toBe(false);
});

test('a restored cache never outlives the garbage-collection window', () => {
  const gcTime = createQueryClient().getDefaultOptions().queries?.gcTime;

  expect(typeof gcTime).toBe('number');
  expect(QUERY_CACHE_MAX_AGE_MS).toBeLessThanOrEqual(gcTime as number);
});

/**
 * `invalidateTripQueries` prefix-matches on `[root, tripId]`, which only clears
 * one trip if every trip-scoped key puts `tripId` immediately after its root.
 */
test('trip-scoped keys put the trip id directly after the root', () => {
  const keys = [
    queryKeys.expenses('trip-1'),
    queryKeys.itinerary('trip-1'),
    queryKeys.itineraryDayRoutes('trip-1', 'day-1', 'rev', false, undefined),
    queryKeys.memories('trip-1'),
    queryKeys.planScore('trip-1', 'rev'),
    queryKeys.reservations('trip-1'),
    queryKeys.tasks('trip-1'),
    queryKeys.trip('trip-1'),
    queryKeys.tripInfo('trip-1'),
    queryKeys.tripModeContext('trip-1', {}),
    queryKeys.tripPlaces('trip-1'),
  ];

  for (const key of keys) {
    expect(TRIP_SCOPED_QUERY_ROOTS).toContain(key[0]);
    expect(key[1]).toBe('trip-1');
  }

  expect(new Set(keys.map((key) => key[0])).size).toBe(TRIP_SCOPED_QUERY_ROOTS.length);
});

/** Two screens asking for the same photographs must share one resolve. */
test('editorial image keys are order-independent', () => {
  expect(queryKeys.editorialImages(['b', 'a'])).toEqual(queryKeys.editorialImages(['a', 'b']));
  expect(queryKeys.editorialImages(['a'])).not.toEqual(queryKeys.editorialImages(['a', 'b']));
});

/** Preview steps back to a day already seen must not re-bill the endpoint. */
test('trip mode context keys separate preview days', () => {
  const monday = queryKeys.tripModeContext('trip-1', { date: '2026-09-01' });
  const tuesday = queryKeys.tripModeContext('trip-1', { date: '2026-09-02' });

  expect(monday).not.toEqual(tuesday);
  expect(queryKeys.tripModeContext('trip-1', { date: '2026-09-01' })).toEqual(monday);
});
