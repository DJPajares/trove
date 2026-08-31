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
  const provider: PlaceTextSearchProvider = {
    name: 'google',
    textSearch: async () => {
      searches += 1;
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
  return { grounder, resolutions, searches: () => searches };
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

test('fuzzy names, locality disagreement, and no result remain unverified Custom Places', async () => {
  const cases = [
    [identity({ name: 'National Museum of Singapore' })],
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
