/**
 * Where an owned Place is, read only from what Trove already stores: the
 * traveller's own coordinates, or a provider snapshot still inside its 30-day
 * window. Reading never refreshes a snapshot, so callers stay cache-only.
 */
export type ContextPlace = {
  name?: string | null;
  coordinates?: { latitude: number; longitude: number } | null;
  expiresAt?: string;
};
type DecimalLike = number | { toNumber(): number };
type ContextSnapshot = {
  cachedTypes?: string[];
  externalPlaceId?: string;
  cachedAt?: Date | null;
  cachedName?: string | null;
  cachedLatitude?: DecimalLike | null;
  cachedLongitude?: DecimalLike | null;
};
export type OwnedContextPlace = {
  customName?: string | null;
  providerLabel?: string | null;
  customLatitude?: DecimalLike | null;
  customLongitude?: DecimalLike | null;
  providerRefs?: readonly ContextSnapshot[];
};
const number = (value: DecimalLike) => (typeof value === 'number' ? value : value.toNumber());
const LOCATION_TTL = 30 * 86_400_000;

/** Pure reading of owned values and permitted snapshots. No refresh-on-miss import. */
export function contextPlaceFromOwnedData(place: OwnedContextPlace, now: Date): ContextPlace {
  if (place.customLatitude != null && place.customLongitude != null)
    return {
      name: place.customName,
      coordinates: {
        latitude: number(place.customLatitude),
        longitude: number(place.customLongitude),
      },
    };
  const reference = place.providerRefs?.find(
    (entry) =>
      entry.cachedAt &&
      now.getTime() >= entry.cachedAt.getTime() &&
      now.getTime() < entry.cachedAt.getTime() + LOCATION_TTL,
  );
  return {
    name: place.customName ?? reference?.cachedName ?? place.providerLabel,
    coordinates:
      reference?.cachedLatitude != null && reference.cachedLongitude != null
        ? {
            latitude: number(reference.cachedLatitude),
            longitude: number(reference.cachedLongitude),
          }
        : null,
    ...(reference?.cachedAt
      ? { expiresAt: new Date(reference.cachedAt.getTime() + LOCATION_TTL).toISOString() }
      : {}),
  };
}
