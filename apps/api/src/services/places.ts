import { randomUUID } from 'node:crypto';

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

/**
 * `location` asks the provider only for identity and coordinates — everything
 * Trove stores and every screen renders. `evidence` adds just the mutable
 * fields Plan Score reads (rating, hours), which are never stored.
 *
 * Required, not optional: an omitted level used to fall back to the most
 * expensive tier Google sells, so forgetting it was a silent bill rather than
 * a compile error.
 */
export type PlaceDetailLevel = 'evidence' | 'location';

export type PlaceDetailsRequest = {
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

export type ProviderPlaceDetails = {
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
  rawTypes: string[];
  utcOffsetMinutes: number | null;
};

export type PlaceOpeningPoint = {
  day: number;
  hour: number;
  minute: number;
};

export type PlaceOpeningPeriod = {
  close: PlaceOpeningPoint | null;
  open: PlaceOpeningPoint;
};

export type PlaceProviderErrorCode =
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
  getDetails(request: PlaceDetailsRequest): Promise<ProviderPlaceDetails>;
  search(request: PlaceSearchRequest): Promise<PlaceSuggestion[]>;
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
}
