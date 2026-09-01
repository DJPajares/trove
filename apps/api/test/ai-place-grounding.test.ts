import { expect, test } from 'vitest';

import { AiPlaceGrounder } from '../src/services/ai-place-grounding.js';
import {
  PlaceProviderError,
  type PlaceTextSearchProvider,
  type ProviderPlaceIdentity,
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

function setup(answer: ProviderPlaceIdentity[] | Error) {
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
