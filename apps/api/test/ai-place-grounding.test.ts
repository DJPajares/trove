import { expect, test } from 'vitest';

import { AiPlaceGrounder } from '../src/services/ai-place-grounding.js';
import type {
  AiPlaceGroundingCacheRepository,
  GroundingCacheReference,
  GroundingCacheWrite,
} from '../src/services/ai-place-grounding-cache.js';
import { PLACE_CACHE_TTL_MS } from '../src/services/cached-places.js';
import {
  PlaceProviderError,
  type PlaceTextSearchProvider,
  type ProviderPlaceIdentity,
  type ProviderPlaceSearchResult,
} from '../src/services/places.js';

const canonicalPlaceId = '8926bbe8-abae-470c-ab90-f33af1a8d168';

function identity(overrides: Partial<ProviderPlaceIdentity> = {}): ProviderPlaceIdentity {
  return {
    attributions: [{ provider: 'Example Data', providerUri: 'https://example.com/source' }],
    category: 'things_to_do',
    externalPlaceId: 'ChIJmuseum',
    formattedAddress: '93 Stamford Road, Singapore 178897',
    googleMapsUri: 'https://maps.google.com/?cid=1',
    location: { latitude: 1.2966, longitude: 103.8485 },
    name: 'National Museum',
    primaryType: 'museum',
    provider: 'google',
    rawTypes: ['museum'],
    utcOffsetMinutes: 480,
    ...overrides,
  };
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'candidate:museum',
    languageCode: 'en',
    localityHint: 'Singapore City',
    name: 'National Museum',
    note: 'Spend time in the history galleries.',
    searchQuery: 'National Museum Singapore',
    ...overrides,
  };
}

function setup(answer: ProviderPlaceSearchResult[] | Error) {
  let searches = 0;
  const queries: string[] = [];
  const provider: PlaceTextSearchProvider = {
    name: 'google',
    textSearch: async (request) => {
      searches += 1;
      queries.push(request.textQuery);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  const resolutions: ProviderPlaceIdentity[] = [];
  const grounder = new AiPlaceGrounder(
    provider,
    {
      resolveProviderPlaceFromIdentity: async (place) => {
        resolutions.push(place);
        return { id: canonicalPlaceId };
      },
    },
    () => new Date('2026-08-31T04:00:00.000Z'),
    null,
  );
  return { grounder, queries, resolutions, searches: () => searches };
}

test('a unique exact name and locality match becomes a canonical verified place', async () => {
  const { grounder, resolutions } = setup([identity()]);

  const result = await grounder.groundCandidate(candidate());

  expect(result.place).toStrictEqual({
    attributions: [{ provider: 'Example Data', providerUri: 'https://example.com/source' }],
    id: 'candidate:museum',
    location: { latitude: 1.2966, longitude: 103.8485 },
    name: 'National Museum',
    placeId: canonicalPlaceId,
    provider: 'google',
    resolution: 'verified',
  });
  expect(result.evidence).toMatchObject({
    checkedAt: '2026-08-31T04:00:00.000Z',
    code: null,
    provider: 'google',
    status: 'verified',
  });
  expect(result.warnings).toStrictEqual([]);
  expect(resolutions).toStrictEqual([identity()]);
});

test('duplicate identity and scoring queries share the enriched search before either dispatches', async () => {
  for (const reverse of [false, true]) {
    const requests: string[] = [];
    const resolutions: ProviderPlaceIdentity[] = [];
    const now = new Date('2026-09-02T12:00:00Z');
    const grounder = new AiPlaceGrounder(
      {
        name: 'google',
        async textSearch(request) {
          requests.push(request.detail);
          return [{ ...identity(), evidence: { openingPeriods: [], rating: 4.8 } }];
        },
      },
      {
        async resolveProviderPlaceFromIdentity(value) {
          resolutions.push(value);
          return { id: canonicalPlaceId };
        },
      },
      () => now,
      null,
    );
    const candidates = [
      candidate({ id: 'destination', detail: 'location' }),
      candidate({ detail: 'evidence' }),
    ];
    const results = await grounder.groundCandidates(reverse ? candidates.reverse() : candidates);
    expect(requests).toEqual(['evidence']);
    for (const result of results) {
      expect(result.context?.evidence).toMatchObject({
        freshness: { fetchedAt: now.toISOString(), source: 'live' },
        place: {
          externalPlaceId: 'ChIJmuseum',
          openingPeriods: [],
          rating: 4.8,
          attributions: identity().attributions,
        },
      });
      expect(result.place).not.toHaveProperty('evidence');
    }
    for (const resolved of resolutions) {
      expect(resolved).not.toHaveProperty('evidence');
      expect(resolved).not.toHaveProperty('rating');
      expect(resolved).not.toHaveProperty('openingPeriods');
    }
  }
});

test('unrelated names, locality disagreement, and no result remain unverified Custom Places', async () => {
  const cases = [
    [identity({ name: 'Asian Civilisations Museum' })],
    [identity({ formattedAddress: 'London, United Kingdom' })],
    [],
  ];

  for (const answer of cases) {
    const { grounder, resolutions } = setup(answer);
    const result = await grounder.groundCandidate(candidate());
    expect(result.place).toStrictEqual({
      id: 'candidate:museum',
      name: 'National Museum',
      note: 'Spend time in the history galleries.',
      resolution: 'custom',
      verification: 'unverified',
    });
    expect(result.evidence).toMatchObject({ code: 'place_unresolved', status: 'unverified' });
    expect(resolutions).toStrictEqual([]);
    expect(JSON.stringify(result)).not.toContain('latitude');
  }
});

test('two exact eligible results are ambiguous rather than confidence-scored', async () => {
  const { grounder, resolutions } = setup([
    identity(),
    identity({ externalPlaceId: 'ChIJmuseum2', googleMapsUri: null }),
  ]);

  const result = await grounder.groundCandidate(candidate());

  expect(result.place).toMatchObject({ resolution: 'custom', verification: 'unverified' });
  expect(result.evidence.code).toBe('place_ambiguous');
  expect(resolutions).toStrictEqual([]);
});

test('provider outages and cap exhaustion become not-checked Custom Places', async () => {
  for (const [error, expectedCode] of [
    [new PlaceProviderError('provider_unavailable'), 'provider_unavailable'],
    [new PlaceProviderError('budget_exhausted'), 'provider_cap_reached'],
  ] as const) {
    const { grounder } = setup(error);
    const result = await grounder.groundCandidate(candidate());
    expect(result.place).toMatchObject({ resolution: 'custom', verification: 'not_checked' });
    expect(result.evidence).toMatchObject({ checkedAt: null, code: expectedCode, provider: null });
  }
});

test('identical search requests share one provider call while reusing canonical identity', async () => {
  const { grounder, resolutions, searches } = setup([identity()]);

  const results = await grounder.groundCandidates([
    candidate(),
    candidate({ id: 'candidate:museum-copy' }),
  ]);

  expect(searches()).toBe(1);
  expect(resolutions).toHaveLength(2);
  expect(results.map((result) => result.place)).toMatchObject([
    { placeId: canonicalPlaceId, resolution: 'verified' },
    { placeId: canonicalPlaceId, resolution: 'verified' },
  ]);
});

test('a provider name that contains the planner name verifies rather than falling back', async () => {
  for (const providerName of ['National Museum of Singapore', 'National Museum Singapore']) {
    const { grounder, resolutions } = setup([identity({ name: providerName })]);

    const result = await grounder.groundCandidate(candidate());

    expect(result.place).toMatchObject({ placeId: canonicalPlaceId, resolution: 'verified' });
    expect(result.evidence).toMatchObject({ code: null, status: 'verified' });
    expect(result.warnings).toStrictEqual([]);
    expect(resolutions).toHaveLength(1);
  }
});

test('a planner name that contains the provider name verifies', async () => {
  const { grounder } = setup([identity({ name: 'National Museum' })]);

  const result = await grounder.groundCandidate(candidate({ name: 'National Museum Galleries' }));

  expect(result.place).toMatchObject({ placeId: canonicalPlaceId, resolution: 'verified' });
});

test('two containment matches stay ambiguous instead of picking the first', async () => {
  const { grounder, resolutions } = setup([
    identity({ name: 'National Museum of Singapore' }),
    identity({ externalPlaceId: 'ChIJmuseum2', name: 'National Museum Annexe' }),
  ]);

  const result = await grounder.groundCandidate(candidate());

  expect(result.place).toMatchObject({ resolution: 'custom', verification: 'unverified' });
  expect(result.evidence.code).toBe('place_ambiguous');
  expect(resolutions).toStrictEqual([]);
});

test('an exact match wins outright even when looser names also fit the locality', async () => {
  const { grounder, resolutions } = setup([
    identity({ name: 'National Museum of Singapore' }),
    identity({ externalPlaceId: 'ChIJmuseum-exact', name: 'National Museum' }),
  ]);

  const result = await grounder.groundCandidate(candidate());

  expect(result.place).toMatchObject({ placeId: canonicalPlaceId, resolution: 'verified' });
  expect(resolutions).toStrictEqual([identity({ externalPlaceId: 'ChIJmuseum-exact' })]);
});

test('the locality is added to the query only when the planner left it out', async () => {
  const absent = setup([identity()]);
  await absent.grounder.groundCandidate(candidate({ searchQuery: 'National Museum' }));
  expect(absent.queries).toStrictEqual(['National Museum, Singapore City']);

  const present = setup([identity()]);
  await present.grounder.groundCandidate(candidate());
  expect(present.queries).toStrictEqual(['National Museum Singapore']);

  const none = setup([identity()]);
  await none.grounder.groundCandidate(candidate({ localityHint: undefined }));
  expect(none.queries).toStrictEqual(['National Museum Singapore']);
});

test('a transliterated locality still places the venue', async () => {
  // Every one of these fell back to a Custom Place in production: the planner
  // writes "Hanoi" and "Sapa", Google's addresses say "Hà Nội" and "Sa Pa".
  const cases = [
    {
      formattedAddress: '24 Hàng Bè, Hoàn Kiếm, Hà Nội, Vietnam',
      localityHint: 'Hanoi, Vietnam',
      name: 'Hanoi Old Quarter',
    },
    {
      formattedAddress: 'Sa Pa, Lào Cai, Vietnam',
      localityHint: 'Sapa, Lào Cai, Vietnam',
      name: 'Cat Cat Village',
    },
    {
      formattedAddress: 'Hạ Long, Quảng Ninh, Vietnam',
      localityHint: 'Ha Long Bay, Quảng Ninh, Vietnam',
      name: 'Tuan Chau International Marina',
    },
  ];

  for (const { formattedAddress, localityHint, name } of cases) {
    const { grounder } = setup([identity({ formattedAddress, name })]);
    const result = await grounder.groundCandidate(candidate({ localityHint, name }));
    expect(result.place).toMatchObject({ placeId: canonicalPlaceId, resolution: 'verified' });
  }
});

test('a name that differs only in spacing counts as an exact identity', async () => {
  const { grounder } = setup([
    identity({ formattedAddress: '2-3-1 Asakusa, Taito City, Tokyo, Japan', name: 'Sensō-ji' }),
  ]);

  const result = await grounder.groundCandidate(
    candidate({ localityHint: 'Tokyo', name: 'Senso ji', searchQuery: 'Senso ji Tokyo' }),
  );

  expect(result.place).toMatchObject({ placeId: canonicalPlaceId, resolution: 'verified' });
});

test('a locality on the other side of the world still rejects the venue', async () => {
  const { grounder, resolutions } = setup([
    identity({ formattedAddress: '10 Downing Street, London, United Kingdom' }),
  ]);

  const result = await grounder.groundCandidate(candidate());

  expect(result.place).toMatchObject({ resolution: 'custom', verification: 'unverified' });
  expect(resolutions).toStrictEqual([]);
});

function cachedSetup(
  initialAnswer: ProviderPlaceIdentity[] | Error = [identity({ attributions: [] })],
) {
  const entries = new Map<string, GroundingCacheWrite>();
  const writes: GroundingCacheWrite[] = [];
  const state = {
    answer: initialAnswer,
    now: new Date('2026-09-02T12:00:00.000Z'),
    reference: null as GroundingCacheReference | null,
    searches: 0,
    resolutions: 0,
    readFails: false,
    writeFails: false,
  };
  const cache: AiPlaceGroundingCacheRepository = {
    async read(key) {
      if (state.readFails) throw new Error('cache unavailable');
      const entry = entries.get(key);
      return entry
        ? { ...entry, placeProviderRef: entry.outcome === 'verified' ? state.reference : null }
        : null;
    },
    async write(key, entry) {
      if (state.writeFails) throw new Error('cache unavailable');
      entries.set(key, entry);
      writes.push(entry);
    },
  };
  const newGrounder = () =>
    new AiPlaceGrounder(
      {
        name: 'google',
        async textSearch() {
          state.searches += 1;
          if (state.answer instanceof Error) throw state.answer;
          return state.answer;
        },
      },
      {
        async resolveProviderPlaceFromIdentity(place, options) {
          state.resolutions += 1;
          state.reference = {
            id: 'reference-id',
            placeId: canonicalPlaceId,
            provider: 'GOOGLE',
            externalPlaceId: place.externalPlaceId,
            cachedAt: options?.fetchedAt,
            cachedName: place.name,
            cachedFormattedAddress: place.formattedAddress,
            cachedLatitude: place.location.latitude,
            cachedLongitude: place.location.longitude,
            cachedLanguageCode: options?.languageCode ?? 'en',
          };
          return { id: canonicalPlaceId };
        },
      },
      () => state.now,
      cache,
    );
  return { cache, entries, newGrounder, state, writes };
}

test('a new run reuses the identity and original evidence without refreshing either timestamp', async () => {
  const { newGrounder, state, entries, writes } = cachedSetup();
  const first = await newGrounder().groundCandidate(candidate());
  const checkedAt = state.now;
  state.now = new Date(checkedAt.getTime() + 86_400_000);
  const second = await newGrounder().groundCandidate(
    candidate({ id: 'candidate:another-traveller', note: 'Different note' }),
  );

  expect(state.searches).toBe(1);
  expect(state.resolutions).toBe(1);
  expect(writes).toHaveLength(1);
  expect(state.reference?.cachedAt).toEqual(checkedAt);
  expect(second.context).toEqual(first.context);
  expect(second.place).toMatchObject({ placeId: canonicalPlaceId, resolution: 'verified' });
  expect(second.evidence).toMatchObject({
    checkedAt: checkedAt.toISOString(),
    subjectId: 'candidate:another-traveller',
  });
  expect([...entries.keys()][0]).toMatch(/^[a-f0-9]{64}$/);
  expect(writes[0]).toStrictEqual({
    checkedAt,
    outcome: 'verified',
    externalPlaceId: 'ChIJmuseum',
    placeId: canonicalPlaceId,
  });
});

test('requesting scoring evidence does not invalidate an existing identity-only mapping', async () => {
  const { newGrounder, state } = cachedSetup();
  const first = await newGrounder().groundCandidate(candidate({ detail: 'location' }));
  const second = await newGrounder().groundCandidate(candidate({ detail: 'evidence' }));
  expect(state.searches).toBe(1);
  expect(state.resolutions).toBe(1);
  expect(second.evidence).toEqual(first.evidence);
  expect(second.context?.evidence).toBeUndefined();
});

test('completed unresolved and ambiguous outcomes are shared, with the current candidate note and IDs', async () => {
  for (const answer of [[], [identity(), identity({ externalPlaceId: 'duplicate' })]]) {
    const { newGrounder, state, writes } = cachedSetup(answer);
    const first = await newGrounder().groundCandidate(candidate());
    state.now = new Date(state.now.getTime() + 86_400_000);
    const second = await newGrounder().groundCandidate(
      candidate({ id: 'candidate:copy', note: 'New note' }),
    );
    expect(state.searches).toBe(1);
    expect(state.resolutions).toBe(0);
    expect(second.evidence.code).toBe(first.evidence.code);
    expect(second.evidence.checkedAt).toBe(first.evidence.checkedAt);
    expect(second.context).toBeNull();
    expect(second.place).toMatchObject({
      id: 'candidate:copy',
      note: 'New note',
      verification: 'unverified',
    });
    expect(writes).toHaveLength(1);
    expect(Object.keys(writes[0]!).sort()).toEqual(['checkedAt', 'outcome']);
  }
});

test('positive and negative decisions expire only after the 30-day ceiling', async () => {
  for (const answer of [[identity({ attributions: [] })], [], [identity(), identity()]]) {
    const { newGrounder, state } = cachedSetup(answer);
    await newGrounder().groundCandidate(candidate());
    state.now = new Date(state.now.getTime() + PLACE_CACHE_TTL_MS);
    await newGrounder().groundCandidate(candidate());
    expect(state.searches).toBe(1);
    state.now = new Date(state.now.getTime() + 1);
    await newGrounder().groundCandidate(candidate());
    expect(state.searches).toBe(2);
  }
});

test('matching context isolates decisions even when the provider query is identical', async () => {
  const changes = [
    { name: 'Unrelated Museum' },
    { localityHint: undefined },
    { localityHint: 'London' },
    { languageCode: 'ja' },
    { regionCode: 'GB' },
    { locationBias: { latitude: 1, longitude: 103, radiusMeters: 500 } },
    { searchQuery: 'National Museum Galleries Singapore' },
  ];
  for (const change of changes) {
    const { newGrounder, state } = cachedSetup();
    await newGrounder().groundCandidate(candidate());
    const result = await newGrounder().groundCandidate(candidate(change));
    expect(state.searches, JSON.stringify(change)).toBe(2);
    if (change.name || change.localityHint === 'London')
      expect(result.place.resolution).toBe('custom');
  }

  const { newGrounder, state } = cachedSetup([
    identity({ attributions: [], name: 'National Museum of Singapore' }),
    identity({ name: 'National Museum Annexe' }),
  ]);
  await newGrounder().groundCandidate(candidate()); // ambiguous
  const differentName = await newGrounder().groundCandidate(
    candidate({ name: 'National Museum Annexe' }),
  );
  expect(state.searches).toBe(2);
  expect(differentName.place.resolution).toBe('verified');
});

test('normalization and bias coordinates retain the existing request-key semantics', async () => {
  const { newGrounder, state } = cachedSetup();
  const bias = { latitude: 1, longitude: 103, radiusMeters: 500 };
  await newGrounder().groundCandidate(candidate({ regionCode: 'sg', locationBias: bias }));
  await newGrounder().groundCandidate(
    candidate({
      name: 'Nátional MUSEUM',
      localityHint: ' SÍNGAPORE CITY ',
      searchQuery: ' National, MUSEUM Singapore ',
      languageCode: ' EN ',
      regionCode: ' SG ',
      locationBias: bias,
    }),
  );
  expect(state.searches).toBe(1);
  for (const changedBias of [
    { ...bias, latitude: 2 },
    { ...bias, longitude: 104 },
    { ...bias, radiusMeters: 1000 },
  ])
    await newGrounder().groundCandidate(candidate({ regionCode: 'sg', locationBias: changedBias }));
  expect(state.searches).toBe(4);
});

test('missing, stale, changed, failed, or mismatched reference snapshots force a new search', async () => {
  const changes: Array<Partial<GroundingCacheReference> | null> = [
    null,
    { cachedAt: null },
    { cachedAt: new Date('2026-07-01') },
    { cachedAt: new Date('2026-09-02T12:00:00.001Z') },
    { cachedName: null },
    { cachedLatitude: null },
    { cachedLanguageCode: 'ja' },
    { cachedName: 'Asian Civilisations Museum' },
    { cachedFormattedAddress: 'London, UK' },
    { detailsFailureCode: 'NOT_FOUND', detailsFailedAt: new Date('2026-09-02T12:00:00Z') },
  ];
  for (const change of changes) {
    const { newGrounder, state } = cachedSetup();
    await newGrounder().groundCandidate(candidate());
    if (change === null) state.reference = null;
    else Object.assign(state.reference!, change);
    await newGrounder().groundCandidate(candidate());
    expect(state.searches, JSON.stringify(change)).toBe(2);
  }
});

test('provider failures are retried in new runs and never become negative mappings', async () => {
  for (const code of [
    'provider_unavailable',
    'rate_limited',
    'quota_exceeded',
    'configuration_missing',
    'budget_exhausted',
  ] as const) {
    const { newGrounder, state, entries } = cachedSetup(new PlaceProviderError(code));
    for (let run = 0; run < 2; run += 1) {
      const result = await newGrounder().groundCandidate(candidate());
      expect(result.place).toMatchObject({ verification: 'not_checked' });
    }
    expect(state.searches).toBe(2);
    expect(entries.size).toBe(0);
  }
});

test('attributed identities stay live and retain their provider credits', async () => {
  const { newGrounder, state, entries } = cachedSetup([identity()]);
  await newGrounder().groundCandidate(candidate());
  const result = await newGrounder().groundCandidate(candidate());
  expect(state.searches).toBe(2);
  expect(entries.size).toBe(0);
  expect(result.place).toMatchObject({ attributions: identity().attributions });
});

test('cache errors preserve live grounding and concurrent identical queries still search once', async () => {
  for (const error of ['readFails', 'writeFails'] as const) {
    const { newGrounder, state } = cachedSetup();
    state[error] = true;
    const results = await newGrounder().groundCandidates([candidate(), candidate({ id: 'copy' })]);
    expect(state.searches).toBe(1);
    expect(results.every((result) => result.place.resolution === 'verified')).toBe(true);
  }
});

test('a cached exact survivor cannot answer a broader name that would be ambiguous', async () => {
  const { newGrounder, state } = cachedSetup([
    identity({ attributions: [], name: 'National Museum of Singapore' }),
    identity({ attributions: [], externalPlaceId: 'annexe', name: 'National Museum Annexe' }),
  ]);
  const first = await newGrounder().groundCandidate(
    candidate({ name: 'National Museum of Singapore' }),
  );
  expect(first.place.resolution).toBe('verified');
  const second = await newGrounder().groundCandidate(candidate());
  expect(state.searches).toBe(2);
  expect(second.evidence.code).toBe('place_ambiguous');
});

test('a later attributed snapshot cannot revive an older positive mapping', async () => {
  const { newGrounder, state } = cachedSetup();
  await newGrounder().groundCandidate(candidate());
  state.reference!.cachedName = null;
  state.now = new Date(state.now.getTime() + 1_000);
  state.answer = [identity()];
  await newGrounder().groundCandidate(candidate());
  const result = await newGrounder().groundCandidate(candidate());
  expect(state.searches).toBe(3);
  expect(result.place).toMatchObject({ attributions: identity().attributions });
});
