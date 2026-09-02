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
import { PLACE_CACHE_TTL_MS } from './cached-places.js';
import { isSnapshotFresh, toPlaceCoordinates } from './place-data.js';
import { getActivePlaceDetailsFailure } from './place-details-failures.js';
import {
  providerTargetFingerprint,
  recordProviderCacheEvent,
  type ProviderCacheMissReason,
} from './provider-usage.js';
import {
  PlaceProviderError,
  type PlaceLocationBias,
  type PlaceTextSearchProvider,
  type PlaceTextSearchRequest,
  type ProviderPlaceIdentity,
} from './places.js';

const GENERIC_LOCALITY_WORDS = new Set(['city', 'prefecture', 'province', 'region']);
/** Short tokens ("ha", "sa", "st") match too much of an address to place a venue. */
const LOCALITY_TOKEN_MIN_LENGTH = 4;

export type AiPlaceGroundingCandidate = AiPlannerCandidatePlace & {
  languageCode?: string;
  localityHint?: string;
  locationBias?: PlaceLocationBias;
  regionCode?: string;
};

export type GroundedPlaceContext = {
  externalPlaceId: string;
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

function normalizeIdentityText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLocaleLowerCase('en')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function textTokens(value: string) {
  return normalizeIdentityText(value)
    .split(' ')
    .filter((token) => token.length > 0);
}

function localityTokens(localityHint: string | undefined) {
  if (!localityHint?.trim()) return [];
  return textTokens(localityHint).filter((token) => !GENERIC_LOCALITY_WORDS.has(token));
}

function compactText(value: string) {
  return textTokens(value).join('');
}

/**
 * The planner writes a locality the way a traveller says it and Google writes it
 * the way the post office does: "Hanoi" against "Hà Nội", "Sapa" against
 * "Sa Pa", "Ha Long Bay" against "Hạ Long". Demanding every locality token as a
 * whole word in the address rejected entire regions of real venues, so ask
 * instead for one substantial piece of the locality to appear with spacing
 * ignored. This is a disambiguator between same-named venues, not the identity
 * claim itself - the name tiers and the single-survivor rule make that call.
 */
function localityMatches(
  identity: Pick<ProviderPlaceIdentity, 'formattedAddress'>,
  localityHint: string | undefined,
) {
  if (!localityHint?.trim()) return true;
  if (!identity.formattedAddress) return false;

  const tokens = localityTokens(localityHint);
  if (tokens.length === 0) return true;

  const address = compactText(identity.formattedAddress);
  const substantial = tokens.filter((token) => token.length >= LOCALITY_TOKEN_MIN_LENGTH);
  return (substantial.length ? substantial : tokens).some((token) => address.includes(token));
}

/**
 * A provider display name and the planner's label name the same venue far more
 * often than they agree character for character: "Sensō-ji Temple" against
 * "Sensō-ji", or "Tokyo Skytree" against "Tokyo Skytree Tower". Accept a name
 * whose tokens are wholly contained in the other, which keeps an unrelated
 * venue out without reaching for fuzzy distance. The single-survivor rule in
 * `groundCandidate` remains the guard against a loose containment match.
 */
function nameTokensContained(left: string, right: string) {
  const leftTokens = textTokens(left);
  const rightTokens = textTokens(right);
  if (!leftTokens.length || !rightTokens.length) return false;

  const [shorter, longer] =
    leftTokens.length <= rightTokens.length ? [leftTokens, rightTokens] : [rightTokens, leftTokens];
  const longerTokens = new Set(longer);
  return shorter.every((token) => longerTokens.has(token));
}

/**
 * Google ranks on the query text it is given, so a bare venue name competes
 * with every same-named venue on earth. Naming the locality the planner already
 * chose costs nothing - Text Search is billed per request - and is what puts the
 * intended venue in the returned page at all.
 */
function localizedTextQuery(searchQuery: string, localityHint: string | undefined) {
  const locality = localityHint?.trim();
  const tokens = localityTokens(locality);
  if (!locality || !tokens.length) return searchQuery;

  const queryTokens = new Set(textTokens(searchQuery));
  if (tokens.every((token) => queryTokens.has(token))) return searchQuery;
  return `${searchQuery}, ${locality}`;
}

function memoKey(request: PlaceTextSearchRequest) {
  const bias = request.locationBias;
  return [
    normalizeIdentityText(request.textQuery),
    request.languageCode?.trim().toLowerCase() ?? '',
    request.regionCode?.trim().toUpperCase() ?? '',
    bias?.latitude ?? '',
    bias?.longitude ?? '',
    bias?.radiusMeters ?? '',
  ].join('|');
}

function cacheKey(request: PlaceTextSearchRequest, candidate: AiPlaceGroundingCandidate) {
  // Bump the version if matching rules or the provider search page change.
  // The same query can have a different survivor for a different candidate
  // name or locality. A query-only key would incorrectly reuse that decision.
  return createHash('sha256')
    .update(
      JSON.stringify([
        'google:grounding:v1',
        memoKey(request),
        normalizeIdentityText(candidate.name),
        candidate.localityHint?.trim() ? normalizeIdentityText(candidate.localityHint) : null,
      ]),
    )
    .digest('hex');
}

type GroundingIdentity = Pick<
  ProviderPlaceIdentity,
  'attributions' | 'externalPlaceId' | 'formattedAddress' | 'location' | 'name'
>;

function eligibleMatches<T extends Pick<ProviderPlaceIdentity, 'name' | 'formattedAddress'>>(
  identities: T[],
  candidate: AiPlaceGroundingCandidate,
) {
  const expectedName = compactText(candidate.name);
  const located = identities.filter((identity) =>
    localityMatches(identity, candidate.localityHint),
  );
  const exact = located.filter((identity) => compactText(identity.name) === expectedName);
  return exact.length
    ? exact
    : located.filter((identity) => nameTokensContained(identity.name, candidate.name));
}

function verified(
  candidate: AiPlaceGroundingCandidate,
  identity: GroundingIdentity,
  placeId: string,
  checkedAt: Date,
): AiPlaceGroundingResult {
  return {
    context: { externalPlaceId: identity.externalPlaceId, location: identity.location },
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
      attributions: identity.attributions,
      id: candidate.id,
      location: identity.location,
      name: identity.name,
      placeId,
      provider: 'google',
      resolution: 'verified',
    },
    warnings: [],
  };
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
      identities: ProviderPlaceIdentity[];
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
        attributions: [],
        externalPlaceId: reference.externalPlaceId,
        formattedAddress: reference.cachedFormattedAddress ?? null,
        location,
        name: reference.cachedName,
      };
      if (eligibleMatches([identity], candidate).length !== 1)
        return { reason: 'grounding_match_changed' };
      recordProviderCacheEvent({
        cache: 'place-grounding',
        kind: 'cache_hit',
        operation: 'textSearch',
        placeFingerprint: providerTargetFingerprint(reference.externalPlaceId),
        provider: 'google',
        source: 'ai-planner',
      });
      return { result: verified(candidate, identity, reference.placeId, entry.checkedAt) };
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

  groundCandidates(candidates: readonly AiPlaceGroundingCandidate[]) {
    return mapWithConcurrency(candidates, PROVIDER_CONCURRENCY_LIMIT, (candidate) =>
      this.groundCandidate(candidate),
    );
  }

  async groundCandidate(candidate: AiPlaceGroundingCandidate): Promise<AiPlaceGroundingResult> {
    const request: PlaceTextSearchRequest = {
      languageCode: candidate.languageCode,
      locationBias: candidate.locationBias,
      regionCode: candidate.regionCode,
      textQuery: localizedTextQuery(candidate.searchQuery, candidate.localityHint),
    };
    const persistentKey = cacheKey(request, candidate);
    const cached = await this.readCache(persistentKey, candidate);
    if ('result' in cached) return cached.result;
    let identities: ProviderPlaceIdentity[];
    let checkedAt: Date;
    try {
      const key = memoKey(request);
      let pending = this.searchMemo.get(key);
      if (!pending) {
        pending = this.provider
          .textSearch({ ...request, cacheMissReason: cached.reason })
          .then((identities) => ({ identities, checkedAt: this.clock() }));
        this.searchMemo.set(key, pending);
      }
      ({ identities, checkedAt } = await pending);
    } catch (error) {
      const code = error instanceof PlaceProviderError ? error.code : 'provider_unavailable';
      return fallback(
        candidate,
        'not_checked',
        code === 'budget_exhausted' ? 'provider_cap_reached' : 'provider_unavailable',
        null,
      );
    }

    // Spacing is the other half of the transliteration problem: "Sensō-ji"
    // against "Senso ji", "Sapa" against "Sa Pa". Compare the names with it
    // removed so an exact identity still reads as exact.
    const matches = eligibleMatches(identities, candidate);

    if (matches.length !== 1) {
      await this.writeCache(persistentKey, {
        checkedAt,
        outcome: matches.length > 1 ? 'ambiguous' : 'unresolved',
      });
      return fallback(
        candidate,
        'unverified',
        matches.length > 1 ? 'place_ambiguous' : 'place_unresolved',
        checkedAt.toISOString(),
      );
    }

    const identity = matches[0] as ProviderPlaceIdentity;
    const canonical = await this.canonicalPlaces.resolveProviderPlaceFromIdentity(identity, {
      fetchedAt: checkedAt,
      languageCode: candidate.languageCode,
    });

    // The snapshot does not store third-party credits. Reusing an attributed
    // result would drop them, so leave that result on the live path.
    if (identity.attributions.length === 0) {
      await this.writeCache(persistentKey, {
        checkedAt,
        outcome: 'verified',
        externalPlaceId: identity.externalPlaceId,
        placeId: canonical.id,
      });
    }
    return verified(candidate, identity, canonical.id, checkedAt);
  }
}
