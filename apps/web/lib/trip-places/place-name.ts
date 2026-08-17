import type { ProviderPlaceDetails } from '@/lib/saved/api';

/** The little a Place needs to be named — shared by the Places list and the itinerary. */
type NameableTripPlace = {
  customName: string | null;
  place: { id: string; kind: 'custom' | 'provider'; name: string | null };
};

type NameFallbacks = {
  /** Shown when a custom Place somehow has no name of its own. */
  custom: string;
  /** Shown when the provider has not been asked yet, or had nothing to say. */
  provider: string;
};

/**
 * One name for a trip Place, resolved the same way everywhere it appears.
 *
 * The traveller's own name wins. Failing that a custom Place carries its name and
 * a provider Place borrows whichever one Google most recently returned — which is
 * why this takes the resolved details rather than reading them off the Place.
 */
export function resolveTripPlaceName(
  tripPlace: NameableTripPlace,
  providerDetails: Record<string, ProviderPlaceDetails | null | undefined>,
  fallbacks: NameFallbacks,
) {
  const custom = tripPlace.customName?.trim();
  if (custom) return custom;
  if (tripPlace.place.kind === 'custom') return tripPlace.place.name ?? fallbacks.custom;
  return providerDetails[tripPlace.place.id]?.name ?? fallbacks.provider;
}
