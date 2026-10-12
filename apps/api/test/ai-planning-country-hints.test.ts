import { expect, test } from 'vitest';
import { parseAiPlannerDraft } from '@trove/types';
import {
  addDraftCountryAssumptions,
  suggestedDraftCountries,
  suggestedDraftCountriesFromStoredPlaces,
} from '../src/services/ai-planning-countries.js';
import { applyGroundingToDraft } from '../src/services/ai-planning-pipeline.js';
import { repairCompactOutput } from '../src/services/ai-planner-repair.js';
import {
  compactModelProposal,
  explicitDraft,
  explicitModelProposal,
} from './fixtures/ai-planning.js';

test('structured countries survive failed reconciliation and translated destination names', async () => {
  const draft = explicitDraft();
  const destination = draft.places.find(
    (place) => place.id === draft.trip.destinations[0]!.placeRefId,
  )!;
  const hinted = {
    id: destination.id,
    name: '開普敦',
    note: null,
    resolution: 'custom' as const,
    verification: 'unverified' as const,
    countryCodeHint: 'ZA',
  };
  draft.places = [hinted];
  draft.days.forEach((day) => (day.items = []));
  let reads = 0;
  expect(suggestedDraftCountries(draft)).toEqual(['ZA']);
  expect(
    await suggestedDraftCountriesFromStoredPlaces(draft, {
      place: {
        findMany: async () => {
          reads++;
          throw new Error('unavailable');
        },
      },
    } as never),
  ).toEqual(['ZA']);
  expect(reads).toBe(0);
  addDraftCountryAssumptions(draft);
  expect(draft.assumptions).toContainEqual(
    expect.objectContaining({ code: 'country_inferred', value: ['ZA'] }),
  );
});

test('provider country wins over a contradictory hint for the same place', () => {
  const draft = explicitDraft();
  const destination = draft.places.find(
    (place) => place.id === draft.trip.destinations[0]!.placeRefId,
  )!;
  Object.assign(destination, { countryCode: 'JP', countryCodeHint: 'ZA' });
  expect(suggestedDraftCountries(draft)).toEqual(['JP']);
});

test('legacy stored provider addresses win over hints without making provider requests', async () => {
  const draft = explicitDraft();
  draft.places.forEach((place) => (place.countryCodeHint = 'ZA'));
  const countries = await suggestedDraftCountriesFromStoredPlaces(draft, {
    place: {
      findMany: async () =>
        draft.places.flatMap((place) =>
          place.resolution === 'verified'
            ? [{ id: place.placeId, providerAddress: 'Tokyo, Japan' }]
            : [],
        ),
    },
  } as never);
  expect(countries).toEqual(['JP']);
});

test('country hints count visited stays and stops, excluding transport origins and unscheduled ideas', () => {
  const draft = explicitDraft();
  draft.places = [
    {
      id: 'base',
      name: 'Cape Town',
      resolution: 'custom',
      verification: 'not_checked',
      note: null,
      countryCodeHint: 'ZA',
    },
    {
      id: 'stay',
      name: 'Stay',
      resolution: 'custom',
      verification: 'unverified',
      note: null,
      countryCodeHint: 'BW',
    },
    {
      id: 'stop',
      name: 'Stop',
      resolution: 'custom',
      verification: 'unverified',
      note: null,
      countryCodeHint: 'NA',
    },
    {
      id: 'origin',
      name: 'Airport',
      resolution: 'custom',
      verification: 'not_checked',
      note: null,
      countryCodeHint: 'GB',
    },
    {
      id: 'idea',
      name: 'Idea',
      resolution: 'custom',
      verification: 'not_checked',
      note: null,
      countryCodeHint: 'FR',
    },
  ];
  draft.trip.destinations[0]!.placeRefId = 'base';
  const item = draft.days[1]!.items[0]!;
  draft.days.forEach((day) => (day.items = []));
  draft.days[0]!.dailyBasePlaceRefId = 'stay';
  draft.days[1]!.items = [
    { ...item, placeRefId: 'stop' },
    { ...item, id: 'transport', blockType: 'transport', placeRefId: 'origin' },
  ];
  draft.unscheduledItems = [{ ...item, placeRefId: 'idea' }];
  expect(suggestedDraftCountries(draft)).toEqual(['ZA', 'BW', 'NA']);
});

test('repair normalizes ISO hints and discards malformed or unsupported values', () => {
  for (const [input, expected] of [
    [' za ', 'ZA'],
    ['NZ', 'NZ'],
    ['XX', null],
    ['South Africa', null],
    [45, null],
  ] as const) {
    const proposal = compactModelProposal(explicitModelProposal());
    Object.assign(proposal.places[0]!, { countryCodeHint: input });
    expect(repairCompactOutput(proposal, 'Plan Tokyo')?.places[0]?.countryCodeHint).toBe(expected);
  }
});

test('grounding replacements retain hints without claiming verified identity', () => {
  const draft = explicitDraft();
  const place = draft.places[0]!;
  place.countryCodeHint = 'NZ';
  applyGroundingToDraft(draft, [
    {
      context: null,
      place: {
        id: place.id,
        name: 'Unresolved',
        resolution: 'custom',
        verification: 'not_checked',
        note: null,
      },
      evidence: {
        checkedAt: null,
        code: null,
        id: 'evidence:hint',
        kind: 'identity',
        provider: null,
        status: 'not_checked',
        subjectId: place.id,
        subjectType: 'place',
      },
      warnings: [],
    },
  ]);
  expect(draft.places[0]).toMatchObject({ countryCodeHint: 'NZ', resolution: 'custom' });
});

test('old drafts without country hints remain valid', () => {
  expect(parseAiPlannerDraft(explicitDraft()).success).toBe(true);
});
