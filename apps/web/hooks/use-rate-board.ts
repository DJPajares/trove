'use client';

import { useQuery } from '@tanstack/react-query';

import { getRateBoardWithCache, type CachedCurrencyRateBoard } from '@/lib/currency/api';
import { queryKeys } from '@/lib/query/keys';

export type RateBoardState = {
  board: CachedCurrencyRateBoard | null;
  /** `unavailable` means no board and no cache - the cue to degrade, not to retry. */
  status: 'loading' | 'ready' | 'unavailable';
};

/**
 * The day's exchange rates, fetched once for whoever asks.
 *
 * `getRateBoardWithCache` already prefers its own twelve-hour cache and already
 * answers from it when the device is offline, so this adds only what it cannot:
 * a single entry every screen shares, rather than one request per currency per
 * component. Pass `enabled: false` when a trip needs no conversion at all - a
 * traveller spending only in their home currency should cost nothing to serve.
 */
export function useRateBoard(enabled = true): RateBoardState {
  const { data, isPending } = useQuery({
    enabled,
    queryFn: getRateBoardWithCache,
    queryKey: queryKeys.currencyRateBoard(),
  });

  if (data) return { board: data, status: 'ready' };
  return { board: null, status: enabled && isPending ? 'loading' : 'unavailable' };
}
