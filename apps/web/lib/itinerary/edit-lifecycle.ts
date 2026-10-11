import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';

type EditState = { pending: number; listeners: Set<() => void> };
const clients = new WeakMap<QueryClient, Map<string, EditState>>();
function state(client: QueryClient, tripId: string) {
  let trips = clients.get(client);
  if (!trips) clients.set(client, (trips = new Map()));
  let edit = trips.get(tripId);
  if (!edit) trips.set(tripId, (edit = { pending: 0, listeners: new Set() }));
  return edit;
}
export function isItineraryEditing(client: QueryClient, tripId: string) {
  return (clients.get(client)?.get(tripId)?.pending ?? 0) > 0;
}
export function subscribeItineraryEdits(client: QueryClient, tripId: string, listener: () => void) {
  const edit = state(client, tripId);
  edit.listeners.add(listener);
  return () => {
    edit.listeners.delete(listener);
  };
}

/** A read barrier around existing offline-aware writes, held through canonical refresh. */
export async function withItineraryEdit<T>(
  client: QueryClient,
  tripId: string,
  edit: () => Promise<T>,
) {
  const current = state(client, tripId);
  current.pending++;
  current.listeners.forEach((listener) => listener());
  try {
    await Promise.all([
      client.cancelQueries({ queryKey: queryKeys.planScore(tripId) }),
      client.cancelQueries({ queryKey: ['itinerary-timing', tripId] }),
    ]);
    return await edit();
  } finally {
    current.pending--;
    current.listeners.forEach((listener) => listener());
  }
}
