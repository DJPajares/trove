import { createHash, randomUUID } from 'node:crypto';

import type { ProviderCacheMissReason } from './provider-usage.js';
import { providerTargetFingerprint } from './provider-usage.js';

export const PLACE_PROVIDERS = ['google'] as const;
export type PlaceProviderName = (typeof PLACE_PROVIDERS)[number];

export const TROVE_PLACE_CATEGORIES = [
  'destination',
  'things_to_do',
  'food_and_drink',
  'stay',
  'shopping',
  'transport',
  'other',
] as const;

export type TrovePlaceCategory = (typeof TROVE_PLACE_CATEGORIES)[number];

export type PlaceCoordinates = {
  latitude: number;
  longitude: number;
};

export type PlaceLocationBias = PlaceCoordinates & {
  radiusMeters: number;
};

export type PlaceSearchRequest = {
  input: string;
  languageCode?: string;
  locationBias?: PlaceLocationBias;
  regionCode?: string;
  sessionToken: string;
};

export type PlaceTextSearchRequest = {
  signal?: AbortSignal;
  /** Identity-only searches stay on Pro; scoring evidence requires Enterprise. */
  detail: PlaceDetailLevel;
  /** Internal attribution; never part of the provider query or cache key. */
  cacheMissReason?: ProviderCacheMissReason;
  languageCode?: string;
  locationBias?: PlaceLocationBias;
  regionCode?: string;
  textQuery: string;
};

export type ProviderAttribution = {
  provider: string;
  providerUri: string | null;
};

/**
 * `location` asks the provider only for identity and coordinates — everything
 * Trove stores and every screen renders. `evidence` adds just the mutable
 * fields rendered by rich details and reused by scoring in a dated, bounded cache.
 *
 * Required, not optional: an omitted level used to fall back to the most
 * expensive tier Google sells, so forgetting it was a silent bill rather than
 * a compile error.
 */
export type PlaceDetailLevel = 'evidence' | 'location';

export type PlaceDetailsRequest = {
  /**
   * `saved` and `itinerary` acquire the app's rich metadata together.
   * `details` is an opened Place details sheet: the only caller that resolves
   * photo media, so a cached answer acquired before photos were asked for is
   * re-acquired once rather than served without them.
   */
  purpose?: 'details' | 'itinerary' | 'saved';
  signal?: AbortSignal;
  /** Internal attribution supplied by the cache when this becomes outbound. */
  cacheMissReason?: ProviderCacheMissReason;
  detail: PlaceDetailLevel;
  externalPlaceId: string;
  languageCode?: string;
  regionCode?: string;
  sessionToken?: string;
};

export type PlaceSuggestion = {
  category: TrovePlaceCategory;
  description: string | null;
  externalPlaceId: string;
  fullText: string;
  name: string;
  provider: PlaceProviderName;
  rawTypes: string[];
};

export type PlacePhotoAttribution = {
  displayName: string;
  uri: string | null;
};

export type PlacePhoto = {
  authorAttributions: PlacePhotoAttribution[];
  heightPx: number | null;
  /** The provider's resource name for the photo. Server-side only. */
  name: string;
  /** A display URL resolved by an opened Place details request; null until then. */
  uri: string | null;
  widthPx: number | null;
};

/** Google's price level, from free (0) to very expensive (4). */
export type PlacePriceLevel = 0 | 1 | 2 | 3 | 4;

export type PlacePhotoMediaRequest = {
  maxWidthPx: number;
  name: string;
  /** Server-derived position in the unfiltered evidence snapshot. */
  photoIndex: number;
  signal?: AbortSignal;
};

export type PlacePhotoMediaResult =
  { status: 'ok'; uri: string } | { status: 'not_found' } | { status: 'unavailable' };

/** Public photo identity without exposing Google's resource name. */
export function placePhotoId(name: string) {
  return createHash('sha256').update(name).digest('hex').slice(0, 24);
}

export type PlacePhotoRequest = Omit<PlaceDetailsRequest, 'detail' | 'purpose'> & {
  photoId: string;
  evidenceFetchedAt: string;
};
export type PlacePhotoResult = PlacePhotoMediaResult | { status: 'stale' | 'disabled' };

export type ProviderPlaceDetails = {
  attributions: ProviderAttribution[];
  category: TrovePlaceCategory;
  externalPlaceId: string;
  formattedAddress: string | null;
  googleMapsUri: string | null;
  location: PlaceCoordinates | null;
  name: string;
  openingPeriods: PlaceOpeningPeriod[];
  primaryType: string | null;
  provider: PlaceProviderName;
  rating: number | null;
  userRatingCount?: number | null;
  openingHoursDescriptions?: string[];
  currentOpeningPeriods?: PlaceOpeningPeriod[];
  currentHoursValidFrom?: string | null;
  currentHoursValidThrough?: string | null;
  /**
   * Absent on evidence acquired before photos were part of the evidence mask,
   * which is how an opened sheet tells it apart from a place with no photos.
   */
  photos?: PlacePhoto[];
  websiteUri?: string | null;
  internationalPhoneNumber?: string | null;
  priceLevel?: PlacePriceLevel | null;
  rawTypes: string[];
  utcOffsetMinutes: number | null;
};

export type PlaceOpeningPoint = {
  date?: string;
  day: number;
  hour: number;
  minute: number;
};

export type PlaceOpeningPeriod = {
  close: PlaceOpeningPoint | null;
  open: PlaceOpeningPoint;
};

export type PlaceProviderErrorCode =
  | 'budget_exhausted'
  | 'configuration_missing'
  | 'invalid_request'
  | 'not_found'
  | 'provider_unavailable'
  | 'quota_exceeded'
  | 'rate_limited';

export class PlaceProviderError extends Error {
  constructor(
    public readonly code: PlaceProviderErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'PlaceProviderError';
  }
}

export interface PlacesProvider {
  readonly name: PlaceProviderName;
  /** Applies only to new photo media requests; absent preserves the three-photo default. */
  readonly photoLimit?: number;
  getDetails(request: PlaceDetailsRequest): Promise<ProviderPlaceDetails>;
  /** Billed per photo. Only an opened Place details sheet reaches for it. */
  getPhotoMedia?(request: PlacePhotoMediaRequest): Promise<string>;
  search(request: PlaceSearchRequest): Promise<PlaceSuggestion[]>;
}

export type ProviderPlaceIdentity = Omit<
  ProviderPlaceDetails,
  | 'location'
  | 'openingPeriods'
  | 'rating'
  | 'userRatingCount'
  | 'openingHoursDescriptions'
  | 'currentOpeningPeriods'
  | 'currentHoursValidFrom'
  | 'currentHoursValidThrough'
> & { location: PlaceCoordinates };

export type ProviderPlaceSearchResult = ProviderPlaceIdentity & {
  /** Present when requested, even when Google has no hours or rating. */
  evidence?: Pick<
    ProviderPlaceDetails,
    | 'openingPeriods'
    | 'rating'
    | 'userRatingCount'
    | 'openingHoursDescriptions'
    | 'currentOpeningPeriods'
    | 'currentHoursValidFrom'
    | 'currentHoursValidThrough'
    | 'photos'
    | 'websiteUri'
    | 'internationalPhoneNumber'
    | 'priceLevel'
  >;
};

export interface PlaceTextSearchProvider {
  readonly name: PlaceProviderName;
  textSearch(request: PlaceTextSearchRequest): Promise<ProviderPlaceSearchResult[]>;
}

/**
 * `fetchedAt` is when the provider actually answered, not when Trove replied,
 * so a cached snapshot reports its true age. PRD 11.7 requires provider-derived
 * data to carry that context rather than pass as current.
 */
export type PlaceFreshness = {
  fetchedAt: string;
  source: 'cache' | 'live';
};

export type PlacesUnavailableCode = Exclude<PlaceProviderErrorCode, 'not_found'>;

export type PlaceSearchResult =
  | {
      freshness: PlaceFreshness;
      provider: PlaceProviderName;
      sessionToken: string;
      status: 'empty' | 'ok';
      suggestions: PlaceSuggestion[];
    }
  | {
      code: PlacesUnavailableCode;
      provider: PlaceProviderName;
      sessionToken: string;
      status: 'unavailable';
    };

export type PlaceDetailsResult =
  | {
      freshness: PlaceFreshness;
      place: ProviderPlaceDetails;
      provider: PlaceProviderName;
      status: 'ok';
    }
  | {
      reason: 'not_found' | 'unusable_location';
      provider: PlaceProviderName;
      status: 'empty';
    }
  | {
      code: PlacesUnavailableCode;
      provider: PlaceProviderName;
      status: 'unavailable';
    };

function createFreshness(clock: () => Date): PlaceFreshness {
  return { fetchedAt: clock().toISOString(), source: 'live' };
}

/** The slice of the Fastify logger this service needs, so tests can pass a stub. */
export type PlacesLogger = {
  warn: (details: Record<string, unknown>, message: string) => void;
};

function getProviderError(error: unknown): PlaceProviderError {
  return error instanceof PlaceProviderError
    ? error
    : new PlaceProviderError('provider_unavailable', { cause: error });
}

function getUnavailableCode(error: PlaceProviderError): PlacesUnavailableCode {
  return error.code === 'not_found' ? 'provider_unavailable' : error.code;
}

export class PlacesService {
  constructor(
    private readonly provider: PlacesProvider,
    private readonly clock: () => Date = () => new Date(),
    private readonly logger?: PlacesLogger,
  ) {}

  /**
   * A provider failure reaches the traveller as a Place with no name, and every
   * cause — quota, a bad key, a timeout, nothing found — looks identical by the
   * time it gets there. The safe failure class is recorded here so it is
   * answerable later without leaking a provider URL through a nested error.
   */
  private warn(operation: string, error: PlaceProviderError, externalPlaceId?: string) {
    this.logger?.warn(
      {
        causeName: error.cause instanceof Error ? error.cause.name : undefined,
        code: error.code,
        placeFingerprint: externalPlaceId ? providerTargetFingerprint(externalPlaceId) : undefined,
        operation,
        provider: this.provider.name,
      },
      'places provider request failed',
    );
  }

  async search(
    request: Omit<PlaceSearchRequest, 'sessionToken'> & { sessionToken?: string },
  ): Promise<PlaceSearchResult> {
    const sessionToken = request.sessionToken ?? randomUUID();

    try {
      const suggestions = await this.provider.search({ ...request, sessionToken });

      return {
        freshness: createFreshness(this.clock),
        provider: this.provider.name,
        sessionToken,
        status: suggestions.length === 0 ? 'empty' : 'ok',
        suggestions,
      };
    } catch (error) {
      const providerError = getProviderError(error);
      this.warn('search', providerError);

      return {
        code: getUnavailableCode(providerError),
        provider: this.provider.name,
        sessionToken,
        status: 'unavailable',
      };
    }
  }

  async getDetails(request: PlaceDetailsRequest): Promise<PlaceDetailsResult> {
    try {
      const place = await this.provider.getDetails(request);

      return {
        freshness: createFreshness(this.clock),
        place,
        provider: this.provider.name,
        status: 'ok',
      };
    } catch (error) {
      const providerError = getProviderError(error);
      this.warn('getDetails', providerError, request.externalPlaceId);

      if (providerError.code === 'not_found') {
        return { provider: this.provider.name, reason: 'not_found', status: 'empty' };
      }

      return {
        code: getUnavailableCode(providerError),
        provider: this.provider.name,
        status: 'unavailable',
      };
    }
  }

  /** Photo resolution requires a bounded cached snapshot, supplied by CachedPlacesService. */
  getPhoto(_request: PlacePhotoRequest): Promise<PlacePhotoResult> {
    return Promise.resolve({ status: 'unavailable' });
  }

  /**
   * Preserve the provider's failure kind so callers can render a stable slot
   * and leave retries to an explicit user action.
   */
  async resolvePhotoMedia(request: PlacePhotoMediaRequest): Promise<PlacePhotoMediaResult> {
    if (!this.provider.getPhotoMedia) return { status: 'unavailable' };

    try {
      return { status: 'ok', uri: await this.provider.getPhotoMedia(request) };
    } catch (error) {
      const providerError = getProviderError(error);
      this.warn('getPhotoMedia', providerError);
      return providerError.code === 'not_found'
        ? { status: 'not_found' }
        : { status: 'unavailable' };
    }
  }
}
