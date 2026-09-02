import { categorizePlaceTypes } from './place-categories.js';
import {
  providerTargetFingerprint,
  type ProviderCallBudget,
  recordProviderCall,
  type ProviderCall,
  type ProviderCallSource,
} from './provider-usage.js';
import {
  PlaceProviderError,
  type PlaceDetailLevel,
  type PlaceDetailsRequest,
  type PlaceOpeningPeriod,
  type PlaceOpeningPoint,
  type PlaceSearchRequest,
  type PlaceTextSearchProvider,
  type PlaceTextSearchRequest,
  type PlacesProvider,
  type PlaceSuggestion,
  type ProviderPlaceDetails,
  type ProviderPlaceIdentity,
  type ProviderPlaceSearchResult,
} from './places.js';

const DEFAULT_BASE_URL = 'https://places.googleapis.com';
const DEFAULT_TIMEOUT_MS = 8_000;
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
 * nothing else. This mask reaches Place Details Pro. The fields left out —
 * rating, opening hours, website, phone and photos — are mutable and can move a
 * request into Place Details Enterprise or Enterprise + Atmosphere.
 */
export const GOOGLE_PLACE_LOCATION_FIELD_MASK = [
  'attributions',
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'types',
  'primaryType',
  'googleMapsUri',
  'utcOffsetMinutes',
].join(',');

export const GOOGLE_TEXT_SEARCH_FIELD_MASK = [
  'places.attributions',
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.types',
  'places.primaryType',
  'places.googleMapsUri',
  'places.utcOffsetMinutes',
].join(',');

export const GOOGLE_TEXT_SEARCH_EVIDENCE_FIELD_MASK = [
  GOOGLE_TEXT_SEARCH_FIELD_MASK,
  'places.regularOpeningHours',
  'places.rating',
].join(',');

/**
 * Rating and hours only — what Plan Score reads and nothing else. These already
 * require Place Details Enterprise, not Enterprise + Atmosphere, so nothing
 * that is never rendered gets to ride along with them.
 *
 * Note there is no `location` here, and that is load-bearing: the snapshot
 * write refuses a place without coordinates, so an evidence answer can never
 * reach the database. Rating and hours may not be stored at any TTL (PRD 11.4).
 */
export const GOOGLE_PLACE_EVIDENCE_FIELD_MASK = [
  'attributions',
  'id',
  'rating',
  'regularOpeningHours',
  'utcOffsetMinutes',
].join(',');

export const PLACE_DETAIL_FIELD_MASKS: Record<PlaceDetailLevel, string> = {
  evidence: GOOGLE_PLACE_EVIDENCE_FIELD_MASK,
  location: GOOGLE_PLACE_LOCATION_FIELD_MASK,
};

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

type GooglePlaceDetails = {
  attributions?: GoogleAttribution[];
  displayName?: GoogleText;
  formattedAddress?: string;
  googleMapsUri?: string;
  id?: string;
  location?: {
    latitude?: number;
    longitude?: number;
  };
  primaryType?: string;
  rating?: number;
  regularOpeningHours?: {
    periods?: GoogleOpeningPeriod[];
    weekdayDescriptions?: string[];
  };
  types?: string[];
  utcOffsetMinutes?: number;
};

type GoogleAttribution = {
  provider?: string;
  providerUri?: string;
};

type GoogleTextSearchResponse = { places?: GooglePlaceDetails[] };

/**
 * Google states opening points as day/hour/minute in the place's local time.
 * Every field is optional on the wire because proto3 JSON omits zero values,
 * and zero is common here: Sunday is day 0, midnight is hour 0, and any place
 * opening on the hour has minute 0.
 */
type GoogleOpeningPoint = { day?: number; hour?: number; minute?: number };
type GoogleOpeningPeriod = { close?: GoogleOpeningPoint; open?: GoogleOpeningPoint };

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
  source?: ProviderCallSource;
  budget?: ProviderCallBudget;
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

function isValidLocationBias(request: Pick<PlaceSearchRequest, 'locationBias'>) {
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

function mapAttributions(attributions: GoogleAttribution[] | undefined) {
  return (attributions ?? []).flatMap((attribution) => {
    const provider = cleanString(attribution.provider);
    if (!provider) return [];
    return [{ provider, providerUri: cleanString(attribution.providerUri) }];
  });
}

function mapPlaceIdentity(response: GooglePlaceDetails): ProviderPlaceIdentity | null {
  const externalPlaceId = cleanString(response.id);
  const name = cleanString(response.displayName?.text) ?? cleanString(response.formattedAddress);
  const latitude = response.location?.latitude;
  const longitude = response.location?.longitude;
  const hasLocation =
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180;
  if (!externalPlaceId || !name || !hasLocation) return null;

  const rawTypes = cleanStringList(response.types);
  const primaryType = cleanString(response.primaryType);
  return {
    attributions: mapAttributions(response.attributions),
    category: categorizePlaceTypes(rawTypes, primaryType),
    externalPlaceId,
    formattedAddress: cleanString(response.formattedAddress),
    googleMapsUri: cleanString(response.googleMapsUri),
    location: { latitude, longitude },
    name,
    primaryType,
    provider: 'google',
    rawTypes,
    utcOffsetMinutes:
      typeof response.utcOffsetMinutes === 'number' ? response.utcOffsetMinutes : null,
  };
}

export class GooglePlacesProvider implements PlacesProvider, PlaceTextSearchProvider {
  readonly name = 'google' as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly requestTimeoutMs: number;
  private readonly source: ProviderCallSource;
  private readonly budget?: ProviderCallBudget;

  constructor(options: GooglePlacesProviderOptions) {
    this.apiKey = options.apiKey.trim();
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.fetcher = options.fetcher ?? globalThis.fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.source = options.source ?? 'test';
    this.budget = options.budget;
  }

  private async requestJson<T>(
    url: URL,
    init: RequestInit,
    call: Omit<ProviderCall, 'kind' | 'provider' | 'source'>,
  ): Promise<T> {
    if (!this.apiKey) {
      throw new PlaceProviderError('configuration_missing');
    }

    if (this.budget && !this.budget.claim()) {
      throw new PlaceProviderError('budget_exhausted');
    }

    // Counted here rather than in the callers so it records requests that are
    // actually about to leave the process, not ones short-circuited above.
    recordProviderCall({ ...call, provider: 'google', source: this.source });

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
      {
        endpoint: '/v1/places:autocomplete',
        expectedSku: 'places-autocomplete-requests',
        operation: 'search',
      },
    );

    return (response.suggestions ?? [])
      .map((suggestion) =>
        suggestion.placePrediction ? createSuggestion(suggestion.placePrediction) : null,
      )
      .filter((suggestion): suggestion is PlaceSuggestion => suggestion !== null);
  }

  async textSearch(request: PlaceTextSearchRequest): Promise<ProviderPlaceSearchResult[]> {
    if (!request.textQuery.trim() || !isValidLocationBias(request)) {
      throw new PlaceProviderError('invalid_request');
    }

    const response = await this.requestJson<GoogleTextSearchResponse>(
      new URL('/v1/places:searchText', this.baseUrl),
      {
        body: JSON.stringify({
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
          // Text Search is billed per request, not per result. A wider page
          // costs the same and is what lets grounding tell an ambiguous name
          // apart from one whose only good match was ranked third.
          pageSize: 5,
          regionCode: request.regionCode,
          textQuery: request.textQuery,
        }),
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-FieldMask':
            request.detail === 'evidence'
              ? GOOGLE_TEXT_SEARCH_EVIDENCE_FIELD_MASK
              : GOOGLE_TEXT_SEARCH_FIELD_MASK,
        },
        method: 'POST',
      },
      {
        endpoint: '/v1/places:searchText',
        expectedSku:
          request.detail === 'evidence'
            ? 'places-text-search-enterprise'
            : 'places-text-search-pro',
        detailLevel: request.detail,
        operation: 'textSearch',
        cacheMissReason: request.cacheMissReason,
      },
    );

    return (response.places ?? []).flatMap((place): ProviderPlaceSearchResult[] => {
      const identity = mapPlaceIdentity(place);
      if (!identity) return [];
      return [
        {
          ...identity,
          ...(request.detail === 'evidence'
            ? {
                evidence: {
                  openingPeriods: mapOpeningPeriods(place.regularOpeningHours?.periods),
                  rating:
                    typeof place.rating === 'number' && Number.isFinite(place.rating)
                      ? place.rating
                      : null,
                },
              }
            : {}),
        },
      ];
    });
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

    const fieldMask = PLACE_DETAIL_FIELD_MASKS[request.detail];
    const response = await this.requestJson<GooglePlaceDetails>(
      url,
      { headers: { 'X-Goog-FieldMask': fieldMask }, method: 'GET' },
      {
        cacheMissReason: request.cacheMissReason,
        detailLevel: request.detail,
        endpoint: '/v1/places/:placeId',
        expectedSku:
          request.detail === 'location' ? 'place-details-pro' : 'place-details-enterprise',
        operation: 'getDetails',
        placeFingerprint: providerTargetFingerprint(request.externalPlaceId),
      },
    );
    const externalPlaceId = cleanString(response.id);
    // A named venue always gets a displayName, but a plain geocoded address
    // (a friend's house, a street corner) often doesn't — its formatted
    // address is the only identifying text Google returns for it, and is a
    // perfectly usable name rather than a reason to treat the place as
    // unresolvable.
    const name = cleanString(response.displayName?.text) ?? cleanString(response.formattedAddress);

    // Evidence requests deliberately omit display fields. Their absence must
    // not discard the hours/rating answer or require a more expensive mask.
    if (!externalPlaceId || (!name && request.detail === 'location')) {
      throw new PlaceProviderError('provider_unavailable');
    }

    const rawTypes = cleanStringList(response.types);
    const primaryType = cleanString(response.primaryType);
    const latitude = response.location?.latitude;
    const longitude = response.location?.longitude;
    const hasLocation = typeof latitude === 'number' && typeof longitude === 'number';

    const openingPeriods = mapOpeningPeriods(response.regularOpeningHours?.periods);

    return {
      attributions: mapAttributions(response.attributions),
      category: categorizePlaceTypes(rawTypes, primaryType),
      externalPlaceId,
      formattedAddress: cleanString(response.formattedAddress),
      googleMapsUri: cleanString(response.googleMapsUri),
      location: hasLocation ? { latitude, longitude } : null,
      name: name ?? '',
      openingPeriods,
      primaryType,
      provider: 'google',
      rating: typeof response.rating === 'number' ? response.rating : null,
      rawTypes,
      utcOffsetMinutes:
        typeof response.utcOffsetMinutes === 'number' ? response.utcOffsetMinutes : null,
    };
  }
}
