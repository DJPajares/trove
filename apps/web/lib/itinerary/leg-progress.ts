import { haversineMeters, type Coordinate } from '@/lib/maps/haversine';

/**
 * How far along the hop between two stops a traveller has got, as `0..1`.
 *
 * Both ends are measured the same way - straight lines - so the ratio stays
 * consistent and can never exceed the leg it describes. The label beside the
 * bar still shows the real road distance when Routes has given one; mixing the
 * two here would let the marker run off the end of its own track.
 *
 * This measures distance to the destination, so it knows nothing about
 * direction: someone who has walked past the stop reads as nearly arrived,
 * which is the right answer for a marker, and someone further from the stop
 * than the leg is long reads as not yet started, which is the safest one. A
 * zero-length leg reads as arrived, because the two stops are the same place.
 */
export function legProgressFraction(
  origin: Coordinate,
  destination: Coordinate,
  position: Coordinate,
) {
  const total = haversineMeters(origin, destination);
  if (total === 0) return 1;

  const remaining = haversineMeters(position, destination);

  return Math.min(1, Math.max(0, 1 - remaining / total));
}
