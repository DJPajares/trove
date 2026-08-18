import { getPrismaClient } from '@trove/db';

import { PLACE_CACHE_TTL_MS } from './cached-places.js';
import { mapWithConcurrency, PROVIDER_CONCURRENCY_LIMIT } from './concurrency.js';
import { categorizePlaceTypes } from './place-categories.js';
import { normalizePlaceLanguageCode } from './place-language.js';
import { createPlacesService } from './places-runtime.js';
import type {
  PlaceCoordinates,
  PlacesService,
  ProviderPlaceDetails,
  TrovePlaceCategory,
} from './places.js';

/**
 * How many missing or expired snapshots one request will refresh before serving
 * the rest from what the database already holds.
 *
 * A trip whose places all predate snapshotting would otherwise turn a single
 * screen load into one provider request per place. The remainder is not
 * dropped: it is served stale and refreshed by the next request, so a large
 * trip drains over a few loads instead of arriving as one bill.
 */
export const MAX_INLINE_PLACE_HYDRATIONS = 25;

/**
 * How long a Place the provider could not answer for is left alone.
 *
 * Some references can never resolve — a geocoded address id Google will not
 * return details for, a Place that has since been removed. Without this, every
 * screen load retries it forever, which is the per-navigation bill this whole
 * approach exists to remove, just for one stubborn Place instead of all of
 * them. Short enough that a real outage heals on its own.
 */
const FAILED_HYDRATION_TTL_MS = 10 * 60 * 1_000;

/**
 * Module level, like the evidence memo: the service is constructed per request
 * in several paths, so instance state would never be read a second time.
 */
const failedHydrations = new Map<string, number>();
const MAX_TRACKED_FAILURES = 500;

/** Test seam: the backoff outlives any one request by design. */
export function resetFailedPlaceHydrations() {
  failedHydrations.clear();
}

function backoffKey(externalPlaceId: string, languageCode: string) {
  return `${externalPlaceId} ${languageCode}`;
}

/**
 * The durable half of a provider's answer as the app renders it. Everything
 * here is what Google's terms permit storing for 30 days; the mutable half —
 * rating, review count, opening hours, photos, phone, website — is deliberately
 * absent and is never persisted (PRD 11.4).
 */
export type PlaceSnapshot = {
  address: string | null;
  category: TrovePlaceCategory;
  /** When the provider actually answered, so the client can date what it shows. */
  fetchedAt: string;
  googleMapsUri: string | null;
  languageCode: string;
  name: string | null;
  primaryType: string | null;
  rawTypes: string[];
  /** Past the 30-day ceiling and the refresh could not be made. */
  stale: boolean;
  utcOffsetMinutes: number | null;
};

/**
 * The snapshot columns of a `PlaceProviderRef`. Structural rather than the
 * Prisma type so a caller may pass a database row, a record whose coordinates
 * have already been converted to numbers, or a test fixture.
 */
export type PlaceSnapshotSource = {
  cachedAt?: Date | null;
  cachedFormattedAddress?: string | null;
  cachedGoogleMapsUri?: string | null;
  cachedLanguageCode?: string | null;
  cachedLatitude?: DecimalLike | null;
  cachedLongitude?: DecimalLike | null;
  cachedName?: string | null;
  cachedPrimaryType?: string | null;
  cachedTypes?: string[];
  cachedUtcOffsetMinutes?: number | null;
  externalPlaceId: string;
};

type DecimalLike = number | { toNumber(): number };

export type PlaceHydrationOptions = {
  languageCode?: string;
  /** Test seam. Production omits it and gets the configured service. */
  now?: Date;
  /** Test seam. `null` stands for "no provider configured". */
  placesService?: PlacesService | null;
};

function toNumber(value: DecimalLike | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'number' ? value : value.toNumber();
}

/** The coordinates a map pin and a routed leg need, or null if never resolved. */
export function toPlaceCoordinates(
  reference: PlaceSnapshotSource | null | undefined,
): PlaceCoordinates | null {
  if (!reference) return null;

  const latitude = toNumber(reference.cachedLatitude);
  const longitude = toNumber(reference.cachedLongitude);
  if (latitude === null || longitude === null) return null;

  return { latitude, longitude };
}

/**
 * Pure: no database, no provider. Every serializer calls this, which is what
 * makes rendering a place cost nothing.
 */
export function toPlaceSnapshot(
  reference: PlaceSnapshotSource | null | undefined,
  now: Date = new Date(),
): PlaceSnapshot | null {
  if (!reference?.cachedAt || !reference.cachedName) return null;

  return {
    address: reference.cachedFormattedAddress ?? null,
    // Derived rather than stored, so a change to the categorisation rules takes
    // effect immediately instead of waiting for every snapshot to expire.
    category: categorizePlaceTypes(reference.cachedTypes ?? [], reference.cachedPrimaryType),
    fetchedAt: reference.cachedAt.toISOString(),
    googleMapsUri: reference.cachedGoogleMapsUri ?? null,
    languageCode: normalizePlaceLanguageCode(reference.cachedLanguageCode),
    name: reference.cachedName,
    primaryType: reference.cachedPrimaryType ?? null,
    rawTypes: reference.cachedTypes ?? [],
    stale: now.getTime() - reference.cachedAt.getTime() > PLACE_CACHE_TTL_MS,
    utcOffsetMinutes: reference.cachedUtcOffsetMinutes ?? null,
  };
}

/**
 * Whether this reference can answer for itself without asking the provider.
 * Coordinates count: a snapshot that cannot place a pin is not one a map or a
 * travel leg can use.
 */
export function isSnapshotFresh(
  reference: PlaceSnapshotSource,
  options: { languageCode?: string; now?: Date } = {},
): boolean {
  const now = options.now ?? new Date();

  return (
    Boolean(reference.cachedAt) &&
    Boolean(reference.cachedName) &&
    toPlaceCoordinates(reference) !== null &&
    normalizePlaceLanguageCode(reference.cachedLanguageCode) ===
      normalizePlaceLanguageCode(options.languageCode) &&
    now.getTime() - (reference.cachedAt?.getTime() ?? 0) <= PLACE_CACHE_TTL_MS
  );
}

function toSnapshotSource(
  place: ProviderPlaceDetails,
  languageCode: string,
  cachedAt: Date,
): PlaceSnapshotSource {
  return {
    cachedAt,
    cachedFormattedAddress: place.formattedAddress,
    cachedGoogleMapsUri: place.googleMapsUri,
    cachedLanguageCode: languageCode,
    cachedLatitude: place.location?.latitude ?? null,
    cachedLongitude: place.location?.longitude ?? null,
    cachedName: place.name,
    cachedPrimaryType: place.primaryType,
    cachedTypes: place.rawTypes,
    cachedUtcOffsetMinutes: place.utcOffsetMinutes,
    externalPlaceId: place.externalPlaceId,
  };
}

/**
 * The one entry point in the codebase permitted to cause a Google Place Details
 * call. Everything else reads what this has already written.
 *
 * Reads every requested reference in one query, returns the ones that can
 * answer for themselves untouched, and asks the provider only about those that
 * have never been resolved or have passed the 30-day ceiling.
 *
 * Never rejects. A provider that is missing, disabled or failing degrades to
 * whatever the database already holds, because a place Trove has seen before
 * should still render when Google cannot be reached.
 */
export async function hydratePlaceSnapshots(
  externalPlaceIds: readonly string[],
  options: PlaceHydrationOptions = {},
): Promise<Map<string, PlaceSnapshotSource>> {
  const resolved = new Map<string, PlaceSnapshotSource>();
  const ids = [...new Set(externalPlaceIds.filter(Boolean))];
  if (!ids.length) return resolved;

  const languageCode = normalizePlaceLanguageCode(options.languageCode);
  const now = options.now ?? new Date();

  let references: PlaceSnapshotSource[];
  try {
    // One query for N places, so a screen's cost does not grow with its length.
    references = await getPrismaClient().placeProviderRef.findMany({
      where: { externalPlaceId: { in: ids }, provider: 'GOOGLE' },
    });
  } catch {
    // A cache that cannot be read is a slow path, never a failed request.
    return resolved;
  }

  const expired: string[] = [];
  for (const reference of references) {
    resolved.set(reference.externalPlaceId, reference);
    if (!isSnapshotFresh(reference, { languageCode, now })) {
      expired.push(reference.externalPlaceId);
    }
  }

  // Only references that already exist are refreshed. A place with no reference
  // row has nowhere to be stored, so asking about it would buy an answer that
  // `writeSnapshot` would immediately discard.
  const refreshing = expired
    .filter((externalPlaceId) => {
      const retryAfter = failedHydrations.get(backoffKey(externalPlaceId, languageCode));
      if (retryAfter === undefined) return true;
      if (retryAfter > now.getTime()) return false;
      failedHydrations.delete(backoffKey(externalPlaceId, languageCode));
      return true;
    })
    .slice(0, MAX_INLINE_PLACE_HYDRATIONS);
  if (!refreshing.length) return resolved;

  const placesService =
    options.placesService === undefined ? createPlacesService() : options.placesService;
  if (!placesService) return resolved;

  await mapWithConcurrency(refreshing, PROVIDER_CONCURRENCY_LIMIT, async (externalPlaceId) => {
    try {
      const result = await placesService.getDetails({
        detail: 'location',
        externalPlaceId,
        languageCode,
      });

      if (result.status !== 'ok' || !result.place.location) {
        rememberFailure(externalPlaceId, languageCode, now);
        return;
      }

      // `CachedPlacesService` has already written this to the database; the
      // in-memory copy exists so the request that paid for it can serve it.
      resolved.set(externalPlaceId, toSnapshotSource(result.place, languageCode, now));
    } catch {
      // One unreachable place must never blank out an entire itinerary.
      rememberFailure(externalPlaceId, languageCode, now);
    }
  });

  return resolved;
}

function rememberFailure(externalPlaceId: string, languageCode: string, now: Date) {
  if (failedHydrations.size >= MAX_TRACKED_FAILURES) {
    // Insertion-ordered, so the first key is the oldest.
    const oldest = failedHydrations.keys().next();
    if (!oldest.done) failedHydrations.delete(oldest.value);
  }

  failedHydrations.set(
    backoffKey(externalPlaceId, languageCode),
    now.getTime() + FAILED_HYDRATION_TTL_MS,
  );
}

/** The single-place form, for the moment a Place is first added to Trove. */
export async function hydratePlaceSnapshot(
  externalPlaceId: string,
  options: PlaceHydrationOptions = {},
): Promise<PlaceSnapshotSource | null> {
  const resolved = await hydratePlaceSnapshots([externalPlaceId], options);
  return resolved.get(externalPlaceId) ?? null;
}
