import type { ItineraryItem, TripModeContext } from '@/lib/itinerary/api';

/**
 * What a trip under way says about its day right now, or null when it says
 * nothing worth a line.
 *
 * Null covers both "still asking" and "no day at all", because neither is a
 * fact about the traveller's schedule. An item that simply has no label is not
 * a clear schedule either - only the server's own `no_next_item` is.
 */
export type TripNextUp =
  { kind: 'current' | 'next'; label: string } | { kind: 'nothingScheduled'; label: null };

function itemLabel(item: ItineraryItem) {
  return item.customLabel ?? item.customLocation?.label ?? item.tripPlace?.place.name ?? null;
}

/**
 * Reads the next stop out of a Trip Mode context the surface already holds.
 * Home and the Trips library both ask it of the one context they fetch for
 * their lead trip, so the two lines can never disagree.
 */
export function resolveTripNextUp(context: TripModeContext | null): TripNextUp | null {
  if (!context) return null;

  const itemId = context.nextItemId ?? context.currentOrRelevant?.itemId;
  const item = context.day?.items.find((entry) => entry.id === itemId);
  const label = item ? itemLabel(item) : null;

  if (label) return { kind: context.nextItemId ? 'next' : 'current', label };
  if (context.state === 'no_next_item') return { kind: 'nothingScheduled', label: null };

  return null;
}
