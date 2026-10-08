import type { Itinerary } from '@/lib/itinerary/api';
import type { SketchPoint } from '@/lib/maps/route-sketch';

import type { Memory } from './api';

/**
 * Where each Memory was kept, in the order given, for Memories at a Place with
 * coordinates - the places the journal's drawn route runs through. A Memory
 * carries its Trip Place but not where that is, so the coordinates come from
 * the itinerary's Trip Places, which the journal has already loaded. Staying
 * put between Memories adds no new point.
 */
export function locatedMemoryPlaces(
  memories: readonly Memory[],
  tripPlaces: Itinerary['tripPlaces'],
): SketchPoint[] {
  const locations = new Map(
    tripPlaces.flatMap((tripPlace) =>
      tripPlace.place.location ? [[tripPlace.id, tripPlace.place.location] as const] : [],
    ),
  );
  const points: SketchPoint[] = [];
  let previousId: string | null = null;

  for (const memory of memories) {
    const id = memory.tripPlace?.id ?? null;
    if (!id || id === previousId) continue;
    const location = locations.get(id);
    if (!location) continue;
    previousId = id;
    points.push({ latitude: location.latitude, longitude: location.longitude });
  }

  return points;
}
