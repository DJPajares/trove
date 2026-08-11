import { categorizePlaceTypes } from './place-categories.js';
import {
  PlaceProviderError,
  type PlaceDetailsRequest,
  type PlacePhotoAttribution,
  type PlacePhotoRequest,
  type PlacePhotoReference,
  type PlaceSearchRequest,
  type PlacesProvider,
  type PlaceSuggestion,
  type ProviderPlaceDetails,
  type ResolvedPlacePhoto,
} from './places.js';

const DEFAULT_BASE_URL = 'https://places.googleapis.com';
const DEFAULT_TIMEOUT_MS = 8_000;
const PHOTO_NAME_PATTERN = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,36}$/;

export const GOOGLE_AUTOCOMPLETE_FIELD_MASK = [
  'suggestions.placePrediction.placeId',
  'suggestions.placePrediction.text.text',
  'suggestions.placePrediction.structuredFormat.mainText.text',
  'suggestions.placePrediction.structuredFormat.secondaryText.text',
  'suggestions.placePrediction.types',
].join(',');

export const GOOGLE_PLACE_DETAILS_FIELD_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'types',
  'primaryType',
  'googleMapsUri',
  'photos',
].join(',');

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

type GoogleText = {
  text?: string;
};

type GooglePlacePrediction = {
  placeId?: string;
  structuredFormat?: {
    mainText?: GoogleText;
    secondaryText?: GoogleText;
  };
  text?: GoogleText;
  types?: string[];
};

type GoogleAutocompleteResponse = {
  suggestions?: Array<{ placePrediction?: GooglePlacePrediction }>;
};

type GoogleAuthorAttribution = {
  displayName?: string;
  photoUri?: string;
  uri?: string;
};

type GooglePhoto = {
  authorAttributions?: GoogleAuthorAttribution[];
  heightPx?: number;
  name?: string;
  widthPx?: number;
};

type GooglePlaceDetails = {
  displayName?: GoogleText;
  formattedAddress?: string;
  googleMapsUri?: string;
  id?: string;
  location?: {
    latitude?: number;
    longitude?: number;
  };
  photos?: GooglePhoto[];
  primaryType?: string;
  types?: string[];
};

type GooglePhotoMedia = {
  name?: string;
  photoUri?: string;
};

type GoogleErrorResponse = {
  error?: {
    status?: string;
  };
};

type GooglePlacesProviderOptions = {
  apiKey: string;
  baseUrl?: string;
  fetcher?: Fetcher;
  requestTimeoutMs?: number;
};

function cleanString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function cleanStringList(values: string[] | undefined) {
  return (values ?? []).map(cleanString).filter((value): value is string => value !== null);
}

function mapGoogleError(responseStatus: number, body: GoogleErrorResponse) {
  const providerStatus = body.error?.status;

  if (responseStatus === 404 || providerStatus === 'NOT_FOUND') {
    return new PlaceProviderError('not_found');
  }

  if (providerStatus === 'RESOURCE_EXHAUSTED') {
    return new PlaceProviderError('quota_exceeded');
  }

  if (responseStatus === 429) {
    return new PlaceProviderError('rate_limited');
  }

  if (
    responseStatus === 401 ||
    providerStatus === 'PERMISSION_DENIED' ||
    providerStatus === 'UNAUTHENTICATED'
  ) {
    return new PlaceProviderError('configuration_missing');
  }

  if (responseStatus === 403) {
    return new PlaceProviderError('quota_exceeded');
  }

  if (responseStatus === 400 || providerStatus === 'INVALID_ARGUMENT') {
    return new PlaceProviderError('invalid_request');
  }

  return new PlaceProviderError('provider_unavailable');
}

function mapAttribution(attribution: GoogleAuthorAttribution): PlacePhotoAttribution | null {
  const displayName = cleanString(attribution.displayName);

  if (!displayName) {
    return null;
  }

  return {
    displayName,
    photoUri: cleanString(attribution.photoUri),
    uri: cleanString(attribution.uri),
  };
}

function mapPhoto(photo: GooglePhoto): PlacePhotoReference | null {
  const name = cleanString(photo.name);

  if (!name || !PHOTO_NAME_PATTERN.test(name)) {
    return null;
  }

  return {
    authorAttributions: (photo.authorAttributions ?? [])
      .map(mapAttribution)
      .filter((attribution): attribution is PlacePhotoAttribution => attribution !== null),
    heightPx: Number.isInteger(photo.heightPx) ? (photo.heightPx ?? null) : null,
    name,
    widthPx: Number.isInteger(photo.widthPx) ? (photo.widthPx ?? null) : null,
  };
}

function createSuggestion(prediction: GooglePlacePrediction): PlaceSuggestion | null {
  const externalPlaceId = cleanString(prediction.placeId);
  const description = cleanString(prediction.structuredFormat?.secondaryText?.text);
  const name =
    cleanString(prediction.structuredFormat?.mainText?.text) ?? cleanString(prediction.text?.text);
  const fullText =
    cleanString(prediction.text?.text) ??
    (name ? [name, description].filter(Boolean).join(', ') : null);
  const rawTypes = cleanStringList(prediction.types);

  if (!externalPlaceId || !name || !fullText) {
    return null;
  }

  return {
    category: categorizePlaceTypes(rawTypes),
    description,
    externalPlaceId,
    fullText,
    name,
    provider: 'google',
    rawTypes,
  };
}

function isValidPhotoDimension(value: number | undefined) {
  return value === undefined || (Number.isInteger(value) && value >= 1 && value <= 4_800);
}

function isValidLocationBias(request: PlaceSearchRequest) {
  if (!request.locationBias) {
    return true;
  }

  return (
    request.locationBias.latitude >= -90 &&
    request.locationBias.latitude <= 90 &&
    request.locationBias.longitude >= -180 &&
    request.locationBias.longitude <= 180 &&
    request.locationBias.radiusMeters > 0 &&
    request.locationBias.radiusMeters <= 50_000
  );
}

export class GooglePlacesProvider implements PlacesProvider {
  readonly name = 'google' as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly requestTimeoutMs: number;

  constructor(options: GooglePlacesProviderOptions) {
    this.apiKey = options.apiKey.trim();
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.fetcher = options.fetcher ?? globalThis.fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async requestJson<T>(url: URL, init: RequestInit): Promise<T> {
    if (!this.apiKey) {
      throw new PlaceProviderError('configuration_missing');
    }

    let response: Response;

    try {
      response = await this.fetcher(url, {
        ...init,
        headers: {
          Accept: 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          ...init.headers,
        },
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (error) {
      throw new PlaceProviderError('provider_unavailable', { cause: error });
    }

    const body = (await response.json().catch(() => ({}))) as T & GoogleErrorResponse;

    if (!response.ok) {
      throw mapGoogleError(response.status, body);
    }

    return body;
  }

  async search(request: PlaceSearchRequest): Promise<PlaceSuggestion[]> {
    if (
      !request.input.trim() ||
      !SESSION_TOKEN_PATTERN.test(request.sessionToken) ||
      !isValidLocationBias(request)
    ) {
      throw new PlaceProviderError('invalid_request');
    }

    const response = await this.requestJson<GoogleAutocompleteResponse>(
      new URL('/v1/places:autocomplete', this.baseUrl),
      {
        body: JSON.stringify({
          input: request.input,
          languageCode: request.languageCode,
          locationBias: request.locationBias
            ? {
                circle: {
                  center: {
                    latitude: request.locationBias.latitude,
                    longitude: request.locationBias.longitude,
                  },
                  radius: request.locationBias.radiusMeters,
                },
              }
            : undefined,
          regionCode: request.regionCode,
          sessionToken: request.sessionToken,
        }),
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-FieldMask': GOOGLE_AUTOCOMPLETE_FIELD_MASK,
        },
        method: 'POST',
      },
    );

    return (response.suggestions ?? [])
      .map((suggestion) =>
        suggestion.placePrediction ? createSuggestion(suggestion.placePrediction) : null,
      )
      .filter((suggestion): suggestion is PlaceSuggestion => suggestion !== null);
  }

  async getDetails(request: PlaceDetailsRequest): Promise<ProviderPlaceDetails> {
    if (
      !request.externalPlaceId.trim() ||
      (request.sessionToken !== undefined && !SESSION_TOKEN_PATTERN.test(request.sessionToken))
    ) {
      throw new PlaceProviderError('invalid_request');
    }

    const url = new URL(`/v1/places/${encodeURIComponent(request.externalPlaceId)}`, this.baseUrl);

    if (request.languageCode) {
      url.searchParams.set('languageCode', request.languageCode);
    }

    if (request.regionCode) {
      url.searchParams.set('regionCode', request.regionCode);
    }

    if (request.sessionToken) {
      url.searchParams.set('sessionToken', request.sessionToken);
    }

    const response = await this.requestJson<GooglePlaceDetails>(url, {
      headers: { 'X-Goog-FieldMask': GOOGLE_PLACE_DETAILS_FIELD_MASK },
      method: 'GET',
    });
    const externalPlaceId = cleanString(response.id);
    const name = cleanString(response.displayName?.text);

    if (!externalPlaceId || !name) {
      throw new PlaceProviderError('provider_unavailable');
    }

    const rawTypes = cleanStringList(response.types);
    const primaryType = cleanString(response.primaryType);
    const latitude = response.location?.latitude;
    const longitude = response.location?.longitude;
    const hasLocation = typeof latitude === 'number' && typeof longitude === 'number';

    return {
      category: categorizePlaceTypes(rawTypes, primaryType),
      externalPlaceId,
      formattedAddress: cleanString(response.formattedAddress),
      googleMapsUri: cleanString(response.googleMapsUri),
      location: hasLocation ? { latitude, longitude } : null,
      name,
      photos: (response.photos ?? [])
        .map(mapPhoto)
        .filter((photo): photo is PlacePhotoReference => photo !== null),
      primaryType,
      provider: 'google',
      rawTypes,
    };
  }

  async resolvePhoto(request: PlacePhotoRequest): Promise<ResolvedPlacePhoto> {
    if (
      !PHOTO_NAME_PATTERN.test(request.name) ||
      (request.maxHeightPx === undefined && request.maxWidthPx === undefined) ||
      !isValidPhotoDimension(request.maxHeightPx) ||
      !isValidPhotoDimension(request.maxWidthPx)
    ) {
      throw new PlaceProviderError('invalid_request');
    }

    const url = new URL(`/v1/${request.name}/media`, this.baseUrl);

    if (request.maxHeightPx) {
      url.searchParams.set('maxHeightPx', String(request.maxHeightPx));
    }

    if (request.maxWidthPx) {
      url.searchParams.set('maxWidthPx', String(request.maxWidthPx));
    }

    url.searchParams.set('skipHttpRedirect', 'true');

    const response = await this.requestJson<GooglePhotoMedia>(url, { method: 'GET' });
    const name = cleanString(response.name);
    const uri = cleanString(response.photoUri);

    if (!name || !uri) {
      throw new PlaceProviderError('provider_unavailable');
    }

    try {
      const photoUrl = new URL(uri);

      if (photoUrl.protocol !== 'https:') {
        throw new Error('Unexpected photo URL protocol');
      }
    } catch (error) {
      throw new PlaceProviderError('provider_unavailable', { cause: error });
    }

    return { name, uri };
  }
}
