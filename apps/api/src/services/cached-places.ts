import { getPrismaClient } from '@trove/db';

import { categorizePlaceTypes } from './place-categories.js';
import {
  getActivePlaceDetailsFailure,
  type PlaceDetailsFailureCode,
} from './place-details-failures.js';
import { normalizePlaceLanguageCode } from './place-language.js';
import {
  providerTargetFingerprint,
  recordProviderCacheEvent,
  type ProviderCacheMissReason,
  type ProviderCallSource,
} from './provider-usage.js';
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
 * An `evidence` answer cannot be persisted because it carries ratings and
 * opening hours, but the same trip place is often asked for several times
 * inside one burst of work. Short enough that nobody acts on stale hours, long
 * enough to absorb a Plan Score recomputation.
 */
const EVIDENCE_MEMO_TTL_MS = 5 * 60 * 1_000;
const EVIDENCE_MEMO_LIMIT = 500;

type MemoEntry = { expiresAt: number; result: PlaceDetailsResult };
type CacheLookup =
  | { kind: 'hit'; result: PlaceDetailsResult }
  | { failureCode: PlaceDetailsFailureCode; kind: 'negative' }
  | { kind: 'miss'; reason: ProviderCacheMissReason };

/**
 * Module level, not instance level. The service is constructed per request in
 * several call paths, so instance state would be discarded before it was ever
 * read a second time. Keeping the memo here means that construction pattern
 * stops mattering instead of becoming a trap for the next caller.
 */
const evidenceMemo = new Map<string, MemoEntry>();

/** Test seam: the memo outlives any one service instance by design. */
export function resetCachedPlacesMemo() {
  evidenceMemo.clear();
}

function memoKey(request: PlaceDetailsRequest) {
  return [
    request.externalPlaceId,
    request.detail,
    normalizePlaceLanguageCode(request.languageCode),
    request.regionCode ?? '',
  ].join(' ');
}

/** Reuse selected Text Search evidence without a Details request or a snapshot write. */
export function rememberPlaceEvidence(
  request: Omit<PlaceDetailsRequest, 'detail'>,
  result: Extract<PlaceDetailsResult, { status: 'ok' }>,
) {
  const fetchedAt = Date.parse(result.freshness.fetchedAt);
  if (!Number.isFinite(fetchedAt) || result.place.externalPlaceId !== request.externalPlaceId)
    return;
  const key = memoKey({ ...request, detail: 'evidence' });
  const expiresAt = fetchedAt + EVIDENCE_MEMO_TTL_MS;
  // Reusing or re-seeding an older answer must never slide its lifetime.
  if ((evidenceMemo.get(key)?.expiresAt ?? -Infinity) >= expiresAt) return;
  if (evidenceMemo.size >= EVIDENCE_MEMO_LIMIT && !evidenceMemo.has(key)) {
    const oldest = evidenceMemo.keys().next();
    if (!oldest.done) evidenceMemo.delete(oldest.value);
  }
  evidenceMemo.set(key, { expiresAt, result });
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
  private readonly source: ProviderCallSource;

  constructor(
    provider: PlacesProvider,
    clock: () => Date = () => new Date(),
    logger?: ConstructorParameters<typeof PlacesService>[2],
    source: ProviderCallSource = 'test',
  ) {
    super(provider, clock, logger);
    this.providerName = provider.name;
    this.now = clock;
    this.source = source;
  }

  override async getDetails(request: PlaceDetailsRequest): Promise<PlaceDetailsResult> {
    let cacheMissReason: ProviderCacheMissReason;

    if (request.detail === 'location') {
      const cached = await this.readSnapshot(request);
      if (cached.kind === 'hit') {
        this.recordHit(request, 'place-details');
        return cached.result;
      }
      if (cached.kind === 'negative') {
        recordProviderCacheEvent({
          cache: 'place-details',
          failureCode: cached.failureCode,
          kind: 'negative_cache_hit',
          operation: 'getDetails',
          placeFingerprint: providerTargetFingerprint(request.externalPlaceId),
          provider: 'google',
          source: this.source,
        });
        return {
          provider: this.providerName,
          reason: cached.failureCode === 'NOT_FOUND' ? 'not_found' : 'unusable_location',
          status: 'empty',
        };
      }
      cacheMissReason = cached.reason;
    } else {
      const memoized = this.readMemo(request);
      if (memoized.kind === 'hit') {
        this.recordHit(request, 'place-evidence');
        return memoized.result;
      }
      cacheMissReason = memoized.reason;
    }

    const result = await super.getDetails({ ...request, cacheMissReason });

    if (result.status === 'ok') {
      if (request.detail === 'location') {
        if (!result.place.location) {
          await this.writeFailure(request.externalPlaceId, 'UNUSABLE_LOCATION');
          return { provider: this.providerName, reason: 'unusable_location', status: 'empty' };
        }
        await this.writeSnapshot(result.place, request.externalPlaceId, request.languageCode);
      } else {
        rememberPlaceEvidence(request, result);
      }
    } else if (request.detail === 'location' && result.status === 'empty') {
      await this.writeFailure(request.externalPlaceId, 'NOT_FOUND');
    }

    return result;
  }

  private recordHit(request: PlaceDetailsRequest, cache: 'place-details' | 'place-evidence') {
    recordProviderCacheEvent({
      cache,
      kind: 'cache_hit',
      operation: 'getDetails',
      placeFingerprint: providerTargetFingerprint(request.externalPlaceId),
      provider: 'google',
      source: this.source,
    });
  }

  private readMemo(request: PlaceDetailsRequest): Exclude<CacheLookup, { kind: 'negative' }> {
    const key = memoKey(request);
    const entry = evidenceMemo.get(key);
    if (!entry) return { kind: 'miss', reason: 'evidence_not_memoized' };

    if (entry.expiresAt <= this.now().getTime()) {
      evidenceMemo.delete(key);
      return { kind: 'miss', reason: 'evidence_memo_expired' };
    }

    return { kind: 'hit', result: entry.result };
  }

  private async readSnapshot(request: PlaceDetailsRequest): Promise<CacheLookup> {
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
      return { kind: 'miss', reason: 'cache_read_failed' };
    }

    const activeFailure = getActivePlaceDetailsFailure(reference, this.now());
    if (activeFailure) return { failureCode: activeFailure, kind: 'negative' };
    if (!reference?.cachedAt) {
      return {
        kind: 'miss',
        reason: reference?.detailsFailedAt ? 'negative_cache_expired' : 'missing_snapshot',
      };
    }
    if (
      !reference.cachedName ||
      reference.cachedLatitude === null ||
      reference.cachedLongitude === null
    ) {
      return { kind: 'miss', reason: 'incomplete_snapshot' };
    }
    if (!matchesLanguage(reference.cachedLanguageCode, request.languageCode)) {
      return { kind: 'miss', reason: 'language_mismatch' };
    }
    if (this.now().getTime() - reference.cachedAt.getTime() > PLACE_CACHE_TTL_MS) {
      return { kind: 'miss', reason: 'stale_snapshot' };
    }

    const rawTypes = reference.cachedTypes;
    // Derived rather than stored, so a change to the categorisation rules takes
    // effect immediately instead of waiting for every snapshot to expire.
    const category = categorizePlaceTypes(rawTypes, reference.cachedPrimaryType);

    return {
      kind: 'hit',
      result: {
        freshness: { fetchedAt: reference.cachedAt.toISOString(), source: 'cache' },
        place: {
          attributions: [],
          category,
          externalPlaceId: request.externalPlaceId,
          formattedAddress: reference.cachedFormattedAddress,
          googleMapsUri: reference.cachedGoogleMapsUri,
          location: {
            latitude: reference.cachedLatitude.toNumber(),
            longitude: reference.cachedLongitude.toNumber(),
          },
          name: reference.cachedName,
          // Mutable provider data is never stored, and a `location` request never
          // asks the provider for it either, so a hit and a miss agree.
          openingPeriods: [],
          primaryType: reference.cachedPrimaryType,
          provider: this.providerName,
          rating: null,
          rawTypes,
          utcOffsetMinutes: reference.cachedUtcOffsetMinutes,
        },
        provider: this.providerName,
        status: 'ok',
      },
    };
  }

  private async writeSnapshot(
    place: ProviderPlaceDetails,
    requestedExternalPlaceId: string,
    languageCode: string | undefined,
  ) {
    if (!place.location) return;

    try {
      // `updateMany` because a place may be looked up before Trove has ever
      // created a reference for it; there is then simply nothing to cache into.
      await getPrismaClient().placeProviderRef.updateMany({
        // Google may canonicalise an address-only identifier and return a
        // different id in the response. The snapshot belongs to the reference
        // Trove queried; matching the response id silently discarded it and
        // caused the original reference to be billed again on every read.
        where: { externalPlaceId: requestedExternalPlaceId, provider: 'GOOGLE' },
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
          detailsFailedAt: null,
          detailsFailureCode: null,
        },
      });
    } catch {
      // Failing to cache must never fail the request that produced the data.
    }
  }

  private async writeFailure(externalPlaceId: string, code: PlaceDetailsFailureCode) {
    try {
      await getPrismaClient().placeProviderRef.updateMany({
        where: { externalPlaceId, provider: 'GOOGLE' },
        data: { detailsFailedAt: this.now(), detailsFailureCode: code },
      });
    } catch {
      // A failed cache write falls back to the short process-local backoff.
    }
  }
}
