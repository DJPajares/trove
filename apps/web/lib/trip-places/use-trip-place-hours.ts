'use client';

import { useQuery } from '@tanstack/react-query';

import { fetchTripPlaceHours, type TripPlaceSignals } from '@/lib/itinerary/api';
import { queryKeys } from '@/lib/query/keys';

const NO_SIGNALS: Record<string, TripPlaceSignals> = {};

/**
 * Stored hours (for `date`) and ratings for a trip's places. Read from what the
 * server already holds, so it costs no provider request; a place with nothing
 * stored simply has no entry. Offline it answers from the prepared trip, when
 * there is one, and says nothing otherwise rather than guessing.
 */
export function useTripPlaceHours(tripId: string, date: string | null, enabled = true) {
  const query = useQuery({
    enabled,
    queryFn: ({ signal }) => fetchTripPlaceHours(tripId, { date, signal }),
    queryKey: queryKeys.placeHours(tripId, date),
    retry: false,
  });

  return query.data?.places ?? NO_SIGNALS;
}
