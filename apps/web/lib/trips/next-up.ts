import type { ItineraryItem, TripModeContext } from '@/lib/itinerary/api';
import { resolveTripPlaceName } from '@/lib/trip-places/place-name';

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

/**
 * What a stop is called: the traveller's own label first, then its place, named
 * the way the itinerary names it. A Google place carries its name in the stored
 * snapshot rather than `place.name`, which is only a custom place's own name -
 * reading that alone left every untitled Google stop nameless.
 */
export function itemLabel(item: ItineraryItem) {
  const label = item.customLabel?.trim() || item.customLocation?.label?.trim();
  if (label) return label;
  if (!item.tripPlace) return null;
  return resolveTripPlaceName(item.tripPlace, { custom: '', provider: '' }).trim() || null;
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
