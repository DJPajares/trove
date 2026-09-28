import {
  AI_PLANNER_MAX_REAL_PLACE_ITEMS,
  AI_PLANNER_MAX_TRIP_DESCRIPTION,
  AI_PLANNER_TRIP_LENGTH_TIERS,
  aiPlannerNormalizedRequestSchema,
} from '@trove/types';
import { expect, test } from 'vitest';

import {
  AI_PLANNER_ITEMS_PER_DAY,
  AI_PLANNER_NAME_TONES,
  AI_PLANNER_SCHEMA_DESCRIPTION,
  buildAiPlannerContext,
  buildAiPlannerPrompt,
  coveredDayCount,
  isSparseProposal,
  pickAiPlannerNameTone,
} from '../src/services/ai-planner-prompt.js';
import {
  AI_PLANNER_DEFAULT_PACE,
  AI_PLANNER_DEFAULT_PARTY_SIZE,
  AI_PLANNER_DEFAULT_TRIP_LENGTH_DAYS,
} from '../src/services/ai-planning-rules.js';

const GENERATION_DATE = new Date('2026-09-01T12:00:00.000Z');

// The tone is pinned everywhere below: an unpinned context picks a fresh one
// per call, and two calls in the same assertion would not match.
function context(homeLocation: string | null = null) {
  return buildAiPlannerContext({
    generationDate: GENERATION_DATE,
    homeLocation,
    nameTone: 'understated',
  });
}

test('the planner context resolves every default the model would otherwise invent', () => {
  expect(context('Auckland')).toStrictEqual({
    defaults: {
      durationDays: AI_PLANNER_DEFAULT_TRIP_LENGTH_DAYS,
      pace: AI_PLANNER_DEFAULT_PACE,
      partySize: AI_PLANNER_DEFAULT_PARTY_SIZE,
    },
    generationDate: '2026-09-01',
    destinationContext: { catalogVersion: '2026-09-28.1', records: [] },
    homeLocation: 'Auckland',
    itemsPerDay: AI_PLANNER_ITEMS_PER_DAY,
    maxRealPlaceItems: AI_PLANNER_MAX_REAL_PLACE_ITEMS,
    maxTripDescription: AI_PLANNER_MAX_TRIP_DESCRIPTION,
    naming: { tone: 'understated', toneBrief: AI_PLANNER_NAME_TONES.understated },
    tripLengthTiers: AI_PLANNER_TRIP_LENGTH_TIERS,
  });
});

/**
 * A title is the first thing the traveller reads back, and a model asked to vary
 * its own tone does not. Rotating the tone here is what makes two plans for the
 * same city arrive under two different names, so the rotation is the assertion.
 */
test('the naming tone rotates across runs and every tone carries a brief', () => {
  const tones = Object.keys(AI_PLANNER_NAME_TONES);

  expect(tones.length).toBeGreaterThan(1);
  expect(Object.values(AI_PLANNER_NAME_TONES).every((brief) => brief.trim().length > 0)).toBe(true);
  expect(tones.map((_, index) => pickAiPlannerNameTone(() => index / tones.length))).toStrictEqual(
    tones,
  );
  // Math.random() can return values arbitrarily close to 1 without reaching it.
  expect(tones).toContain(pickAiPlannerNameTone(() => 0.999_999));
});

test('the prompt names the trip in the tone the context picked', () => {
  const prompt = buildAiPlannerPrompt('Five days in Tokyo', context());

  expect(prompt).toContain('planner_context.naming.tone');
  expect(prompt).toContain('short tripName in planner_context.naming.tone');
  expect(prompt).toContain('Avoid generic titles');
});

test('every pace the schema accepts has an item band', () => {
  const paces = aiPlannerNormalizedRequestSchema.shape.pace.unwrap().options;

  expect(Object.keys(AI_PLANNER_ITEMS_PER_DAY).toSorted()).toStrictEqual([...paces].toSorted());
});

test('the prompt carries the traveller request and the resolved context as data', () => {
  const prompt = buildAiPlannerPrompt('Five days in Tokyo', context());

  expect(prompt).toContain(`traveller_request=${JSON.stringify('Five days in Tokyo')}`);
  expect(prompt).toContain(`planner_context=${JSON.stringify(context())}`);
  expect(prompt).toContain('untrusted traveller data');
});

test('the prompt keeps the integrity rules that keep a proposal applicable', () => {
  const prompt = buildAiPlannerPrompt('Five days in Tokyo', context());

  expect(prompt).toContain('Every non-null index must point to an existing entry');
  expect(prompt).toContain('cannot be must_go or user_owned');
  expect(prompt).toContain('strength "flexible"');
});

/**
 * The model measurably ignores coverage when it sits among the integrity rules,
 * returning a single populated day. Ordering is the fix, so it is the assertion.
 */
test('the coverage requirement is the last instruction before the context', () => {
  const prompt = buildAiPlannerPrompt('Five days in Tokyo', context());
  const instructions = prompt
    .split('\n')
    .filter(
      (line) =>
        line.trim() &&
        !line.startsWith('planner_context=') &&
        !line.startsWith('traveller_request='),
    );

  expect(instructions.at(-1)).toContain('Fill the whole trip');
  expect(instructions.at(-1)).toContain('item.dayIndex');
  expect(instructions.at(-1)).toContain('Each day needs items');
  expect(instructions.at(-1)).toContain('inclusive date range');
});

/**
 * The prompt alone is not reliable: identical prompts alternated between
 * covering every day and covering only the first. Restating coverage in the
 * response schema description is what removed that variance, so it has to keep
 * saying so.
 */
test('the schema description restates the coverage contract', () => {
  expect(AI_PLANNER_SCHEMA_DESCRIPTION).toContain('every day of the trip');
  expect(AI_PLANNER_SCHEMA_DESCRIPTION).toContain('item.dayIndex');
  expect(AI_PLANNER_SCHEMA_DESCRIPTION).toContain('No day may be left without items');
});

test('a proposal is sparse when it leaves a day of the selected length empty', () => {
  const items = [{ dayIndex: 0 }, { dayIndex: 0 }, { dayIndex: 1 }];

  expect(coveredDayCount(items)).toBe(2);
  expect(isSparseProposal({ items, selectedDurationDays: 5 })).toBe(true);
  expect(isSparseProposal({ items, selectedDurationDays: 2 })).toBe(false);
  // Unscheduled items cannot make a day look covered.
  expect(coveredDayCount([{ dayIndex: null }, { dayIndex: 3 }])).toBe(1);
});

test('exact-date coverage uses the actual inclusive date range', () => {
  const normalizedRequest = {
    datePreference: { kind: 'exact', startDate: '2026-11-04', endDate: '2026-11-10' },
  };
  expect(
    isSparseProposal({ items: [{ dayIndex: 0 }], selectedDurationDays: null, normalizedRequest }),
  ).toBe(true);
  expect(
    isSparseProposal({
      items: Array.from({ length: 7 }, (_, dayIndex) => ({ dayIndex })),
      selectedDurationDays: null,
      normalizedRequest,
    }),
  ).toBe(false);
});

test('the prompt preserves separate occurrences and optional destinations', () => {
  const prompt = buildAiPlannerPrompt('Da Nang with work and tailoring, maybe Sapa', context());
  expect(prompt).toContain(
    'each recurring workday, each flight direction, and each separate appointment',
  );
  expect(prompt).toContain('24-48 hour tailoring is elapsed time');
  expect(prompt).toContain('Optional destinations may be omitted');
});
