import { getPlacesEnvironment } from '../environment.js';
import { normalizeIdentityText } from './ai-place-grounding.js';
import { GooglePlacesProvider } from './google-places.js';
import { normalizePlaceLanguageCode } from './place-language.js';
import {
  PlaceProviderError,
  type PlaceProviderName,
  type PlaceTextSearchProvider,
  type PlacesUnavailableCode,
} from './places.js';
import type { ProviderCallSource } from './provider-usage.js';

/**
 * How long the same lookup is answered from memory rather than from Google.
 *
 * A traveller repairing a place types, looks, adjusts the wording and looks
 * again, and the same wording twice must not be bought twice. Short enough that
 * a place added to Google today is findable today; long enough to cover one
 * sitting with a dialog open.
 */
const CANDIDATES_MEMO_TTL_MS = 5 * 60 * 1_000;
const CANDIDATES_MEMO_LIMIT = 500;

/**
 * Module level, like the evidence memo in `cached-places`: the service is built
 * per request, so instance state would be discarded before it was ever read a
 * second time.
 */
const candidatesMemo = new Map<string, { expiresAt: number; result: PlaceLocationCandidates }>();

/** Test seam: the memo outlives any one service instance by design. */
export function resetPlaceLocationCandidatesMemo() {
  candidatesMemo.clear();
}

/**
 * Where a Custom Place might be, as the traveller has to choose between them.
 *
 * Identity and coordinates only. The mutable half — rating, hours, photos — is
 * never fetched and never handed on (PRD 11.4); nothing on this surface renders
 * it, and asking for it would move the request onto a costlier Google tier.
 */
export type PlaceLocationCandidate = {
  address: string | null;
  externalPlaceId: string;
  latitude: number;
  longitude: number;
  name: string;
};

export type PlaceLocationCandidatesRequest = {
  languageCode?: string;
  regionCode?: string;
  textQuery: string;
};

export type PlaceLocationCandidates =
  | {
      candidates: PlaceLocationCandidate[];
      provider: PlaceProviderName;
      status: 'empty' | 'ok';
    }
  | {
      code: PlacesUnavailableCode;
      provider: PlaceProviderName;
      status: 'unavailable';
    };

function memoKey(request: PlaceLocationCandidatesRequest) {
  return [
    normalizeIdentityText(request.textQuery),
    normalizePlaceLanguageCode(request.languageCode),
    request.regionCode?.trim().toLowerCase() ?? '',
  ].join(' ');
}

function remember(key: string, expiresAt: number, result: PlaceLocationCandidates) {
  if (candidatesMemo.size >= CANDIDATES_MEMO_LIMIT && !candidatesMemo.has(key)) {
    // Insertion-ordered, so the first key is the oldest.
    const oldest = candidatesMemo.keys().next();
    if (!oldest.done) candidatesMemo.delete(oldest.value);
  }
  candidatesMemo.set(key, { expiresAt, result });
}

/**
 * One Text Search, for one Place a traveller asked about.
 *
 * A place that arrived without coordinates has no provider reference to refresh,
 * so Place Details has nothing to be called with. Text Search is the one request
 * that turns a name into an identity, and it is billed per request rather than
 * per result: a page of five candidates costs exactly what a single answer would,
 * which is what makes showing the traveller the ambiguity free.
 *
 * `detail: 'location'` is not a default worth changing. `evidence` adds ratings
 * and opening hours, moves the request to the Enterprise SKU, and nothing here
 * would render either.
 */
export class PlaceLocationCandidatesService {
  constructor(
    private readonly provider: PlaceTextSearchProvider,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async find(request: PlaceLocationCandidatesRequest): Promise<PlaceLocationCandidates> {
    const key = memoKey(request);
    const now = this.clock().getTime();
    const memoized = candidatesMemo.get(key);
    if (memoized) {
      if (memoized.expiresAt > now) return memoized.result;
      candidatesMemo.delete(key);
    }

    let result: PlaceLocationCandidates;
    try {
      const identities = await this.provider.textSearch({
        detail: 'location',
        languageCode: request.languageCode,
        regionCode: request.regionCode,
        textQuery: request.textQuery,
      });
      const candidates = identities.map((identity) => ({
        address: identity.formattedAddress,
        externalPlaceId: identity.externalPlaceId,
        latitude: identity.location.latitude,
        longitude: identity.location.longitude,
        name: identity.name,
      }));
      result = {
        candidates,
        provider: this.provider.name,
        status: candidates.length === 0 ? ('empty' as const) : ('ok' as const),
      };
    } catch (error) {
      const code =
        error instanceof PlaceProviderError && error.code !== 'not_found'
          ? error.code
          : ('provider_unavailable' as const);
      result = { code, provider: this.provider.name, status: 'unavailable' };
    }

    // A failure is remembered too. Repeating a lookup Google has just refused is
    // how a repair path quietly bills for the same nothing several times over.
    remember(key, now + CANDIDATES_MEMO_TTL_MS, result);
    return result;
  }
}

/** Null when the kill switch is on or no key is configured, exactly like `createPlacesService`. */
export function createPlaceLocationCandidatesService(
  options: {
    environment?: Record<string, string | undefined>;
    source?: ProviderCallSource;
  } = {},
) {
  const placesEnvironment = getPlacesEnvironment(options.environment ?? process.env);
  if (!placesEnvironment) return null;

  return new PlaceLocationCandidatesService(
    new GooglePlacesProvider({
      apiKey: placesEnvironment.googlePlacesApiKey,
      source: options.source ?? 'place-locate',
    }),
  );
}
