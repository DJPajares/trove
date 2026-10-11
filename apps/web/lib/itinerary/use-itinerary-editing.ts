'use client';
import { useCallback, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isItineraryEditing, subscribeItineraryEdits } from './edit-lifecycle';
const serverSnapshot = () => false;
export function useItineraryEditing(tripId: string) {
  const client = useQueryClient();
  const subscribe = useCallback(
    (listener: () => void) => subscribeItineraryEdits(client, tripId, listener),
    [client, tripId],
  );
  const snapshot = useCallback(() => isItineraryEditing(client, tripId), [client, tripId]);
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
