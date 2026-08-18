import type { PlaceSnapshot } from '@/lib/saved/api';

/** The little a Place needs to be named — shared by the Places list and the itinerary. */
type NameableTripPlace = {
  customName: string | null;
  place: {
    id: string;
    kind: 'custom' | 'provider';
    name: string | null;
    providerAddress: string | null;
    providerLabel: string | null;
    snapshot?: PlaceSnapshot | null;
  };
};

type NameFallbacks = {
  /** Shown when a custom Place somehow has no name of its own. */
  custom: string;
  /** Shown when the Place has never been resolved and carries no label either. */
  provider: string;
};

/**
 * The name the provider gave, as opposed to the one the traveller chose. Worth
 * showing beside a renamed Place so "Mum's place" still says which address it is.
 */
export function resolveProviderPlaceName(tripPlace: NameableTripPlace) {
  if (tripPlace.place.kind === 'custom') return null;
  return tripPlace.place.snapshot?.name ?? tripPlace.place.providerLabel;
}

/**
 * One name for a trip Place, resolved the same way everywhere it appears.
 *
 * The traveller's own name wins. Failing that a custom Place carries its name and
 * a provider Place carries the snapshot Trove stored when it was added — which is
 * why this no longer takes a map of separately fetched details: the name travels
 * with the Place. The label captured when the Place was first added is the last
 * resort, so a Place resolved before snapshots existed is still recognisable.
 */
export function resolveTripPlaceName(tripPlace: NameableTripPlace, fallbacks: NameFallbacks) {
  const custom = tripPlace.customName?.trim();
  if (custom) return custom;
  if (tripPlace.place.kind === 'custom') return tripPlace.place.name ?? fallbacks.custom;
  return resolveProviderPlaceName(tripPlace) ?? fallbacks.provider;
}

/** The address line, falling back the same way the name does. */
export function resolveTripPlaceAddress(
  tripPlace: NameableTripPlace & { place: { note: string | null } },
  fallbacks: NameFallbacks,
) {
  if (tripPlace.place.kind === 'custom') return tripPlace.place.note ?? fallbacks.custom;
  return tripPlace.place.snapshot?.address ?? tripPlace.place.providerAddress ?? fallbacks.provider;
}
