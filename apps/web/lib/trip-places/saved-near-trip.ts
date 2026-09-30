import { haversineMeters, type Coordinate } from '@/lib/maps/haversine';
import type { SavedPlace } from '@/lib/saved/api';

/** A destination is a city or region, so "in it" means within this reach of its centre. */
export const DESTINATION_REACH_KM = 50;

export type SavedNearTrip = {
  destinationName: string;
  places: SavedPlace[];
};

/**
 * Saved Places in a trip's destination that are not yet among its Trip Places.
 *
 * Saved Places and Trip Places are independent relationships to the same Place
 * (PRD 14.2), so this only ever offers to add; it never changes a Saved Place.
 * Matching uses the location Trove already stored. A Saved Place whose stored
 * location is past its 30 days, or which has none, is left out rather than
 * guessed at - there is nothing to place it by, and none is bought to find out.
 */
export function savedPlacesNearTrip(input: {
  destinations: readonly { location?: Coordinate | null; name: string }[];
  saved: readonly SavedPlace[];
  tripPlaceIds: ReadonlySet<string>;
}): SavedNearTrip[] {
  const located = input.destinations.flatMap((destination) =>
    destination.location ? [{ location: destination.location, name: destination.name }] : [],
  );
  if (!located.length) return [];

  const groups = new Map<string, SavedPlace[]>();
  for (const saved of input.saved) {
    const place = saved.place;
    if (input.tripPlaceIds.has(place.id) || !place.location || place.snapshot?.stale) continue;

    let nearest: { metres: number; name: string } | null = null;
    for (const destination of located) {
      const metres = haversineMeters(place.location, destination.location);
      if (!nearest || metres < nearest.metres) nearest = { metres, name: destination.name };
    }
    if (nearest && nearest.metres <= DESTINATION_REACH_KM * 1000)
      groups.set(nearest.name, [...(groups.get(nearest.name) ?? []), saved]);
  }

  return [...groups].map(([destinationName, places]) => ({ destinationName, places }));
}
