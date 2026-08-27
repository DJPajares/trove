'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

export type TripResourceStatus = 'error' | 'idle' | 'loading';

/**
 * One trip-scoped collection, read through the shared cache.
 *
 * Tasks, reservations, expenses and trip info are all the same shape: fetch the
 * trip's collection, show a loading state, show an error state, and refetch
 * after every edit. They each hand-rolled that, which meant four screens each
 * refetching on mount and none of them sharing an answer with Trip Mode, which
 * reads the same collections.
 *
 * `refresh` keeps the signature the call sites already use, so an edit still
 * ends in `await refresh()` - it just invalidates the shared entry now instead
 * of refetching into one component's local state.
 */
export function useTripResource<T>(queryKey: readonly unknown[], queryFn: () => Promise<T>) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryFn, queryKey });

  const refresh = useCallback(
    async () => {
      await queryClient.invalidateQueries({ queryKey });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, ...queryKey],
  );

  /** Writes a server-confirmed value back without a second round trip. */
  const setData = useCallback(
    (update: (current: T | undefined) => T | undefined) => {
      queryClient.setQueryData(queryKey, update);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, ...queryKey],
  );

  const status: TripResourceStatus = query.isPending ? 'loading' : query.error ? 'error' : 'idle';

  return { data: query.data ?? null, refresh, setData, status };
}
