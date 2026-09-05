const EARTH_RADIUS_METRES = 6_371_000;

export type Coordinate = { latitude: number; longitude: number };

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Great-circle distance between two points, in metres.
 *
 * This is the free answer. Trove buys road distances from Routes and caches
 * them, so a straight line is never a substitute for one on a surface that
 * promises travel distance - but for working out how far along a leg someone
 * has got, a ratio of two straight lines is both honest and unbillable.
 */
export function haversineMeters(from: Coordinate, to: Coordinate) {
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);

  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.sin(longitudeDelta / 2) ** 2 * Math.cos(fromLatitude) * Math.cos(toLatitude);

  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(a)));
}
