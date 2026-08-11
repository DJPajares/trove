import { randomUUID } from 'node:crypto';

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

export type PlaceDetailsRequest = {
  externalPlaceId: string;
  languageCode?: string;
  regionCode?: string;
  sessionToken?: string;
};

export type PlacePhotoRequest = {
  maxHeightPx?: number;
  maxWidthPx?: number;
  name: string;
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
  photoUri: string | null;
  uri: string | null;
};

export type PlacePhotoReference = {
  authorAttributions: PlacePhotoAttribution[];
  heightPx: number | null;
  name: string;
  widthPx: number | null;
};

export type ProviderPlaceDetails = {
  category: TrovePlaceCategory;
  externalPlaceId: string;
  formattedAddress: string | null;
  googleMapsUri: string | null;
  location: PlaceCoordinates | null;
  name: string;
  nationalPhoneNumber: string | null;
  photos: PlacePhotoReference[];
  primaryType: string | null;
  provider: PlaceProviderName;
  rating: number | null;
  rawTypes: string[];
  regularOpeningHours: string[];
  userRatingCount: number | null;
  websiteUri: string | null;
};

export type ResolvedPlacePhoto = {
  name: string;
  uri: string;
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
  resolvePhoto(request: PlacePhotoRequest): Promise<ResolvedPlacePhoto>;
  search(request: PlaceSearchRequest): Promise<PlaceSuggestion[]>;
}

type PlaceFreshness = {
  fetchedAt: string;
  source: 'live';
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
      provider: PlaceProviderName;
      status: 'empty';
    }
  | {
      code: PlacesUnavailableCode;
      provider: PlaceProviderName;
      status: 'unavailable';
    };

export type PlacePhotoResult =
  | {
      freshness: PlaceFreshness;
      photo: ResolvedPlacePhoto;
      provider: PlaceProviderName;
      status: 'ok';
    }
  | {
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
  ) {}

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

      if (providerError.code === 'not_found') {
        return { provider: this.provider.name, status: 'empty' };
      }

      return {
        code: getUnavailableCode(providerError),
        provider: this.provider.name,
        status: 'unavailable',
      };
    }
  }

  async resolvePhoto(request: PlacePhotoRequest): Promise<PlacePhotoResult> {
    try {
      const photo = await this.provider.resolvePhoto(request);

      return {
        freshness: createFreshness(this.clock),
        photo,
        provider: this.provider.name,
        status: 'ok',
      };
    } catch (error) {
      const providerError = getProviderError(error);

      if (providerError.code === 'not_found') {
        return { provider: this.provider.name, status: 'empty' };
      }

      return {
        code: getUnavailableCode(providerError),
        provider: this.provider.name,
        status: 'unavailable',
      };
    }
  }
}
