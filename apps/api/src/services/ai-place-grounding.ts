import { createHash } from 'node:crypto';

import type {
  AiPlannerCandidatePlace,
  AiPlannerDraftPlace,
  AiPlannerEvidence,
  AiPlannerWarning,
} from '@trove/types';

import { mapWithConcurrency, PROVIDER_CONCURRENCY_LIMIT } from './concurrency.js';
import {
  PrismaAiPlaceGroundingCacheRepository,
  type AiPlaceGroundingCacheRepository,
  type GroundingCacheWrite,
} from './ai-place-grounding-cache.js';
import { PLACE_CACHE_TTL_MS, rememberPlaceEvidence } from './cached-places.js';
import { isSnapshotFresh, toPlaceCoordinates } from './place-data.js';
import { getActivePlaceDetailsFailure } from './place-details-failures.js';
import {
  providerTargetFingerprint,
  recordProviderCacheEvent,
  type ProviderCacheMissReason,
} from './provider-usage.js';
import {
  PlaceProviderError,
  type PlaceDetailLevel,
  type PlaceDetailsResult,
  type PlaceLocationBias,
  type PlaceTextSearchProvider,
  type PlaceTextSearchRequest,
  type ProviderPlaceIdentity,
  type ProviderPlaceSearchResult,
} from './places.js';

import {
  geographicallyEligible,
  hasComparableLocalityMismatch,
  identityCompatible,
  identityTokens,
  localityMatches,
  nameMatchTier,
  normalizeIdentityText,
  rankPlaceMatches,
  sameIdentityName,
} from './place-identity-matching.js';
import { normalizePlaceLanguageCode } from './place-language.js';
import { recordAiPlanningTelemetry } from './ai-planning-telemetry.js';
export { normalizeIdentityText } from './place-identity-matching.js';

export type AiPlaceGroundingCandidate = AiPlannerCandidatePlace & {
  signal?: AbortSignal;
  requireExactName?: boolean;
  detail?: PlaceDetailLevel;
  languageCode?: string;
  localityHint?: string | null;
  destinationName?: string;
  countryCode?: string;
  contextConflict?: boolean;
  locationBias?: PlaceLocationBias;
  preferLodging?: boolean;
  regionCode?: string;
};

export type GroundedPlaceContext = {
  localityName?: string;
  countryCode?: string;
  evidence?: Extract<PlaceDetailsResult, { status: 'ok' }>;
  externalPlaceId: string;
  languageCode?: string;
  regionCode?: string;
  location: { latitude: number; longitude: number };
};

export type AiPlaceGroundingResult = {
  /** Internal only: evidence checks need this on cached and live resolutions. */
  context: GroundedPlaceContext | null;
  evidence: AiPlannerEvidence;
  place: AiPlannerDraftPlace;
  warnings: AiPlannerWarning[];
};

export type CanonicalIdentityResolver = {
  resolveProviderPlaceFromIdentity(
    identity: ProviderPlaceIdentity,
    options?: { fetchedAt?: Date; languageCode?: string },
  ): Promise<{ id: string }>;
};

function localizedTextQuery(searchQuery: string, localityHint?: string | null) {
  const locality = localityHint?.trim();
  if (!locality) return searchQuery;
  const tokens = identityTokens(locality.split(',')[0]!);
  const queryTokens = identityTokens(searchQuery);
  const shared = tokens.filter((token) =>
    queryTokens.some((other) => sameIdentityName(token, other)),
  );
  if (shared.length >= Math.ceil(tokens.length / 2) && shared.join('').length >= 4)
    return searchQuery;
  return `${searchQuery}, ${locality}`;
}

function memoKey(request: PlaceTextSearchRequest) {
  const bias = request.locationBias;
  return [
    normalizeIdentityText(request.textQuery),
    request.pageSize ?? 5,
    request.languageCode?.trim().toLowerCase() ?? '',
    request.regionCode?.trim().toUpperCase() ?? '',
    bias?.latitude ?? '',
    bias?.longitude ?? '',
    bias?.radiusMeters ?? '',
  ].join('|');
}

function searchRequest(candidate: AiPlaceGroundingCandidate): PlaceTextSearchRequest {
  return {
    detail: candidate.detail ?? 'location',
    pageSize: 20,
    signal: candidate.signal,
    languageCode: normalizePlaceLanguageCode(candidate.languageCode),
    locationBias: candidate.locationBias,
    regionCode: candidate.regionCode,
    textQuery: localizedTextQuery(
      candidate.searchName?.trim() || candidate.searchQuery,
      candidate.localityHint,
    ),
  };
}

function cacheKey(request: PlaceTextSearchRequest, candidate: AiPlaceGroundingCandidate) {
  // Bump the version if matching rules or the provider search page change.
  // The same query can have a different survivor for a different candidate
  // name or locality. A query-only key would incorrectly reuse that decision.
  return createHash('sha256')
    .update(
      JSON.stringify([
        'google:grounding:v7',
        memoKey(request),
        normalizeIdentityText(candidate.name),
        candidate.localityHint?.trim() ? normalizeIdentityText(candidate.localityHint) : null,
        candidate.requireExactName ?? false,
        candidate.searchName ? normalizeIdentityText(candidate.searchName) : null,
        candidate.countryCode?.toUpperCase() ?? null,
        candidate.contextConflict ?? false,
        candidate.destinationName ?? null,
        candidate.preferLodging ?? false,
      ]),
    )
    .digest('hex');
}

type GroundingIdentity = Pick<
  ProviderPlaceIdentity,
  'externalPlaceId' | 'formattedAddress' | 'location' | 'name' | 'rawTypes'
> &
  Pick<Partial<ProviderPlaceSearchResult>, 'addressComponents'>;

/** Hash only the identity snapshot, at its persisted coordinate precision. */
export function groundingIdentityFingerprint(identity: GroundingIdentity) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        identity.externalPlaceId,
        identity.name,
        identity.formattedAddress,
        Number(identity.location.latitude.toFixed(6)),
        Number(identity.location.longitude.toFixed(6)),
        [...identity.rawTypes].sort(),
      ]),
    )
    .digest('hex');
}

function verified(
  candidate: AiPlaceGroundingCandidate,
  identity: GroundingIdentity,
  placeId: string,
  checkedAt: Date,
  countryCode = identity.addressComponents?.find((part) => part.types.includes('country'))
    ?.shortText ?? candidate.countryCode,
): AiPlaceGroundingResult {
  return {
    context: {
      ...(candidate.requireExactName ? { localityName: identity.name } : {}),
      externalPlaceId: identity.externalPlaceId,
      location: identity.location,
      countryCode,
      ...(candidate.languageCode ? { languageCode: candidate.languageCode } : {}),
      ...(candidate.regionCode ? { regionCode: candidate.regionCode } : {}),
    },
    evidence: {
      checkedAt: checkedAt.toISOString(),
      code: null,
      id: scopedId('identity', candidate.id),
      kind: 'identity',
      provider: 'google',
      status: 'verified',
      subjectId: candidate.id,
      subjectType: 'place',
    },
    place: {
      id: candidate.id,
      location: identity.location,
      name: identity.name,
      placeId,
      provider: 'google',
      resolution: 'verified',
      ...(countryCode ? { countryCode: countryCode.toUpperCase() } : {}),
    },
    warnings: [],
  };
}

/** A place the traveller already saved, with the identity Trove stored for it. */
export type KnownPlace = GroundingIdentity & {
  /** When that identity was stored; it dates the verification. */
  checkedAt: Date;
  /** The Trove Place it already is. */
  placeId: string;
};

/**
 * Grounds a candidate on a place the traveller already saved, when the model
 * chose it by name, so it costs no Text Search. It has to be the same name and
 * sit in the same locality, and exactly one saved place may match: anything
 * less certain is left to the normal search. Destinations (cities) are never
 * matched here, since a saved place is a venue.
 */
export function groundFromKnownPlaces(
  candidate: AiPlaceGroundingCandidate,
  known: readonly KnownPlace[],
): AiPlaceGroundingResult | null {
  if (candidate.requireExactName || !known.length) return null;
  const matches = known.filter(
    (place) =>
      sameIdentityName(place.name, candidate.name) &&
      !candidate.contextConflict &&
      localityMatches(place, candidate.localityHint),
  );
  if (matches.length !== 1) return null;
  const match = matches[0]!;
  return verified(candidate, match, match.placeId, match.checkedAt);
}

function scopedId(scope: string, candidateId: string) {
  const digest = createHash('sha256').update(candidateId).digest('hex').slice(0, 24);
  return `${scope}:${digest}`;
}

function fallback(
  candidate: AiPlaceGroundingCandidate,
  verification: 'not_checked' | 'unverified',
  code: string,
  checkedAt: string | null,
): AiPlaceGroundingResult {
  const evidenceId = scopedId('identity', candidate.id);
  return {
    context: null,
    evidence: {
      checkedAt,
      code,
      id: evidenceId,
      kind: 'identity',
      provider: checkedAt ? 'google' : null,
      status: verification,
      subjectId: candidate.id,
      subjectType: 'place',
    },
    place: {
      id: candidate.id,
      name: candidate.name,
      note: candidate.note,
      resolution: 'custom',
      verification,
    },
    warnings: [
      {
        code,
        evidenceIds: [evidenceId],
        id: scopedId('warning', candidate.id),
        itemIds: [],
        material: false,
      },
    ],
  };
}

export class AiPlaceGrounder {
  private readonly searchMemo = new Map<
    string,
    Promise<{
      checkedAt: Date;
      identities: ProviderPlaceSearchResult[];
    }>
  >();

  constructor(
    private readonly provider: PlaceTextSearchProvider,
    private readonly canonicalPlaces: CanonicalIdentityResolver,
    private readonly clock: () => Date = () => new Date(),
    private readonly cache: AiPlaceGroundingCacheRepository | null = new PrismaAiPlaceGroundingCacheRepository(),
  ) {}

  private async readCache(
    key: string,
    candidate: AiPlaceGroundingCandidate,
  ): Promise<{ result: AiPlaceGroundingResult } | { reason: ProviderCacheMissReason }> {
    if (!this.cache) return { reason: 'missing_grounding_mapping' };
    try {
      const entry = await this.cache.read(key);
      if (!entry) return { reason: 'missing_grounding_mapping' };
      const now = this.clock();
      const age = now.getTime() - entry.checkedAt.getTime();
      if (!Number.isFinite(age) || age < 0) return { reason: 'invalid_grounding_mapping' };
      if (age > PLACE_CACHE_TTL_MS) return { reason: 'stale_grounding_mapping' };

      if (entry.outcome === 'unresolved' || entry.outcome === 'ambiguous') {
        if (entry.placeProviderRef) return { reason: 'invalid_grounding_mapping' };
        recordProviderCacheEvent({
          cache: 'place-grounding',
          kind: 'negative_cache_hit',
          operation: 'textSearch',
          provider: 'google',
          source: 'ai-planner',
        });
        return {
          result: fallback(
            candidate,
            'unverified',
            `place_${entry.outcome}`,
            entry.checkedAt.toISOString(),
          ),
        };
      }

      const reference = entry.placeProviderRef;
      if (entry.outcome !== 'verified' || !reference || reference.provider !== 'GOOGLE') {
        return { reason: 'invalid_grounding_mapping' };
      }
      // A later snapshot may have changed its identity or required attribution.
      // Only the snapshot this decision verified may reuse its uniqueness proof.
      if (
        !isSnapshotFresh(reference, { now, languageCode: candidate.languageCode }) ||
        reference.cachedAt?.getTime() !== entry.checkedAt.getTime() ||
        getActivePlaceDetailsFailure(reference, now)
      )
        return { reason: 'grounding_reference_changed' };

      const location = toPlaceCoordinates(reference);
      if (!location || !reference.cachedName) return { reason: 'incomplete_snapshot' };
      const identity: GroundingIdentity = {
        externalPlaceId: reference.externalPlaceId,
        formattedAddress: reference.cachedFormattedAddress ?? null,
        location,
        name: reference.cachedName,
        rawTypes: reference.cachedTypes ?? [],
      };
      if (entry.identityFingerprint !== groundingIdentityFingerprint(identity))
        return { reason: 'grounding_match_changed' };
      recordProviderCacheEvent({
        cache: 'place-grounding',
        kind: 'cache_hit',
        operation: 'textSearch',
        placeFingerprint: providerTargetFingerprint(reference.externalPlaceId),
        provider: 'google',
        source: 'ai-planner',
      });
      const result = verified(
        candidate,
        identity,
        reference.placeId,
        entry.checkedAt,
        entry.countryCode ?? candidate.countryCode,
      );
      return { result };
    } catch {
      return { reason: 'cache_read_failed' };
    }
  }

  private async writeCache(key: string, entry: GroundingCacheWrite) {
    try {
      await this.cache?.write(key, entry);
    } catch {
      // Persistence is an optimisation; the paid-for result is still usable.
    }
  }

  private readonly autocompleteMemo = new Map<
    string,
    Promise<import('./places.js').PlaceSuggestion[]>
  >();

  private unavailable(candidate: AiPlaceGroundingCandidate, error?: unknown) {
    const code = error instanceof PlaceProviderError ? error.code : 'provider_unavailable';
    return fallback(
      candidate,
      'not_checked',
      candidate.signal?.reason === 'provider_time_allowance_exhausted'
        ? 'provider_time_allowance_exhausted'
        : code === 'budget_exhausted'
          ? 'provider_cap_reached'
          : 'provider_unavailable',
      null,
    );
  }

  private async search(request: PlaceTextSearchRequest, reason?: ProviderCacheMissReason) {
    const key = `${memoKey(request)}|${request.detail}`;
    let pending = this.searchMemo.get(key);
    if (!pending) {
      pending = this.provider
        .textSearch({ ...request, cacheMissReason: reason })
        .then((identities) => ({ identities, checkedAt: this.clock() }));
      this.searchMemo.set(key, pending);
    }
    return pending;
  }

  private async accept(attempt: GroundingAttempt, match: ProviderPlaceSearchResult) {
    const { evidence, addressComponents: _components, ...identity } = match;
    const { candidate, checkedAt, key } = attempt;
    const canonical = await this.canonicalPlaces.resolveProviderPlaceFromIdentity(identity, {
      fetchedAt: checkedAt,
      languageCode: candidate.languageCode,
    });
    await this.writeCache(key, {
      checkedAt,
      outcome: 'verified',
      externalPlaceId: identity.externalPlaceId,
      placeId: canonical.id,
      identityFingerprint: groundingIdentityFingerprint(identity),
      countryCode:
        match.addressComponents?.find((part) => part.types.includes('country'))?.shortText ??
        candidate.countryCode ??
        null,
    });
    const result = verified(candidate, match, canonical.id, checkedAt);
    if (evidence && result.context) {
      result.context.evidence = {
        freshness: { fetchedAt: checkedAt.toISOString(), source: 'live' },
        place: { ...identity, ...evidence },
        provider: this.provider.name,
        status: 'ok',
      };
      await rememberPlaceEvidence(result.context, result.context.evidence);
    }
    return result;
  }

  private async unresolved(attempt: GroundingAttempt, ambiguous: boolean) {
    const outcome = ambiguous ? 'ambiguous' : 'unresolved';
    await this.writeCache(attempt.key, { checkedAt: attempt.checkedAt, outcome });
    return fallback(
      attempt.candidate,
      'unverified',
      `place_${outcome}`,
      attempt.checkedAt.toISOString(),
    );
  }

  async groundCandidates(candidates: readonly AiPlaceGroundingCandidate[]) {
    const counts = {
      firstPassMatches: 0,
      recoveredMatches: 0,
      ambiguous: 0,
      unresolved: 0,
      skippedRetries: 0,
    };
    const profiles = new Map<string, PlaceDetailLevel>();
    for (const candidate of candidates) {
      const request = searchRequest(candidate);
      if (!profiles.has(memoKey(request)) || request.detail === 'evidence')
        profiles.set(memoKey(request), request.detail);
    }
    // Every initial lookup completes before any retry competes for the budget.
    const initial = await mapWithConcurrency(
      candidates,
      PROVIDER_CONCURRENCY_LIMIT,
      async (input): Promise<AiPlaceGroundingResult | GroundingAttempt> => {
        const candidate = {
          ...input,
          languageCode: normalizePlaceLanguageCode(input.languageCode),
          detail: profiles.get(memoKey(searchRequest(input))),
        };
        const request = searchRequest(candidate);
        const key = cacheKey(request, candidate);
        const cached = await this.readCache(key, candidate);
        if ('result' in cached) return cached.result;
        if (candidate.contextConflict)
          return fallback(candidate, 'unverified', 'place_ambiguous', null);
        if (candidate.signal?.aborted) return this.unavailable(candidate);
        let page;
        try {
          page = await this.search(request, cached.reason);
        } catch (error) {
          return this.unavailable(candidate, error);
        }
        if (candidate.signal?.aborted) return this.unavailable(candidate);
        const attempt = { candidate, request, key, ...page };
        const matches = rankPlaceMatches(page.identities, candidate);
        if (matches.length === 1) {
          counts.firstPassMatches++;
          return this.accept(attempt, matches[0]!);
        }
        return attempt;
      },
    );
    const results = await mapWithConcurrency(
      initial,
      PROVIDER_CONCURRENCY_LIMIT,
      async (initialResult) => {
        if ('place' in initialResult) return initialResult;
        const attempt = initialResult;
        const { candidate, request } = attempt;
        const aliases = new Map<string, string[]>();
        const addressAliases = new Map<string, string[]>();
        let blockedByOtherPrediction = false;
        if (candidate.signal?.aborted) {
          counts.skippedRetries++;
          return this.unavailable(candidate);
        }
        const plausible = attempt.identities.filter(
          (identity) =>
            identityCompatible(identity, candidate) &&
            (geographicallyEligible(identity, candidate) ||
              (!hasComparableLocalityMismatch(identity, candidate) &&
                [candidate.name, candidate.searchName].some(
                  (name) => name && nameMatchTier(name, identity.name) > 0,
                ))),
        );
        const localizedName = localizedTextQuery(candidate.name, candidate.localityHint);
        // A model locality can redirect a specific viewpoint/facility query to
        // its geographic parent. Use the manual clean name for this recovery;
        // keep the same bias and all geographic/type validation on the results.
        const retryQuery =
          normalizeIdentityText(localizedName) === normalizeIdentityText(request.textQuery) &&
          attempt.identities.length > 0 &&
          !attempt.identities.some((identity) => identityCompatible(identity, candidate))
            ? candidate.name.trim()
            : localizedName;
        try {
          if (plausible.length && this.provider.search) {
            const memo = memoKey({ ...request, textQuery: retryQuery });
            let pending = this.autocompleteMemo.get(memo);
            if (!pending) {
              pending = this.provider.search({
                input: retryQuery,
                signal: candidate.signal,
                languageCode: request.languageCode,
                locationBias: request.locationBias,
                regionCode: request.regionCode,
              });
              this.autocompleteMemo.set(memo, pending);
            }
            const suggestions = await pending;
            const knownIds = new Set(
              attempt.identities.map((identity) => identity.externalPlaceId),
            );
            for (const suggestion of suggestions) {
              if (knownIds.has(suggestion.externalPlaceId)) {
                aliases.set(suggestion.externalPlaceId, [suggestion.name]);
                if (suggestion.description)
                  addressAliases.set(suggestion.externalPlaceId, [suggestion.description]);
              } else if (sameIdentityName(suggestion.name, candidate.name))
                blockedByOtherPrediction = true;
            }
          } else if (
            (!plausible.length ||
              (!this.provider.search &&
                !attempt.identities.some((identity) =>
                  geographicallyEligible(identity, candidate),
                ))) &&
            (candidate.requireExactName || candidate.localityHint || candidate.locationBias) &&
            normalizeIdentityText(retryQuery) !== normalizeIdentityText(request.textQuery)
          ) {
            const page = await this.search({ ...request, textQuery: retryQuery });
            // The retry is a new identity acquisition; keep its actual age.
            attempt.identities = page.identities;
            attempt.checkedAt = page.checkedAt;
          } else {
            counts.skippedRetries++;
          }
        } catch (error) {
          counts.skippedRetries++;
          return this.unavailable(candidate, error); // No negative cache for an incomplete check.
        }
        if (candidate.signal?.aborted) {
          counts.skippedRetries++;
          return this.unavailable(candidate);
        }
        const matches = rankPlaceMatches(attempt.identities, candidate, aliases, addressAliases);
        if (matches.length === 1 && !blockedByOtherPrediction) {
          counts.recoveredMatches++;
          return this.accept(attempt, matches[0]!);
        }
        const ambiguous = matches.length > 1 || blockedByOtherPrediction;
        counts[ambiguous ? 'ambiguous' : 'unresolved']++;
        return this.unresolved(attempt, ambiguous);
      },
    );
    recordAiPlanningTelemetry({
      kind: 'place_reconciliation',
      occurredAt: this.clock().toISOString(),
      ...counts,
    });
    return results;
  }

  async groundCandidate(candidate: AiPlaceGroundingCandidate): Promise<AiPlaceGroundingResult> {
    return (await this.groundCandidates([candidate]))[0]!;
  }
}

type GroundingAttempt = {
  candidate: AiPlaceGroundingCandidate;
  request: PlaceTextSearchRequest;
  key: string;
  checkedAt: Date;
  identities: ProviderPlaceSearchResult[];
};
