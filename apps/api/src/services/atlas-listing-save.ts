import { AiPlaceGrounder } from './ai-place-grounding.js';
import { createAiPlannerProviderContext } from './ai-planner-provider-context.js';
import { createCanonicalPlacesService } from './canonical-places.js';
import { savePlace, type SavedPlace } from './saved-places.js';

/** One Atlas listing the traveller chose to keep in Finds (PRD 40.5). */
export type AtlasListingSaveInput = {
  countryCode: string;
  /** The guide's destination, e.g. "Bohol", or the country name for a country guide. */
  destinationName: string;
  languageCode?: string;
  latitude?: number | null;
  longitude?: number | null;
  name: string;
};

export type AtlasListingSaveResult =
  | { status: 'saved'; resolution: 'custom' | 'verified'; savedPlace: SavedPlace }
  | { status: 'unavailable' };

/** Listings carry their own coordinates; keep a match close to them. */
const LISTING_BIAS_METERS = 5_000;
const ATLAS_LISTING_CANDIDATE_ID = 'atlas-listing';

type Grounder = Pick<AiPlaceGrounder, 'groundCandidate'>;

type Dependencies = {
  createCustomPlace: (
    userId: string,
    input: { location: { latitude: number; longitude: number } | null; name: string },
  ) => Promise<{ id: string }>;
  grounder: Grounder | null;
  save: (userId: string, placeId: string) => Promise<SavedPlace>;
};

function defaultDependencies(): Dependencies {
  const canonical = createCanonicalPlacesService();
  const context = createAiPlannerProviderContext({ source: 'atlas' });
  return {
    createCustomPlace: (userId, input) => canonical.createCustomPlace(userId, input),
    grounder: context.placesProvider
      ? new AiPlaceGrounder(context.placesProvider, canonical)
      : null,
    save: savePlace,
  };
}

/**
 * Resolves one listing on demand, as any explicit selection does (PRD 29.5):
 * one rich Text Search acquires identity and scoring fields together, and a
 * fresh earlier grounding of the same listing costs nothing. A listing with no
 * single confident match becomes an unverified Custom Place carrying its name
 * and coordinates, as Make it a trip does (PRD 40.4). When the provider cannot
 * be asked at all, nothing is saved, so the traveller can simply try again.
 */
export async function saveAtlasListing(
  userId: string,
  input: AtlasListingSaveInput,
  dependencies: Dependencies = defaultDependencies(),
): Promise<AtlasListingSaveResult> {
  const name = input.name.trim();
  const locality = input.destinationName.trim();
  const location =
    typeof input.latitude === 'number' && typeof input.longitude === 'number'
      ? { latitude: input.latitude, longitude: input.longitude }
      : null;

  if (!dependencies.grounder) return { status: 'unavailable' };

  const grounded = await dependencies.grounder.groundCandidate({
    countryCode: input.countryCode,
    countryCodeHint: input.countryCode,
    detail: 'evidence',
    id: ATLAS_LISTING_CANDIDATE_ID,
    languageCode: input.languageCode,
    localityHint: locality || null,
    locationBias: location ? { ...location, radiusMeters: LISTING_BIAS_METERS } : undefined,
    name,
    note: null,
    regionCode: input.countryCode,
    searchQuery: [name, locality].filter(Boolean).join(', '),
  });

  if (grounded.place.resolution === 'verified') {
    const savedPlace = await dependencies.save(userId, grounded.place.placeId);
    return { resolution: 'verified', savedPlace, status: 'saved' };
  }
  if (grounded.place.verification === 'not_checked') return { status: 'unavailable' };

  const custom = await dependencies.createCustomPlace(userId, { location, name });
  const savedPlace = await dependencies.save(userId, custom.id);
  return { resolution: 'custom', savedPlace, status: 'saved' };
}
