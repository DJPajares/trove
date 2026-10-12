import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import type { AiPlannerDraft } from '@trove/types';

import {
  runAiPlanningPipeline,
  type AiPlanningPipelineOptions,
} from '../src/services/ai-planning-pipeline.js';
import { suggestedDraftCountries } from '../src/services/ai-planning-countries.js';
import {
  PlaceProviderError,
  PlacesService,
  type PlaceTextSearchProvider,
  type ProviderPlaceSearchResult,
} from '../src/services/places.js';
import { ProviderCallBudget } from '../src/services/provider-usage.js';
import { emptyPlanScore } from './fixtures/ai-planning.js';

vi.mock('../src/services/canonical-places.js', () => ({
  createCanonicalPlacesService: () => ({
    resolveProviderPlaceFromIdentity: async () => ({ id: randomUUID() }),
  }),
}));
vi.mock('../src/services/ai-place-grounding-cache.js', () => ({
  PrismaAiPlaceGroundingCacheRepository: class {
    async read() {
      return null;
    }
    async write() {}
  },
}));
vi.mock('../src/services/place-evidence-cache.js', async (original) => ({
  ...(await original<typeof import('../src/services/place-evidence-cache.js')>()),
  storePlaceEvidence: async () => {},
}));

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/south-island-planner.json', import.meta.url), 'utf8'),
);
const NOW = new Date('2026-10-11T17:00:00Z');

/** Hand-authored provider doubles reproduce observed shapes, without retained
 * Google IDs, responses, ratings, hours, or exact coordinates. The model output
 * and unchanged traveller prompt are the captured seven-day regression case. */
function identity(
  id: string,
  name: string,
  city: string | null,
  region: string,
  types: string[],
  latitude: number,
  longitude: number,
): ProviderPlaceSearchResult {
  return {
    externalPlaceId: `fixture:${id}`,
    name,
    provider: 'google',
    formattedAddress: [city, region, 'New Zealand'].filter(Boolean).join(', '),
    location: { latitude, longitude },
    rawTypes: types,
    primaryType: types[0]!,
    category: 'things_to_do',
    attributions: [],
    googleMapsUri: null,
    utcOffsetMinutes: 780,
    addressComponents: [
      ...(city ? [{ longText: city, shortText: city, types: ['locality'] }] : []),
      { longText: region, shortText: region, types: ['administrative_area_level_1'] },
      { longText: 'New Zealand', shortText: 'NZ', types: ['country'] },
    ],
  };
}

test('the exact South Island prompt reconciles its entire seven-day schedule with one model call and one alias recovery', async () => {
  const budget = new ProviderCallBudget();
  const acquired: string[] = [];
  const rows = [
    [
      'Lake Tekapo',
      identity(
        'tekapo',
        'Lake Tekapo',
        'Lake Tekapo',
        'Canterbury Region',
        ['locality', 'political'],
        -44,
        170.5,
      ),
    ],
    [
      'Wanaka',
      identity(
        'wanaka',
        'Wānaka',
        'Wānaka',
        'Otago Region',
        ['locality', 'political'],
        -44.7,
        169.1,
      ),
    ],
    [
      'Queenstown',
      identity(
        'queenstown',
        'Queenstown',
        'Queenstown',
        'Otago Region',
        ['locality', 'political'],
        -45,
        168.7,
      ),
    ],
    [
      'New Zealand South Island',
      identity(
        'island',
        'Te Waipounamu / South Island',
        null,
        '',
        ['island', 'natural_feature'],
        -45.2,
        169.9,
      ),
    ],
    [
      'Christchurch Botanic Gardens',
      identity(
        'gardens',
        'Christchurch Botanic Gardens',
        'Christchurch',
        'Canterbury Region',
        ['botanical_garden'],
        -43.6,
        172.6,
      ),
    ],
    [
      'Riverside Market',
      identity(
        'market',
        'Riverside Market',
        'Christchurch',
        'Canterbury Region',
        ['market'],
        -43.6,
        172.6,
      ),
    ],
    [
      'Christchurch Railway Station',
      identity(
        'station',
        'Christchurch Railway Station',
        'Christchurch',
        'Canterbury Region',
        ['train_station'],
        -43.6,
        172.6,
      ),
    ],
    [
      'Church of the Good Shepherd',
      identity(
        'church',
        'The Church of the Good Shepherd',
        'Lake Tekapo',
        'Canterbury Region',
        ['church'],
        -44,
        170.5,
      ),
    ],
    [
      'Mount John Observatory',
      identity(
        'observatory',
        'University of Canterbury Mt John Observatory',
        'Tekapo',
        'Canterbury Region',
        ['tourist_attraction'],
        -44.02,
        170.48,
      ),
    ],
    [
      'Aoraki / Mount Cook National Park',
      identity(
        'park',
        'Aoraki/Mount Cook National Park',
        null,
        'Canterbury Region',
        ['national_park'],
        -43.6,
        170.3,
      ),
    ],
    [
      'That Wanaka Tree',
      identity(
        'tree',
        'Wānaka Willow Tree',
        'Wānaka',
        'Otago Region',
        ['scenic_spot'],
        -44.7,
        169.1,
      ),
    ],
    [
      'Crown Range Summit',
      identity(
        'summit',
        'Crown Range Summit',
        'Roaring Meg',
        'Otago Region',
        ['landmark'],
        -45,
        168.9,
      ),
    ],
    [
      'Milford Sound / Piopiotahi',
      identity(
        'sound',
        'Milford Sound / Piopiotahi',
        null,
        'Southland Region',
        ['natural_feature'],
        -44.6,
        167.9,
      ),
    ],
  ] as const;
  const claimCall = () => {
    if (!budget.claim()) throw new PlaceProviderError('budget_exhausted');
  };
  const textSearch = vi.fn<PlaceTextSearchProvider['textSearch']>(async (request) => {
    claimCall();
    expect(request.pageSize).toBe(20);
    const entry = rows.find(([query]) => request.textQuery.startsWith(query));
    if (!entry) throw new Error(`Unexpected reconciliation query: ${request.textQuery}`);
    const result = structuredClone(entry[1]);
    acquired.push(result.externalPlaceId);
    if (request.detail === 'evidence')
      result.evidence = {
        openingPeriods: [{ open: { day: 0, hour: 0, minute: 0 }, close: null }],
        rating: null,
      };
    if (result.externalPlaceId === 'fixture:park')
      return [
        result,
        {
          ...result,
          externalPlaceId: 'fixture:park-address',
          rawTypes: ['premise', 'street_address'],
        },
      ];
    if (result.externalPlaceId === 'fixture:sound')
      return [
        result,
        {
          ...result,
          name: 'Milford Sound',
          externalPlaceId: 'fixture:sound-locality',
          rawTypes: ['locality', 'political'],
        },
      ];
    return [result];
  });
  const search = vi.fn<NonNullable<PlaceTextSearchProvider['search']>>(async (request) => {
    claimCall();
    expect(request.input).toBe('That Wanaka Tree');
    return [
      {
        name: 'That Wanaka Tree',
        description: 'Wānaka, New Zealand',
        fullText: 'That Wanaka Tree, Wānaka, New Zealand',
        externalPlaceId: 'fixture:tree',
        rawTypes: ['scenic_spot'],
        provider: 'google',
        category: 'things_to_do',
      },
    ];
  });
  const getDetails = vi.fn(async () => {
    throw new Error('Rich Text Search evidence must be reused');
  });
  const provider = { name: 'google' as const, textSearch, search, getDetails };
  const gateway = {
    generateStructured: vi.fn(async () => ({
      output: fixture.output,
      metadata: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        latencyMs: 1,
        model: 'fixture',
        provider: 'vertex' as const,
      },
    })),
  };
  let draft: AiPlannerDraft | undefined;
  const failures: string[] = [];
  const lifecycle: NonNullable<AiPlanningPipelineOptions['lifecycle']> = {
    async claim() {
      return {
        sessionId: 'fixture:session',
        runId: 'fixture:run',
        baseDraftRevision: 0,
        maxItineraryDays: 20,
        deadlineAt: new Date(NOW.getTime() + 60_000),
        prompt: fixture.prompt,
        model: 'fixture',
        provider: 'vertex',
      };
    },
    async updateStage() {},
    async completeFailure(_owner, _run, code) {
      failures.push(code);
    },
    async completeSuccess(_owner, _run, result) {
      draft = result;
      return { draftRevision: 1, sessionId: 'fixture:session' };
    },
  };
  await runAiPlanningPipeline('fixture:owner', 'fixture:run', {
    clock: () => NOW,
    gateway,
    lifecycle,
    loadHomeLocation: async () => null,
    loadSavedPlaces: async () => [],
    providerContext: {
      placesProvider: provider,
      placesService: new PlacesService(provider, () => NOW),
      routesService: null,
    },
    readDraftScore: async () => emptyPlanScore(),
  });
  expect(failures).toEqual([]);
  expect(gateway.generateStructured).toHaveBeenCalledTimes(1);
  expect(draft!.days).toHaveLength(7);
  expect(draft!.evidence.filter((entry) => entry.kind === 'identity')).toHaveLength(13);
  expect(
    draft!.evidence
      .filter((entry) => entry.kind === 'identity')
      .every((entry) => entry.status === 'verified'),
  ).toBe(true);
  expect(
    draft!.places.find((place) => place.name === 'Aoraki/Mount Cook National Park')?.resolution,
  ).toBe('verified');
  expect(
    draft!.places.find((place) => place.name === 'Milford Sound / Piopiotahi')?.resolution,
  ).toBe('verified');
  expect(new Set(acquired).size).toBe(13);
  expect(textSearch).toHaveBeenCalledTimes(13);
  expect(search).toHaveBeenCalledTimes(1);
  expect(getDetails).not.toHaveBeenCalled();
  expect(budget.snapshot().used).toBe(14);
  expect(suggestedDraftCountries(draft!)).toEqual(['NZ']);
});
