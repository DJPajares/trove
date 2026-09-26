import type { Itinerary } from './api';

/** Keeps a retry tied to the original copy until the refreshed itinerary confirms it. */
export class DuplicateAttemptTracker {
  private readonly pending = new Map<string, string>();
  private readonly inFlight = new Set<string>();

  constructor(private readonly newId: () => string = () => crypto.randomUUID()) {}

  begin(sourceItemId: string) {
    if (this.inFlight.has(sourceItemId)) return null;
    const clientItemId = this.pending.get(sourceItemId) ?? this.newId();
    this.pending.set(sourceItemId, clientItemId);
    this.inFlight.add(sourceItemId);
    return clientItemId;
  }

  failed(sourceItemId: string) {
    this.inFlight.delete(sourceItemId);
  }

  complete(sourceItemId: string) {
    this.inFlight.delete(sourceItemId);
    this.pending.delete(sourceItemId);
  }
}

export function refreshedItineraryContainsCopy(
  itinerary: Itinerary | undefined,
  clientItemId: string,
) {
  return Boolean(
    itinerary?.unscheduledItems.some((item) => item.id === clientItemId) ||
    itinerary?.days.some((day) => day.items.some((item) => item.id === clientItemId)),
  );
}
