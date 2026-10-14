import type { ItineraryMovement } from '@trove/types';
import type { OfflineMutationOperation } from '@/lib/offline/trip-store';

/** Old queued moves are intentions only: reconnect never authorizes timing changes. */
export function queuedMovement(operation: OfflineMutationOperation): ItineraryMovement | null {
  if (operation.kind === 'itinerary_item_organize')
    return {
      kind: 'move',
      itemId: operation.itemId,
      itineraryDayId: operation.input.itineraryDayId,
      position: operation.input.position,
    };
  if (operation.kind === 'itinerary_day_move')
    return {
      kind: 'day',
      sourceDayId: operation.sourceItineraryDayId,
      targetDayId: operation.input.targetItineraryDayId,
      strategy: operation.input.strategy,
    };
  return null;
}
