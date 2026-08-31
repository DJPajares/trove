import { createHash } from 'node:crypto';

import type {
  AiPlannerCandidatePlace,
  AiPlannerDraftPlace,
  AiPlannerEvidence,
  AiPlannerWarning,
} from '@trove/types';

import { mapWithConcurrency, PROVIDER_CONCURRENCY_LIMIT } from './concurrency.js';
import {
  PlaceProviderError,
  type PlaceLocationBias,
  type PlaceTextSearchProvider,
  type PlaceTextSearchRequest,
  type ProviderPlaceIdentity,
} from './places.js';

const GENERIC_LOCALITY_WORDS = new Set(['city', 'prefecture', 'province', 'region']);

export type AiPlaceGroundingCandidate = AiPlannerCandidatePlace & {
  languageCode?: string;
  localityHint?: string;
  locationBias?: PlaceLocationBias;
  regionCode?: string;
};

export type AiPlaceGroundingResult = {
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

function localityMatches(identity: ProviderPlaceIdentity, localityHint: string | undefined) {
  if (!localityHint?.trim()) return true;
  if (!identity.formattedAddress) return false;

  const tokens = normalizeIdentityText(localityHint)
    .split(' ')
    .filter((token) => token && !GENERIC_LOCALITY_WORDS.has(token));
  if (tokens.length === 0) return true;

  const addressTokens = new Set(normalizeIdentityText(identity.formattedAddress).split(' '));
  return tokens.every((token) => addressTokens.has(token));
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
  private readonly searchMemo = new Map<string, Promise<ProviderPlaceIdentity[]>>();

  constructor(
    private readonly provider: PlaceTextSearchProvider,
    private readonly canonicalPlaces: CanonicalIdentityResolver,
    private readonly clock: () => Date = () => new Date(),
  ) {}

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
      textQuery: candidate.searchQuery,
    };
    let identities: ProviderPlaceIdentity[];
    try {
      const key = memoKey(request);
      let pending = this.searchMemo.get(key);
      if (!pending) {
        pending = this.provider.textSearch(request);
        this.searchMemo.set(key, pending);
      }
      identities = await pending;
    } catch (error) {
      const code = error instanceof PlaceProviderError ? error.code : 'provider_unavailable';
      return fallback(
        candidate,
        'not_checked',
        code === 'budget_exhausted' ? 'provider_cap_reached' : 'provider_unavailable',
        null,
      );
    }

    const checkedAt = this.clock();

    const expectedName = normalizeIdentityText(candidate.name);
    const matches = identities.filter(
      (identity) =>
        normalizeIdentityText(identity.name) === expectedName &&
        localityMatches(identity, candidate.localityHint),
    );

    if (matches.length !== 1) {
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

    return {
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
        placeId: canonical.id,
        provider: 'google',
        resolution: 'verified',
      },
      warnings: [],
    };
  }
}
