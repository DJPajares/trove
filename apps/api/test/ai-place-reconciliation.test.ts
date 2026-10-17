import { expect, test, vi } from 'vitest';
import {
  AiPlaceGrounder,
  type AiPlaceGroundingCandidate,
} from '../src/services/ai-place-grounding.js';
import type {
  AiPlaceGroundingCacheRepository,
  GroundingCacheEntry,
  GroundingCacheWrite,
} from '../src/services/ai-place-grounding-cache.js';
import { GooglePlacesProvider } from '../src/services/google-places.js';
import { ProviderCallBudget } from '../src/services/provider-usage.js';
import {
  PlaceProviderError,
  type PlaceSuggestion,
  type PlaceTextSearchProvider,
  type ProviderPlaceSearchResult,
} from '../src/services/places.js';
import { setAiPlanningTelemetrySink } from '../src/services/ai-planning-telemetry.js';
import {
  nameMatchTier,
  rankPlaceMatches,
  sameIdentityName,
} from '../src/services/place-identity-matching.js';

const NOW = new Date('2026-10-11T10:00:00Z');
const bias = { latitude: 13.75, longitude: 100.5, radiusMeters: 50_000 };
function candidate(overrides: Partial<AiPlaceGroundingCandidate> = {}): AiPlaceGroundingCandidate {
  return {
    id: 'wat',
    name: 'Wat Pho',
    searchQuery: 'Wat Pho Bangkok Thailand',
    localityHint: 'Bangkok, Thailand',
    note: null,
    locationBias: bias,
    ...overrides,
  };
}
function place(overrides: Partial<ProviderPlaceSearchResult> = {}): ProviderPlaceSearchResult {
  return {
    externalPlaceId: 'wat-pho-id',
    name: 'วัดพระเชตุพนวิมลมังคลารามราชวรมหาวิหาร',
    formattedAddress: 'Bangkok, Thailand',
    location: { latitude: 13.7465, longitude: 100.4933 },
    addressComponents: [
      { longText: 'กรุงเทพมหานคร', shortText: 'Bangkok', types: ['locality'] },
      { longText: 'Thailand', shortText: 'TH', types: ['country'] },
    ],
    rawTypes: ['tourist_attraction', 'place_of_worship'],
    primaryType: 'place_of_worship',
    provider: 'google',
    category: 'things_to_do',
    attributions: [],
    googleMapsUri: null,
    utcOffsetMinutes: 420,
    ...overrides,
  };
}
function suggestion(name: string, externalPlaceId = 'wat-pho-id'): PlaceSuggestion {
  return {
    name,
    externalPlaceId,
    fullText: `${name}, Bangkok, Thailand`,
    description: 'Bangkok, Thailand',
    rawTypes: ['tourist_attraction'],
    provider: 'google',
    category: 'things_to_do',
  };
}
function setup(provider: Partial<PlaceTextSearchProvider> = {}, cached = false) {
  const entries = new Map<string, GroundingCacheEntry>();
  const canonical = vi.fn(
    async (
      identity: ProviderPlaceSearchResult,
      options?: { fetchedAt?: Date; languageCode?: string },
    ) => {
      reference = {
        id: 'ref',
        placeId: 'canonical',
        provider: 'GOOGLE' as const,
        externalPlaceId: identity.externalPlaceId,
        cachedName: identity.name,
        cachedFormattedAddress: identity.formattedAddress,
        cachedLatitude: Number(identity.location.latitude.toFixed(6)),
        cachedLongitude: Number(identity.location.longitude.toFixed(6)),
        cachedTypes: identity.rawTypes,
        cachedAt: options?.fetchedAt,
        cachedLanguageCode: options?.languageCode,
      };
      return { id: 'canonical' };
    },
  );
  let reference: GroundingCacheEntry['placeProviderRef'] = null;
  const cache: AiPlaceGroundingCacheRepository = {
    async read(key) {
      const entry = entries.get(key);
      return entry
        ? { ...entry, placeProviderRef: entry.outcome === 'verified' ? reference : null }
        : null;
    },
    async write(key, value: GroundingCacheWrite) {
      entries.set(key, { ...value, placeProviderRef: null });
    },
  };
  const textSearch = vi.fn(async () => [place()]);
  const search = vi.fn(async () => [suggestion('Wat Pho')]);
  const api = { name: 'google' as const, textSearch, search, ...provider };
  const create = () =>
    new AiPlaceGrounder(
      api,
      { resolveProviderPlaceFromIdentity: canonical },
      () => NOW,
      cached ? cache : null,
    );
  return {
    grounder: create(),
    create,
    textSearch,
    search,
    canonical,
    entries,
    reference: () => reference,
  };
}

test.each([
  ['Wat Pho', 'วัดพระเชตุพนวิมลมังคลารามราชวรมหาวิหาร'],
  ['Jim Thompson House Museum', 'พิพิธภัณฑ์บ้าน จิม ทอมป์สัน'],
])('%s resolves its Google alternate name by the same provider ID', async (name, official) => {
  const api = setup({
    textSearch: vi.fn(async () => [place({ name: official })]),
    search: vi.fn(async () => [suggestion(name)]),
  });
  const result = await api.grounder.groundCandidate(
    candidate({ name, searchQuery: `${name}, Bangkok, Thailand` }),
  );
  expect(result.place).toMatchObject({
    resolution: 'verified',
    name: official,
    placeId: 'canonical',
  });
  expect(api.canonical).toHaveBeenCalledOnce();
});

test('a known official search name resolves on the first pass without autocomplete', async () => {
  const api = setup();
  const result = await api.grounder.groundCandidate(candidate({ searchName: place().name }));
  expect(result.place.resolution).toBe('verified');
  expect(api.search).not.toHaveBeenCalled();
  expect(api.textSearch).toHaveBeenCalledWith(
    expect.objectContaining({ pageSize: 20, textQuery: `${place().name}, Bangkok, Thailand` }),
  );
});

test.each([
  'Jím Thompson House Museum',
  'Jim-Thompson House Museum',
  'Jim Thompson Museum House',
  'Jim Thompson House Musem',
])('normalization and minor differences handle %s with geography', async (name) => {
  const api = setup({ textSearch: async () => [place({ name: 'Jim Thompson House Museum' })] });
  expect((await api.grounder.groundCandidate(candidate({ name }))).place.resolution).toBe(
    'verified',
  );
  expect(api.search).not.toHaveBeenCalled();
});

test('the same English name in another city in the same country is rejected', async () => {
  const api = setup({
    textSearch: async () => [
      place({
        name: 'Wat Pho',
        formattedAddress: 'Chiang Mai, Thailand',
        location: { latitude: 18.79, longitude: 98.98 },
        addressComponents: [
          { longText: 'Chiang Mai', shortText: 'Chiang Mai', types: ['locality'] },
          { longText: 'Thailand', shortText: 'TH', types: ['country'] },
        ],
      }),
    ],
  });
  expect((await api.grounder.groundCandidate(candidate())).place.resolution).toBe('custom');
  expect(api.canonical).not.toHaveBeenCalled();
});

test('country-only locality and provider ranking alone cannot verify a place', async () => {
  const api = setup({ textSearch: async () => [place({ name: 'Wat Pho' })] });
  expect(
    (
      await api.grounder.groundCandidate(
        candidate({ localityHint: 'Thailand', locationBias: undefined }),
      )
    ).place.resolution,
  ).toBe('custom');
  expect(
    (
      await api.grounder.groundCandidate(
        candidate({ localityHint: undefined, locationBias: undefined }),
      )
    ).place.resolution,
  ).toBe('custom');
});

test('two neighboring branches remain ambiguous even after autocomplete', async () => {
  const api = setup({
    textSearch: async () => [
      place({ name: 'Cafe Amber', externalPlaceId: 'a' }),
      place({ name: 'Cafe Amber', externalPlaceId: 'b' }),
    ],
    search: async () => [suggestion('Cafe Amber', 'a'), suggestion('Cafe Amber', 'b')],
  });
  expect(
    (await api.grounder.groundCandidate(candidate({ name: 'Cafe Amber' }))).evidence.code,
  ).toBe('place_ambiguous');
  expect(api.canonical).not.toHaveBeenCalled();
});

test('an unknown autocomplete ID never triggers a third lookup or becomes canonical', async () => {
  const api = setup({ search: async () => [suggestion('Wat Pho', 'new-id')] });
  expect((await api.grounder.groundCandidate(candidate())).place.resolution).toBe('custom');
  expect(api.textSearch).toHaveBeenCalledOnce();
  expect(api.canonical).not.toHaveBeenCalled();
});

test('empty results receive one clean-name Text Search recovery', async () => {
  const textSearch = vi
    .fn()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([place({ name: 'Wat Pho' })]);
  const api = setup({ textSearch });
  expect(
    (
      await api.grounder.groundCandidate(
        candidate({ searchQuery: 'Reclining Buddha visit Bangkok' }),
      )
    ).place.resolution,
  ).toBe('verified');
  expect(textSearch).toHaveBeenCalledTimes(2);
  expect(textSearch.mock.calls[1]![0].textQuery).toBe('Wat Pho, Bangkok, Thailand');
  expect(api.search).not.toHaveBeenCalled();
});

test('an identical recovery query costs no additional search', async () => {
  const textSearch = vi.fn(async () => []);
  const api = setup({ textSearch });
  await api.grounder.groundCandidate(candidate({ searchQuery: 'Wat Pho, Bangkok, Thailand' }));
  expect(textSearch).toHaveBeenCalledOnce();
  expect(api.search).not.toHaveBeenCalled();
});

test('all initial queries precede retries and repeated places share both requests', async () => {
  const calls: string[] = [];
  const api = setup({
    textSearch: async (request) => {
      calls.push(`text:${request.textQuery}`);
      return [place()];
    },
    search: async (request) => {
      calls.push(`auto:${request.input}`);
      return [suggestion('Wat Pho')];
    },
  });
  await api.grounder.groundCandidates([
    candidate(),
    candidate({ id: 'duplicate' }),
    candidate({ id: 'other', name: 'Another Temple', searchQuery: 'Another Temple Bangkok' }),
  ]);
  expect(calls.map((call) => call.split(':')[0])).toEqual(['text', 'text', 'auto', 'auto']);
});

test.each(['budget_exhausted', 'quota_exceeded', 'configuration_missing'] as const)(
  'provider failure %s does not retry or poison the negative cache',
  async (code) => {
    const textSearch = vi.fn(async () => {
      throw new PlaceProviderError(code);
    });
    const api = setup({ textSearch }, true);
    const result = await api.grounder.groundCandidate(candidate());
    expect(result.place).toMatchObject({ resolution: 'custom', verification: 'not_checked' });
    expect(textSearch).toHaveBeenCalledOnce();
    expect(api.search).not.toHaveBeenCalled();
    expect(api.entries.size).toBe(0);
  },
);

test('cancellation between initial search and retry prevents further requests and caching', async () => {
  const controller = new AbortController();
  const api = setup(
    {
      textSearch: async () => {
        controller.abort('provider_time_allowance_exhausted');
        return [place()];
      },
    },
    true,
  );
  expect(
    (await api.grounder.groundCandidate(candidate({ signal: controller.signal }))).evidence.code,
  ).toBe('provider_time_allowance_exhausted');
  expect(api.search).not.toHaveBeenCalled();
  expect(api.entries.size).toBe(0);
});

test('a failed recovery is not cached as unresolved', async () => {
  const api = setup(
    {
      search: async () => {
        throw new PlaceProviderError('budget_exhausted');
      },
    },
    true,
  );
  expect((await api.grounder.groundCandidate(candidate())).evidence.code).toBe(
    'provider_cap_reached',
  );
  expect(api.entries.size).toBe(0);
});

test('alias decisions reuse the original snapshot, and a changed snapshot invalidates them', async () => {
  const api = setup({}, true);
  const first = await api.grounder.groundCandidate(candidate());
  const second = await api.create().groundCandidate(candidate());
  expect(first.place.resolution).toBe('verified');
  expect(second.evidence.checkedAt).toBe(NOW.toISOString());
  expect(api.textSearch).toHaveBeenCalledOnce();
  expect(api.search).toHaveBeenCalledOnce();
  api.reference()!.cachedName = 'A different temple';
  await api.create().groundCandidate(candidate());
  expect(api.textSearch).toHaveBeenCalledTimes(2);
  expect(api.search).toHaveBeenCalledTimes(2);
});

test('missing fingerprint and new candidate hints cannot reuse old decisions', async () => {
  const api = setup({}, true);
  await api.grounder.groundCandidate(candidate());
  for (const entry of api.entries.values()) entry.identityFingerprint = null;
  await api.create().groundCandidate(candidate());
  await api.create().groundCandidate(candidate({ searchName: 'Known local name' }));
  expect(api.textSearch).toHaveBeenCalledTimes(3);
});

test('a distant excursion is eligible through its own locality, not a hard 50 km boundary', async () => {
  const api = setup({
    textSearch: async () => [
      place({
        name: 'Ancient Palace',
        location: { latitude: 14.35, longitude: 100.56 },
        addressComponents: [{ longText: 'Ayutthaya', shortText: 'Ayutthaya', types: ['locality'] }],
      }),
    ],
  });
  expect(
    (
      await api.grounder.groundCandidate(
        candidate({ name: 'Ancient Palace', localityHint: 'Ayutthaya, Thailand' }),
      )
    ).place.resolution,
  ).toBe('verified');
});

test('destination candidates cannot resolve to similarly named venues', async () => {
  const api = setup({ textSearch: async () => [place({ name: 'Bangkok' })] });
  expect(
    (await api.grounder.groundCandidate(candidate({ name: 'Bangkok', requireExactName: true })))
      .place.resolution,
  ).toBe('custom');
});

test('nearby coordinates cannot override a known wrong city', async () => {
  const api = setup({
    textSearch: async () => [
      place({
        name: 'Wat Pho',
        addressComponents: [
          { longText: 'Ayutthaya', shortText: 'Ayutthaya', types: ['locality'] },
          { longText: 'Thailand', shortText: 'TH', types: ['country'] },
        ],
      }),
    ],
  });
  expect((await api.grounder.groundCandidate(candidate())).place.resolution).toBe('custom');
  expect(api.canonical).not.toHaveBeenCalled();
});

test('an exact street/address name cannot tie with its attraction', () => {
  const venue = place({ name: 'National Park', rawTypes: ['national_park'] });
  const address = place({
    name: 'National Park',
    externalPlaceId: 'address',
    rawTypes: ['premise', 'street_address'],
  });
  expect(rankPlaceMatches([address, venue], candidate({ name: 'National Park' }))).toEqual([venue]);
});

test('a stay resolves to the hotel, not the restaurant that shares its name', () => {
  const hotel = place({ name: 'Park Hyatt Tokyo', rawTypes: ['hotel', 'lodging'] });
  const restaurant = place({
    name: 'Park Hyatt Tokyo',
    externalPlaceId: 'restaurant',
    rawTypes: ['restaurant', 'food'],
  });
  const context = candidate({ name: 'Park Hyatt Tokyo' });
  expect(rankPlaceMatches([hotel, restaurant], context)).toHaveLength(2);
  expect(rankPlaceMatches([hotel, restaurant], { ...context, preferLodging: true })).toEqual([
    hotel,
  ]);
});

test('contracted words need multiple agreeing complete words', () => {
  expect(
    nameMatchTier('Mount John Observatory', 'University of Canterbury Mt John Observatory'),
  ).toBe(2);
  expect(nameMatchTier('North Museum', 'Nth Museum')).toBe(0);
  expect(nameMatchTier('Museum North Gate', 'Museum South Gate')).toBe(0);
  expect(nameMatchTier('Tasman Glacier Viewpoint', 'Tasman Glacier View')).toBe(1);
  expect(nameMatchTier('Tasman Glacier Viewpoint', 'Tasman Glacier View Cafe')).toBe(0);
});

test('a natural feature without a city component can use corroborated region and country', () => {
  const feature = place({
    name: 'Queenstown Bay Beach',
    rawTypes: ['beach', 'natural_feature'],
    location: { latitude: -45, longitude: 168.7 },
    addressComponents: [
      {
        longText: 'Otago Region',
        shortText: 'Otago Region',
        types: ['administrative_area_level_1'],
      },
      { longText: 'New Zealand', shortText: 'NZ', types: ['country'] },
    ],
  });
  const context = candidate({
    name: feature.name,
    localityHint: 'Queenstown, Otago, New Zealand',
    locationBias: undefined,
    countryCode: 'NZ',
  });
  expect(rankPlaceMatches([feature], context)).toEqual([feature]);
  expect(
    rankPlaceMatches([feature], { ...context, localityHint: 'Queenstown, New Zealand' }),
  ).toEqual([]);
  expect(
    rankPlaceMatches(
      [
        {
          ...feature,
          addressComponents: [
            ...feature.addressComponents!,
            { longText: 'Dunedin', shortText: 'Dunedin', types: ['locality'] },
          ],
        },
      ],
      context,
    ),
  ).toEqual([]);
});

test('a city remains a valid named stop, while an equally named attraction has compatible venue types', () => {
  const city = place({ name: 'Lake Tekapo', rawTypes: ['locality', 'political'] });
  expect(rankPlaceMatches([city], candidate({ name: 'Lake Tekapo' }))).toEqual([city]);
  const sound = place({
    name: 'Milford Sound / Piopiotahi',
    rawTypes: ['natural_feature', 'establishment'],
  });
  const locality = place({
    name: 'Milford Sound',
    rawTypes: ['locality', 'political'],
    externalPlaceId: 'sound-city',
  });
  expect(
    rankPlaceMatches(
      [locality, sound],
      candidate({ name: 'Milford Sound', searchName: sound.name }),
    ),
  ).toEqual([sound]);
});

test('the original attraction name distinguishes a broad model hint from a cafe', () => {
  const track = place({ name: 'Pancake Rocks and Blowholes Track', rawTypes: ['hiking_area'] });
  const cafe = place({ name: 'Pancake Rocks Cafe', externalPlaceId: 'cafe', rawTypes: ['cafe'] });
  expect(
    rankPlaceMatches(
      [cafe, track],
      candidate({ name: 'Pancake Rocks and Blowholes', searchName: 'Pancake Rocks' }),
    ),
  ).toEqual([track]);
});

test('a named trail can resolve an exact route while a street cannot impersonate a venue', () => {
  const trail = place({ name: 'Mount Iron Track', rawTypes: ['route'] });
  expect(rankPlaceMatches([trail], candidate({ name: trail.name }))).toEqual([trail]);
  expect(rankPlaceMatches([trail], candidate({ name: `${trail.name} Visitor Centre` }))).toEqual(
    [],
  );
});

test('a geographic parent cannot replace its viewpoint and receives one clean manual-style retry', async () => {
  const parent = place({ name: 'Tasman Glacier', rawTypes: ['natural_feature'] });
  const viewpoint = place({
    name: 'Tasman Glacier View Point',
    externalPlaceId: 'viewpoint',
    rawTypes: ['scenic_spot'],
  });
  const textSearch = vi.fn().mockResolvedValueOnce([parent]).mockResolvedValueOnce([viewpoint]);
  const api = setup({ textSearch });
  const result = await api.grounder.groundCandidate(
    candidate({
      name: 'Tasman Glacier Viewpoint',
      searchQuery: 'Tasman Glacier Viewpoint, Bangkok, Thailand',
    }),
  );
  expect(result.context?.externalPlaceId).toBe('viewpoint');
  expect(textSearch).toHaveBeenCalledTimes(2);
  expect(textSearch.mock.calls[1]![0].textQuery).toBe('Tasman Glacier Viewpoint');
  expect(api.search).not.toHaveBeenCalled();
});

test('an approximate excursion locality can use verified destination coordinates without overriding that destination city', () => {
  const summit = place({
    name: 'Crown Range Summit',
    location: { latitude: -45, longitude: 168.9 },
    addressComponents: [
      { longText: 'Roaring Meg', shortText: 'Roaring Meg', types: ['locality'] },
      {
        longText: 'Otago Region',
        shortText: 'Otago Region',
        types: ['administrative_area_level_1'],
      },
      { longText: 'New Zealand', shortText: 'NZ', types: ['country'] },
    ],
  });
  const context = candidate({
    name: summit.name,
    localityHint: 'Cardrona, Otago, New Zealand',
    destinationName: 'Wānaka',
    countryCode: 'NZ',
    locationBias: { latitude: -44.7, longitude: 169.1, radiusMeters: 50_000 },
  });
  expect(rankPlaceMatches([summit], context)).toEqual([summit]);
  expect(rankPlaceMatches([summit], { ...context, destinationName: 'Cardrona' })).toEqual([]);
});

test('the shared Google budget caps all first passes and recoveries at 50 requests', async () => {
  const budget = new ProviderCallBudget();
  let requests = 0;
  const provider = new GooglePlacesProvider({
    apiKey: 'test',
    budget,
    fetcher: async () => {
      requests++;
      return Response.json({ places: [] });
    },
  });
  const grounder = new AiPlaceGrounder(
    provider,
    {
      async resolveProviderPlaceFromIdentity() {
        throw new Error('unexpected');
      },
    },
    () => NOW,
    null,
  );
  const results = await grounder.groundCandidates(
    Array.from({ length: 30 }, (_, i) =>
      candidate({ id: String(i), name: `Unknown ${i}`, searchQuery: `Official ${i} Bangkok` }),
    ),
  );
  expect(requests).toBe(50);
  expect(budget.snapshot().remaining).toBe(0);
  expect(results.filter((result) => result.evidence.code === 'provider_cap_reached')).toHaveLength(
    10,
  );
});

test('reconciliation telemetry contains counts and no query or provider content', async () => {
  const events: unknown[] = [];
  setAiPlanningTelemetrySink((event) => events.push(event));
  try {
    await setup().grounder.groundCandidate(candidate());
  } finally {
    setAiPlanningTelemetrySink(null);
  }
  expect(events).toEqual([
    {
      kind: 'place_reconciliation',
      occurredAt: NOW.toISOString(),
      firstPassMatches: 0,
      recoveredMatches: 1,
      ambiguous: 0,
      unresolved: 0,
      skippedRetries: 0,
    },
  ]);
});

test('a bare unstructured country address never supplies venue locality evidence', async () => {
  const api = setup({
    textSearch: async () => [
      place({ name: 'Wat Pho', formattedAddress: 'Thailand', addressComponents: [] }),
    ],
  });
  expect(
    (
      await api.grounder.groundCandidate(
        candidate({ localityHint: 'Thailand', locationBias: undefined }),
      )
    ).place.resolution,
  ).toBe('custom');
});

test('destination country qualifiers reject a same-named city in the wrong country', async () => {
  const paris = place({
    name: 'Paris',
    rawTypes: ['locality'],
    addressComponents: [
      { longText: 'Paris', shortText: 'Paris', types: ['locality'] },
      { longText: 'Texas', shortText: 'TX', types: ['administrative_area_level_1'] },
      { longText: 'United States', shortText: 'US', types: ['country'] },
    ],
  });
  const api = setup({ textSearch: async () => [paris] });
  expect(
    (
      await api.grounder.groundCandidate(
        candidate({
          name: 'Paris',
          requireExactName: true,
          localityHint: 'Paris, France',
          locationBias: undefined,
        }),
      )
    ).place.resolution,
  ).toBe('custom');
  expect(
    (
      await api.grounder.groundCandidate(
        candidate({
          name: 'Paris',
          requireExactName: true,
          localityHint: 'Paris, Texas, United States',
          locationBias: undefined,
        }),
      )
    ).place.resolution,
  ).toBe('verified');
});

test.each([
  ['Singapore', 'SG'],
  ['Monaco', 'MC'],
])(
  'an explicit %s locality is evidence even when the country has the same name',
  (locality, countryCode) => {
    const identity = place({
      name: 'History Museum',
      addressComponents: [
        { longText: locality, shortText: locality, types: ['locality'] },
        { longText: locality, shortText: countryCode, types: ['country'] },
      ],
    });
    expect(
      rankPlaceMatches([identity], { name: 'History Museum', localityHint: locality }),
    ).toEqual([identity]);
    expect(
      rankPlaceMatches([{ ...identity, addressComponents: identity.addressComponents!.slice(1) }], {
        name: 'History Museum',
        localityHint: locality,
      }),
    ).toEqual([]);
  },
);

test('a missing regional component is unknown, not a contradiction of exact city and country evidence', () => {
  const paris = place({
    name: 'Paris',
    rawTypes: ['locality'],
    addressComponents: [
      { longText: 'Paris', shortText: 'Paris', types: ['locality'] },
      { longText: 'France', shortText: 'FR', types: ['country'] },
    ],
  });
  expect(
    rankPlaceMatches([paris], {
      name: 'Paris',
      localityHint: 'Paris, Île-de-France, France',
      requireExactName: true,
    }),
  ).toEqual([paris]);
  expect(
    rankPlaceMatches([paris], {
      name: 'Paris',
      localityHint: 'Paris, Texas, United States',
      requireExactName: true,
    }),
  ).toEqual([]);
});

test('autocomplete can corroborate a local-language address for an already-fetched exact venue', async () => {
  const textSearch = vi.fn(async () => [
    place({
      name: 'Wat Pho',
      formattedAddress: 'กรุงเทพมหานคร, ประเทศไทย',
      addressComponents: [
        { longText: 'กรุงเทพมหานคร', shortText: 'กรุงเทพมหานคร', types: ['locality'] },
        { longText: 'Thailand', shortText: 'TH', types: ['country'] },
      ],
    }),
  ]);
  const api = setup({ textSearch });
  const result = await api.grounder.groundCandidate(candidate({ locationBias: undefined }));
  expect(result.place.resolution).toBe('verified');
  expect(textSearch).toHaveBeenCalledOnce();
  expect(api.search).toHaveBeenCalledOnce();
});

test('normalization preserves name-bearing marks outside Latin scripts', () => {
  expect(sameIdentityName('ป่า', 'ป้า')).toBe(false);
  expect(nameMatchTier('ป่า', 'ป้า')).toBe(0);
  expect(sameIdentityName('Đà Nẵng', 'Da Nang')).toBe(true);
});

test('a verified destination name supplies local-script context on live and cached decisions', async () => {
  const city = place({
    name: 'กรุงเทพมหานคร',
    rawTypes: ['locality'],
    addressComponents: [
      { longText: 'กรุงเทพมหานคร', shortText: 'กรุงเทพมหานคร', types: ['locality'] },
      { longText: 'Thailand', shortText: 'TH', types: ['country'] },
    ],
  });
  const textSearch = vi.fn(async () => [city]);
  const api = setup({ textSearch }, true);
  const destination = candidate({
    id: 'destination',
    name: 'Bangkok',
    searchName: city.name,
    requireExactName: true,
    locationBias: undefined,
  });
  const live = await api.grounder.groundCandidate(destination);
  const cached = await api.create().groundCandidate(destination);
  expect(live.context?.localityName).toBe(city.name);
  expect(cached.context?.localityName).toBe(city.name);
  expect(textSearch).toHaveBeenCalledOnce();
  const venue = place({ name: 'Wat Pho', addressComponents: city.addressComponents });
  expect(
    rankPlaceMatches([venue], {
      name: 'Wat Pho',
      localityHint: 'Bangkok',
      destinationName: cached.context!.localityName,
    }),
  ).toEqual([venue]);
});

test('Autocomplete locality evidence cannot override a provider country conflict', async () => {
  const api = setup({
    textSearch: async () => [
      place({
        name: 'Wat Pho',
        addressComponents: [
          { longText: 'Paris', shortText: 'Paris', types: ['locality'] },
          { longText: 'France', shortText: 'FR', types: ['country'] },
        ],
      }),
    ],
  });
  expect(
    (await api.grounder.groundCandidate(candidate({ countryCode: 'TH' }))).place.resolution,
  ).toBe('custom');
  expect(api.search).not.toHaveBeenCalled();
  expect(api.canonical).not.toHaveBeenCalled();
});
