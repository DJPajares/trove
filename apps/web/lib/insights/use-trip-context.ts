'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale } from 'next-intl';

import { fetchTripContext } from '@/lib/insights/api';
import { queryKeys } from '@/lib/query/keys';

/** Holidays do not move and typical conditions change once a year. */
const TRIP_CONTEXT_REFETCH_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * A trip's holidays and typical conditions, shared by every Insights surface.
 * `null` waits: the itinerary asks only once its panel scrolls into view.
 */
export function useTripContext(tripId: string | null) {
  const languageCode = useLocale();
  const query = useQuery({
    enabled: Boolean(tripId),
    queryFn: ({ signal }) => fetchTripContext(tripId!, { languageCode, signal }),
    queryKey: queryKeys.tripContext(tripId ?? '', languageCode),
    // The one provider behind this is free and cached server-side, like the
    // weather, so it may refresh itself instead of waiting for an edit.
    refetchOnMount: true,
    refetchOnReconnect: true,
    staleTime: TRIP_CONTEXT_REFETCH_AFTER_MS,
  });
  return query.data ?? null;
}
