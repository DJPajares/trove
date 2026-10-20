/**
 * Where a Google place search should look first. Searching itself happens only
 * when the traveller asks (see `useOnDemandPlaceSearch`), never per keystroke.
 */

/** The furthest Google allows a bias circle to reach. */
const LOCATION_BIAS_RADIUS_METERS = 50_000;

export type ProviderSearchLocationBias = {
  latitude: number;
  longitude: number;
  radiusMeters: number;
};

/**
 * Where to prefer results: around the trip's first destination Trove has
 * coordinates for. Nothing is invented for a destination with no known location.
 */
export function destinationLocationBias(
  destinations: readonly { location?: { latitude: number; longitude: number } | null }[],
): ProviderSearchLocationBias | null {
  const located = destinations.find((destination) => destination.location);
  return located?.location
    ? {
        latitude: located.location.latitude,
        longitude: located.location.longitude,
        radiusMeters: LOCATION_BIAS_RADIUS_METERS,
      }
    : null;
}
