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
/** Short tokens ("ha", "sa", "st") match too much of an address to place a venue. */
const LOCALITY_TOKEN_MIN_LENGTH = 4;

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
function localityMatches(identity: ProviderPlaceIdentity, localityHint: string | undefined) {
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
      textQuery: localizedTextQuery(candidate.searchQuery, candidate.localityHint),
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

    // Spacing is the other half of the transliteration problem: "Sensō-ji"
    // against "Senso ji", "Sapa" against "Sa Pa". Compare the names with it
    // removed so an exact identity still reads as exact.
    const expectedName = compactText(candidate.name);
    const located = identities.filter((identity) =>
      localityMatches(identity, candidate.localityHint),
    );
    const exact = located.filter((identity) => compactText(identity.name) === expectedName);
    const matches = exact.length
      ? exact
      : located.filter((identity) => nameTokensContained(identity.name, candidate.name));

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
