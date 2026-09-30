'use client';

import { useQuery } from '@tanstack/react-query';

import { useOnlineStatus } from '@/components/trip-sync-status';
import { fetchTripPlaceHours, type TripPlaceSignals } from '@/lib/itinerary/api';
import { queryKeys } from '@/lib/query/keys';

const NO_SIGNALS: Record<string, TripPlaceSignals> = {};

/**
 * Stored hours (for `date`) and ratings for a trip's places. Read from what the
 * server already holds, so it costs no provider request; a place with nothing
 * stored simply has no entry. Offline it says nothing rather than guessing.
 */
export function useTripPlaceHours(tripId: string, date: string | null, enabled = true) {
  const online = useOnlineStatus();
  const query = useQuery({
    enabled: enabled && online,
    queryFn: ({ signal }) => fetchTripPlaceHours(tripId, { date, signal }),
    queryKey: queryKeys.placeHours(tripId, date),
    retry: false,
  });

  return query.data?.places ?? NO_SIGNALS;
}
