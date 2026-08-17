import type { ProviderPlaceDetails } from '@/lib/saved/api';

/** The little a Place needs to be named — shared by the Places list and the itinerary. */
type NameableTripPlace = {
  customName: string | null;
  place: {
    id: string;
    kind: 'custom' | 'provider';
    name: string | null;
    providerAddress: string | null;
    providerLabel: string | null;
  };
};

type NameFallbacks = {
  /** Shown when a custom Place somehow has no name of its own. */
  custom: string;
  /** Shown when the provider has not been asked yet, or had nothing to say. */
  provider: string;
};

type Details = Record<string, ProviderPlaceDetails | null | undefined>;

/**
 * The name the provider gave, as opposed to the one the traveller chose. Worth
 * showing beside a renamed Place so "Mum's place" still says which address it is.
 */
export function resolveProviderPlaceName(tripPlace: NameableTripPlace, providerDetails: Details) {
  if (tripPlace.place.kind === 'custom') return null;
  return providerDetails[tripPlace.place.id]?.name ?? tripPlace.place.providerLabel;
}

/**
 * One name for a trip Place, resolved the same way everywhere it appears.
 *
 * The traveller's own name wins. Failing that a custom Place carries its name and
 * a provider Place borrows whichever one Google most recently returned — which is
 * why this takes the resolved details rather than reading them off the Place.
 * The label captured when the Place was first added is the last resort, so a
 * provider Trove cannot reach today still leaves the Place recognisable.
 */
export function resolveTripPlaceName(
  tripPlace: NameableTripPlace,
  providerDetails: Details,
  fallbacks: NameFallbacks,
) {
  const custom = tripPlace.customName?.trim();
  if (custom) return custom;
  if (tripPlace.place.kind === 'custom') return tripPlace.place.name ?? fallbacks.custom;
  return resolveProviderPlaceName(tripPlace, providerDetails) ?? fallbacks.provider;
}

/** The address line, falling back the same way the name does. */
export function resolveTripPlaceAddress(
  tripPlace: NameableTripPlace & { place: { note: string | null } },
  providerDetails: Details,
  fallbacks: NameFallbacks,
) {
  if (tripPlace.place.kind === 'custom') return tripPlace.place.note ?? fallbacks.custom;
  return (
    providerDetails[tripPlace.place.id]?.formattedAddress ??
    tripPlace.place.providerAddress ??
    fallbacks.provider
  );
}
