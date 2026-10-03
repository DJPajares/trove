import {
  readCachedPlaceEvidence,
  storePlaceEvidence,
  storePlacePhotoUri,
  PLACE_EVIDENCE_TTL_MS,
} from './place-evidence-cache.js';
import { singleFlight } from './single-flight.js';
import { getPrismaClient } from '@trove/db';

import { timeZoneAtCoordinates } from './coordinate-time-zone.js';
import { PLACE_PHOTO_MAX_WIDTH_PX } from './google-places.js';
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
  type PlacePhoto,
  placePhotoId,
  type PlacePhotoRequest,
  type PlacePhotoResult,
  type PlacesProvider,
  type ProviderPlaceDetails,
} from './places.js';

/**
 * The accepted application snapshot ceiling is 30 days. This does not
 * establish blanket provider permissions.
 */
export const PLACE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

/** Operation-local fallback also preserves the bounded snapshot's original deadline. */
const EVIDENCE_MEMO_TTL_MS = PLACE_EVIDENCE_TTL_MS;
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

/** Reuse and persist selected Text Search evidence without another Details request. */
export async function rememberPlaceEvidence(
  request: Omit<PlaceDetailsRequest, 'detail'>,
  result: Extract<PlaceDetailsResult, { status: 'ok' }>,
) {
  const fetchedAt = Date.parse(result.freshness.fetchedAt);
  if (!Number.isFinite(fetchedAt) || result.place.externalPlaceId !== request.externalPlaceId)
    return;
  const key = memoKey({ ...request, detail: 'evidence' });
  const expiresAt = fetchedAt + EVIDENCE_MEMO_TTL_MS;
  // Reusing or re-seeding an older answer must never slide its lifetime.
  if ((evidenceMemo.get(key)?.expiresAt ?? -Infinity) > expiresAt) return;
  const previous = evidenceMemo.get(key)?.result;
  if (previous?.status === 'ok' && previous.freshness.fetchedAt === result.freshness.fetchedAt) {
    const photos =
      result.place.photos?.map((photo) => {
        const known = previous.place.photos?.find((item) => item.name === photo.name);
        return known?.uri ? { ...photo, uri: known.uri } : photo;
      }) ?? previous.place.photos;
    result = { ...result, place: { ...previous.place, ...result.place, photos } };
  }
  if (evidenceMemo.size >= EVIDENCE_MEMO_LIMIT && !evidenceMemo.has(key)) {
    const oldest = evidenceMemo.keys().next();
    if (!oldest.done) evidenceMemo.delete(oldest.value);
  }
  evidenceMemo.set(key, { expiresAt, result });
  await storePlaceEvidence(request, result);
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

/**
 * Whether a stored answer can serve what this caller came for. An itinerary
 * explicit selection or opened sheet requires the app's complete rich field
 * mask. Empty/null answers are complete; absent fields in legacy evidence are not.
 */
function answersPurpose(request: PlaceDetailsRequest, result: PlaceDetailsResult) {
  if (request.purpose) {
    return (
      result.status === 'ok' &&
      (request.purpose === 'details' || Boolean(result.place.name && result.place.location)) &&
      result.place.photos !== undefined &&
      result.place.websiteUri !== undefined &&
      result.place.internationalPhoneNumber !== undefined &&
      result.place.priceLevel !== undefined
    );
  }
  return true;
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
      const stored = await readCachedPlaceEvidence(request, this.now());
      const memoized = stored ? { kind: 'hit' as const, result: stored } : this.readMemo(request);
      if (memoized.kind === 'hit' && answersPurpose(request, memoized.result)) {
        this.recordHit(request, 'place-evidence');
        return this.withCoverPhoto(request, memoized.result);
      }
      cacheMissReason = memoized.kind === 'hit' ? 'incomplete_snapshot' : memoized.reason;
    }

    const result = await this.acquire(request, cacheMissReason);
    return this.withCoverPhoto(request, result);
  }

  private acquire(
    request: PlaceDetailsRequest,
    cacheMissReason: ProviderCacheMissReason,
  ): Promise<PlaceDetailsResult> {
    return singleFlight(`place:${memoKey(request)}`, async (): Promise<PlaceDetailsResult> => {
      const result = await super.getDetails({ ...request, cacheMissReason });

      if (result.status === 'ok') {
        if (request.detail === 'location') {
          if (!result.place.location) {
            await this.writeFailure(request.externalPlaceId, 'UNUSABLE_LOCATION');
            return { provider: this.providerName, reason: 'unusable_location', status: 'empty' };
          }
          await this.writeSnapshot(result.place, request.externalPlaceId, request.languageCode);
        } else {
          await rememberPlaceEvidence(request, result);
          await this.writeSnapshot(
            result.place,
            request.externalPlaceId,
            request.languageCode,
            new Date(result.freshness.fetchedAt),
          );
        }
      } else if (request.detail === 'location' && result.status === 'empty') {
        await this.writeFailure(request.externalPlaceId, 'NOT_FOUND');
      }

      return result;
    });
  }

  /** Resolve only the cover on opening; the other slots require explicit selection. */
  private async withCoverPhoto(
    request: PlaceDetailsRequest,
    result: PlaceDetailsResult,
  ): Promise<PlaceDetailsResult> {
    if (request.purpose !== 'details' || result.status !== 'ok') return result;
    const cover = result.place.photos?.[0];
    if (!cover || cover.uri !== null) return result;
    const media = await this.getPhoto({
      externalPlaceId: request.externalPlaceId,
      languageCode: request.languageCode,
      regionCode: request.regionCode,
      signal: request.signal,
      evidenceFetchedAt: result.freshness.fetchedAt,
      photoId: placePhotoId(cover.name),
    });
    const latest = this.readMemo({ ...request, detail: 'evidence' });
    const answer =
      latest.kind === 'hit' &&
      latest.result.status === 'ok' &&
      latest.result.freshness.fetchedAt === result.freshness.fetchedAt
        ? latest.result
        : result;
    return media.status === 'ok'
      ? {
          ...answer,
          place: {
            ...answer.place,
            photos: answer.place.photos?.map((photo) =>
              photo.name === cover.name ? { ...photo, uri: media.uri } : photo,
            ),
          },
        }
      : answer;
  }

  override async getPhoto(request: PlacePhotoRequest): Promise<PlacePhotoResult> {
    const key = memoKey({ ...request, detail: 'evidence' });
    return singleFlight(
      `place-photo:${key}:${request.evidenceFetchedAt}:${request.photoId}`,
      async () => {
        const stored = await readCachedPlaceEvidence(request, this.now());
        const memo = this.readMemo({ ...request, detail: 'evidence' });
        const result = stored ?? (memo.kind === 'hit' ? memo.result : null);
        if (
          !result ||
          result.status !== 'ok' ||
          result.freshness.fetchedAt !== request.evidenceFetchedAt
        )
          return { status: 'stale' };
        const photo = result.place.photos?.find(
          (item) => placePhotoId(item.name) === request.photoId,
        );
        if (!photo) return { status: 'not_found' };
        const memoPhoto =
          memo.kind === 'hit' &&
          memo.result.status === 'ok' &&
          memo.result.freshness.fetchedAt === result.freshness.fetchedAt
            ? memo.result.place.photos?.find((item) => item.name === photo.name)
            : null;
        const knownUri = photo.uri ?? memoPhoto?.uri;
        if (knownUri) return { status: 'ok', uri: knownUri };
        const media = await this.resolvePhotoMedia({
          maxWidthPx: PLACE_PHOTO_MAX_WIDTH_PX,
          name: photo.name,
          signal: request.signal,
        });
        if (media.status !== 'ok') return media;
        const persisted = await storePlacePhotoUri(
          request,
          request.evidenceFetchedAt,
          photo.name,
          media.uri,
        );
        const current = evidenceMemo.get(key)?.result;
        const base =
          current?.status === 'ok' && current.freshness.fetchedAt === result.freshness.fetchedAt
            ? current
            : result;
        // A narrow database update merges concurrent resolutions. On database
        // failure the module memo still preserves every photo acquired here.
        const next = {
          ...base,
          place: persisted ?? {
            ...base.place,
            photos: base.place.photos?.map((item): PlacePhoto =>
              item.name === photo.name ? { ...item, uri: media.uri } : item,
            ),
          },
        };
        if (
          !current ||
          current.status !== 'ok' ||
          Date.parse(current.freshness.fetchedAt) <= Date.parse(next.freshness.fetchedAt)
        ) {
          evidenceMemo.set(key, {
            expiresAt: Date.parse(next.freshness.fetchedAt) + EVIDENCE_MEMO_TTL_MS,
            result: next,
          });
        }
        return media;
      },
    );
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
          // A `location` answer never carries hours or a rating: the snapshot does
          // not hold them and the request does not ask for them, so a hit and a
          // miss agree. Rich evidence has its own bounded, dated 30-day copy
          // (`place-evidence-cache.ts`) that only `evidence` requests read.
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
    fetchedAt = this.now(),
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
        where: {
          externalPlaceId: requestedExternalPlaceId,
          provider: 'GOOGLE',
          OR: [{ cachedAt: null }, { cachedAt: { lte: fetchedAt } }],
        },
        data: {
          cachedAt: fetchedAt,
          cachedFormattedAddress: place.formattedAddress,
          cachedGoogleMapsUri: place.googleMapsUri,
          cachedLanguageCode: normalizePlaceLanguageCode(languageCode),
          cachedLatitude: place.location.latitude,
          cachedLongitude: place.location.longitude,
          cachedName: place.name,
          cachedPrimaryType: place.primaryType,
          cachedTypes: place.rawTypes,
          cachedTimeZone: timeZoneAtCoordinates(place.location),
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
