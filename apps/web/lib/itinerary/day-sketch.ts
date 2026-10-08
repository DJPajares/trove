import type { ItineraryTripPlace } from './api';
import type { DayTimelineEntry } from './day-sequence';

export type DaySketchPlace = {
  /** Stable within the day: a Stay end, or the stop's own item. */
  key: string;
  kind: 'stay' | 'stop';
  latitude: number;
  longitude: number;
  /** The same number the list and the map give this stop. */
  number: number;
};

/**
 * Where a day goes, in the order it is travelled: the Stay it starts from, each
 * stop with a location, and the Stay it ends at - read off the same sequence
 * the list and the map are built from, so the sketch can never draw a different
 * day from the one beside it. Stops with nowhere to be are left out rather
 * than guessed at, and a day that starts and ends at one Stay closes its loop.
 */
export function daySketchPlaces(
  entries: readonly DayTimelineEntry[],
  tripPlaces: readonly ItineraryTripPlace[],
): DaySketchPlace[] {
  const places: DaySketchPlace[] = [];

  for (const entry of entries) {
    if (entry.kind === 'leg') continue;

    if (entry.kind === 'base') {
      const location = tripPlaces.find((tripPlace) => tripPlace.id === entry.tripPlaceId)?.place
        .location;
      if (!location) continue;
      places.push({
        key: `stay-${entry.role}`,
        kind: 'stay',
        latitude: location.latitude,
        longitude: location.longitude,
        number: entry.stopNumber,
      });
      continue;
    }

    const location = entry.item.tripPlace?.place.location;
    if (!location) continue;
    places.push({
      key: entry.item.id,
      kind: 'stop',
      latitude: location.latitude,
      longitude: location.longitude,
      number: entry.stopNumber,
    });
  }

  return places;
}
