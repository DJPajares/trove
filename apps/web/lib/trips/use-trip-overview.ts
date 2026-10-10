'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { TripOverviewData } from '@trove/types';
import { getOfflineAuthContext } from '@/lib/offline/trip-sync';
import { canUseSupportingOfflineFallback } from '@/lib/offline/supporting-sync';
import {
  OFFLINE_DATA_REFRESH_EVENT,
  readTripSnapshot,
  setOfflineApiReachable,
} from '@/lib/offline/trip-store';
import { queryKeys } from '@/lib/query/keys';
import { offlineTripOverview } from '@/lib/trips/overview';
import { fetchMemories } from '@/lib/memories/api';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export async function fetchTripOverview(
  tripId: string,
  clockTimeZone: string,
  signal?: AbortSignal,
) {
  const auth = await getOfflineAuthContext();
  async function stored() {
    const snapshot = await readTripSnapshot(auth.userId, tripId);
    if (!snapshot?.trip) throw new Error('trip_not_prepared');
    // Reuse the journal's local blob previews when disconnected. Never fetch the journal online for the hub.
    if (!navigator.onLine && snapshot.memories) snapshot.memories = await fetchMemories(tripId);
    return offlineTripOverview(snapshot, clockTimeZone);
  }
  if (!navigator.onLine || !auth.accessToken) return stored();
  try {
    const query = new URLSearchParams({ clockTimeZone });
    const response = await fetch(`${apiUrl}/trips/${tripId}/overview?${query}`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      signal,
    });
    setOfflineApiReachable(response.status < 500);
    if (!response.ok)
      throw Object.assign(new Error('overview_request_failed'), { status: response.status });
    return ((await response.json()) as { overview: TripOverviewData }).overview;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (canUseSupportingOfflineFallback(error)) return stored();
    throw error;
  }
}

export function useTripOverview(tripId: string, enabled: boolean) {
  const clockTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const query = useQuery({
    enabled,
    queryKey: queryKeys.tripOverview(tripId, clockTimeZone),
    queryFn: ({ signal }) => fetchTripOverview(tripId, clockTimeZone, signal),
    staleTime: 30_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const { refetch } = query;
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      void refetch();
    };
    window.addEventListener(OFFLINE_DATA_REFRESH_EVENT, refresh);
    return () => window.removeEventListener(OFFLINE_DATA_REFRESH_EVENT, refresh);
  }, [enabled, refetch]);
  useEffect(() => {
    if (!enabled || !query.data) return;
    // Bound the timer for very long days and delayed background tabs.
    const timer = window.setTimeout(
      () => void refetch(),
      Math.max(1000, Math.min(86_400_000, Date.parse(query.data.refreshAt) - Date.now() + 100)),
    );
    return () => window.clearTimeout(timer);
  }, [enabled, query.data, refetch]);
  return query;
}
