import type { QueryClient } from '@tanstack/react-query';

import {
  applyOfflineMutation,
  type OfflineItineraryMutationOperation,
} from '@/lib/offline/trip-store';
import { queryKeys } from '@/lib/query/keys';

import type { Itinerary } from './api';

/**
 * Shows an itinerary edit the moment it is made, then lets the server confirm.
 *
 * The edit is applied to the shared itinerary entry with the same function the
 * offline queue uses to replay it, so what the traveller sees before the answer
 * is what the server - or a later sync - will produce. A read already in flight
 * is cancelled first, because its answer predates the edit and would otherwise
 * land on top of it. If the request fails the entry goes back to exactly what
 * it was; offline, `commit` queues the edit and resolves, and the change stays.
 */
export async function optimisticItineraryEdit<T>(input: {
  commit: () => Promise<T>;
  operation: OfflineItineraryMutationOperation;
  queryClient: QueryClient;
  tripId: string;
}): Promise<T> {
  const key = queryKeys.itinerary(input.tripId);
  await input.queryClient.cancelQueries({ queryKey: key });
  const previous = input.queryClient.getQueryData<Itinerary>(key);
  if (previous) {
    input.queryClient.setQueryData(key, applyOfflineMutation(previous, input.operation));
  }
  try {
    return await input.commit();
  } catch (error) {
    if (previous) input.queryClient.setQueryData(key, previous);
    throw error;
  }
}

/**
 * Where a dropped stop goes, as the position the server's move takes: its index
 * among the day's other stops once it has moved. Null when it lands where it
 * started, so a drop that changes nothing sends nothing.
 */
export function dropPosition(input: {
  activeId: string;
  ids: readonly string[];
  overId: string | null;
}): number | null {
  if (!input.overId || input.overId === input.activeId) return null;
  const from = input.ids.indexOf(input.activeId);
  const to = input.ids.indexOf(input.overId);
  if (from < 0 || to < 0 || from === to) return null;
  return to;
}
