import { getPrismaClient } from '@trove/db';

import { categorizePlaceTypes } from './place-categories.js';
import { normalizePlaceLanguageCode } from './place-language.js';
import {
  PlacesService,
  type PlaceDetailsRequest,
  type PlaceDetailsResult,
  type PlacesProvider,
  type ProviderPlaceDetails,
} from './places.js';

/**
 * Google's terms allow place content to be cached for up to 30 consecutive
 * days, so that is the ceiling rather than a tuning knob.
 */
export const PLACE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

/**
 * A `full` answer cannot be persisted because it carries ratings and opening
 * hours, but the same trip place is often asked for several times inside one
 * burst of work. Short enough that nobody acts on stale hours, long enough to
 * absorb a Plan Score recomputation.
 */
const FULL_DETAILS_MEMO_TTL_MS = 5 * 60 * 1_000;
const FULL_DETAILS_MEMO_LIMIT = 500;

type MemoEntry = { expiresAt: number; result: PlaceDetailsResult };

/**
 * Module level, not instance level. The service is constructed per request in
 * several call paths, so instance state would be discarded before it was ever
 * read a second time. Keeping the memo here means that construction pattern
 * stops mattering instead of becoming a trap for the next caller.
 */
const fullDetailsMemo = new Map<string, MemoEntry>();

/** Test seam: the memo outlives any one service instance by design. */
export function resetCachedPlacesMemo() {
  fullDetailsMemo.clear();
}

function memoKey(request: PlaceDetailsRequest) {
  return [
    request.externalPlaceId,
    request.detail ?? 'full',
    normalizePlaceLanguageCode(request.languageCode),
    request.regionCode ?? '',
  ].join(' ');
}

/**
 * A snapshot only answers a request asking for the same language: a display
 * name is language-specific, and serving an English name to a request that
 * asked for Japanese would be a silent wrong answer rather than a stale one.
 *
 * Both sides are normalised first, so a caller that named no language and one
 * that asked for `en` read the same snapshot instead of invalidating it.
 */
function matchesLanguage(cached: string | null, requested: string | undefined) {
  return normalizePlaceLanguageCode(cached) === normalizePlaceLanguageCode(requested);
}

export class CachedPlacesService extends PlacesService {
  private readonly providerName: PlacesProvider['name'];
  private readonly now: () => Date;

  constructor(
    provider: PlacesProvider,
    clock: () => Date = () => new Date(),
    logger?: ConstructorParameters<typeof PlacesService>[2],
  ) {
    super(provider, clock, logger);
    this.providerName = provider.name;
    this.now = clock;
  }

  override async getDetails(request: PlaceDetailsRequest): Promise<PlaceDetailsResult> {
    if (request.detail === 'location') {
      const cached = await this.readSnapshot(request);
      if (cached) return cached;
    } else {
      const memoized = this.readMemo(request);
      if (memoized) return memoized;
    }

    const result = await super.getDetails(request);

    if (result.status === 'ok') {
      await this.writeSnapshot(result.place, request.languageCode);
      if (request.detail !== 'location') this.writeMemo(request, result);
    }

    return result;
  }

  private readMemo(request: PlaceDetailsRequest): PlaceDetailsResult | null {
    const key = memoKey(request);
    const entry = fullDetailsMemo.get(key);
    if (!entry) return null;

    if (entry.expiresAt <= this.now().getTime()) {
      fullDetailsMemo.delete(key);
      return null;
    }

    return entry.result;
  }

  private writeMemo(request: PlaceDetailsRequest, result: PlaceDetailsResult) {
    if (fullDetailsMemo.size >= FULL_DETAILS_MEMO_LIMIT) {
      // Insertion-ordered, so the first key is the oldest.
      const oldest = fullDetailsMemo.keys().next();
      if (!oldest.done) fullDetailsMemo.delete(oldest.value);
    }

    fullDetailsMemo.set(memoKey(request), {
      expiresAt: this.now().getTime() + FULL_DETAILS_MEMO_TTL_MS,
      result,
    });
  }

  private async readSnapshot(request: PlaceDetailsRequest): Promise<PlaceDetailsResult | null> {
    let reference;

    try {
      reference = await getPrismaClient().placeProviderRef.findUnique({
        where: {
          provider_externalPlaceId: {
            externalPlaceId: request.externalPlaceId,
            provider: 'GOOGLE',
          },
        },
      });
    } catch {
      // A cache that cannot be read is a slow path, never a failed request.
      return null;
    }

    if (
      !reference?.cachedAt ||
      !reference.cachedName ||
      reference.cachedLatitude === null ||
      reference.cachedLongitude === null ||
      !matchesLanguage(reference.cachedLanguageCode, request.languageCode) ||
      this.now().getTime() - reference.cachedAt.getTime() > PLACE_CACHE_TTL_MS
    ) {
      return null;
    }

    const rawTypes = reference.cachedTypes;
    // Derived rather than stored, so a change to the categorisation rules takes
    // effect immediately instead of waiting for every snapshot to expire.
    const category = categorizePlaceTypes(rawTypes, reference.cachedPrimaryType);

    return {
      freshness: { fetchedAt: reference.cachedAt.toISOString(), source: 'cache' },
      place: {
        category,
        externalPlaceId: request.externalPlaceId,
        formattedAddress: reference.cachedFormattedAddress,
        googleMapsUri: reference.cachedGoogleMapsUri,
        location: {
          latitude: reference.cachedLatitude.toNumber(),
          longitude: reference.cachedLongitude.toNumber(),
        },
        name: reference.cachedName,
        // Everything below is mutable provider data. A `location` request never
        // asks the provider for it either, so a hit and a miss agree.
        nationalPhoneNumber: null,
        openingPeriods: [],
        photos: [],
        primaryType: reference.cachedPrimaryType,
        provider: this.providerName,
        rating: null,
        rawTypes,
        regularOpeningHours: [],
        userRatingCount: null,
        utcOffsetMinutes: reference.cachedUtcOffsetMinutes,
        websiteUri: null,
      },
      provider: this.providerName,
      status: 'ok',
    };
  }

  private async writeSnapshot(place: ProviderPlaceDetails, languageCode: string | undefined) {
    if (!place.location) return;

    try {
      // `updateMany` because a place may be looked up before Trove has ever
      // created a reference for it; there is then simply nothing to cache into.
      await getPrismaClient().placeProviderRef.updateMany({
        where: { externalPlaceId: place.externalPlaceId, provider: 'GOOGLE' },
        data: {
          cachedAt: this.now(),
          cachedFormattedAddress: place.formattedAddress,
          cachedGoogleMapsUri: place.googleMapsUri,
          cachedLanguageCode: normalizePlaceLanguageCode(languageCode),
          cachedLatitude: place.location.latitude,
          cachedLongitude: place.location.longitude,
          cachedName: place.name,
          cachedPrimaryType: place.primaryType,
          cachedTypes: place.rawTypes,
          cachedUtcOffsetMinutes: place.utcOffsetMinutes,
        },
      });
    } catch {
      // Failing to cache must never fail the request that produced the data.
    }
  }
}
