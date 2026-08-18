import { categorizePlaceTypes } from './place-categories.js';
import { recordProviderCall } from './provider-usage.js';
import {
  PlaceProviderError,
  type PlaceDetailsRequest,
  type PlaceOpeningPeriod,
  type PlaceOpeningPoint,
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

/**
 * Identity and location: everything routing and list rendering read, and
 * nothing else. The fields left out — rating, review count, opening hours,
 * website, phone, photos — are precisely the ones that move a Place Details
 * call into the most expensive billing tier, so asking for them on a call that
 * only needs a latitude is the single most wasteful thing this client can do.
 */
export const GOOGLE_PLACE_LOCATION_FIELD_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'types',
  'primaryType',
  'googleMapsUri',
  'utcOffsetMinutes',
].join(',');

/** Everything above plus the mutable detail a place's own sheet displays. */
export const GOOGLE_PLACE_DETAILS_FIELD_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'nationalPhoneNumber',
  'types',
  'primaryType',
  'googleMapsUri',
  'photos',
  'rating',
  'regularOpeningHours',
  'userRatingCount',
  'utcOffsetMinutes',
  'websiteUri',
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
  nationalPhoneNumber?: string;
  photos?: GooglePhoto[];
  primaryType?: string;
  rating?: number;
  regularOpeningHours?: {
    periods?: GoogleOpeningPeriod[];
    weekdayDescriptions?: string[];
  };
  types?: string[];
  userRatingCount?: number;
  utcOffsetMinutes?: number;
  websiteUri?: string;
};

/**
 * Google states opening points as day/hour/minute in the place's local time.
 * Every field is optional on the wire because proto3 JSON omits zero values,
 * and zero is common here: Sunday is day 0, midnight is hour 0, and any place
 * opening on the hour has minute 0.
 */
type GoogleOpeningPoint = { day?: number; hour?: number; minute?: number };
type GoogleOpeningPeriod = { close?: GoogleOpeningPoint; open?: GoogleOpeningPoint };

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

/**
 * An absent day/hour/minute means zero, not missing: proto3 JSON drops zero
 * values, so requiring all three to be present would discard Sunday, midnight,
 * and every place that opens on the hour. Only out-of-range values are
 * rejected, and only the whole period, never a silently corrected point.
 */
function mapOpeningPoint(point: GoogleOpeningPoint | undefined): PlaceOpeningPoint | null {
  if (!point) return null;

  const day = point.day ?? 0;
  const hour = point.hour ?? 0;
  const minute = point.minute ?? 0;
  const inRange =
    Number.isInteger(day) &&
    day >= 0 &&
    day <= 6 &&
    Number.isInteger(hour) &&
    hour >= 0 &&
    hour <= 23 &&
    Number.isInteger(minute) &&
    minute >= 0 &&
    minute <= 59;

  return inRange ? { day, hour, minute } : null;
}

function mapOpeningPeriods(periods: GoogleOpeningPeriod[] | undefined): PlaceOpeningPeriod[] {
  return (periods ?? []).flatMap((period): PlaceOpeningPeriod[] => {
    const open = mapOpeningPoint(period.open);
    if (!open) return [];

    // A period with an open point and no close is how Google reports a place
    // that never shuts. A close that is present but malformed is dropped with
    // the period rather than being reinterpreted as always open.
    if (period.close === undefined) return [{ close: null, open }];

    const close = mapOpeningPoint(period.close);
    return close ? [{ close, open }] : [];
  });
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

  private async requestJson<T>(url: URL, init: RequestInit, operation: string): Promise<T> {
    if (!this.apiKey) {
      throw new PlaceProviderError('configuration_missing');
    }

    // Counted here rather than in the callers so it records requests that are
    // actually about to leave the process, not ones short-circuited above.
    recordProviderCall({ endpoint: url.pathname, operation, provider: 'google' });

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
      'search',
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

    const fieldMask =
      request.detail === 'location'
        ? GOOGLE_PLACE_LOCATION_FIELD_MASK
        : GOOGLE_PLACE_DETAILS_FIELD_MASK;
    const response = await this.requestJson<GooglePlaceDetails>(
      url,
      { headers: { 'X-Goog-FieldMask': fieldMask }, method: 'GET' },
      'getDetails',
    );
    const externalPlaceId = cleanString(response.id);
    // A named venue always gets a displayName, but a plain geocoded address
    // (a friend's house, a street corner) often doesn't — its formatted
    // address is the only identifying text Google returns for it, and is a
    // perfectly usable name rather than a reason to treat the place as
    // unresolvable.
    const name = cleanString(response.displayName?.text) ?? cleanString(response.formattedAddress);

    if (!externalPlaceId || !name) {
      throw new PlaceProviderError('provider_unavailable');
    }

    const rawTypes = cleanStringList(response.types);
    const primaryType = cleanString(response.primaryType);
    const latitude = response.location?.latitude;
    const longitude = response.location?.longitude;
    const hasLocation = typeof latitude === 'number' && typeof longitude === 'number';

    const openingPeriods = mapOpeningPeriods(response.regularOpeningHours?.periods);

    return {
      category: categorizePlaceTypes(rawTypes, primaryType),
      externalPlaceId,
      formattedAddress: cleanString(response.formattedAddress),
      googleMapsUri: cleanString(response.googleMapsUri),
      location: hasLocation ? { latitude, longitude } : null,
      name,
      nationalPhoneNumber: cleanString(response.nationalPhoneNumber),
      openingPeriods,
      photos: (response.photos ?? [])
        .map(mapPhoto)
        .filter((photo): photo is PlacePhotoReference => photo !== null),
      primaryType,
      provider: 'google',
      rating: typeof response.rating === 'number' ? response.rating : null,
      rawTypes,
      regularOpeningHours: cleanStringList(response.regularOpeningHours?.weekdayDescriptions),
      userRatingCount: Number.isInteger(response.userRatingCount)
        ? (response.userRatingCount ?? null)
        : null,
      utcOffsetMinutes:
        typeof response.utcOffsetMinutes === 'number' ? response.utcOffsetMinutes : null,
      websiteUri: cleanString(response.websiteUri),
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

    const response = await this.requestJson<GooglePhotoMedia>(
      url,
      { method: 'GET' },
      'resolvePhoto',
    );
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
