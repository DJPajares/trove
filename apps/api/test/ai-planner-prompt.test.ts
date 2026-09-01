import {
  AI_PLANNER_MAX_REAL_PLACE_ITEMS,
  AI_PLANNER_TRIP_LENGTH_TIERS,
  aiPlannerNormalizedRequestSchema,
} from '@trove/types';
import { expect, test } from 'vitest';

import {
  AI_PLANNER_ITEMS_PER_DAY,
  AI_PLANNER_SCHEMA_DESCRIPTION,
  buildAiPlannerContext,
  buildAiPlannerPrompt,
  coveredDayCount,
  isSparseProposal,
} from '../src/services/ai-planner-prompt.js';
import {
  AI_PLANNER_DEFAULT_PACE,
  AI_PLANNER_DEFAULT_PARTY_SIZE,
  AI_PLANNER_DEFAULT_TRIP_LENGTH_DAYS,
} from '../src/services/ai-planning-rules.js';

const GENERATION_DATE = new Date('2026-09-01T12:00:00.000Z');

function context(homeLocation: string | null = null) {
  return buildAiPlannerContext({ generationDate: GENERATION_DATE, homeLocation });
}

test('the planner context resolves every default the model would otherwise invent', () => {
  expect(context('Auckland')).toStrictEqual({
    defaults: {
      durationDays: AI_PLANNER_DEFAULT_TRIP_LENGTH_DAYS,
      pace: AI_PLANNER_DEFAULT_PACE,
      partySize: AI_PLANNER_DEFAULT_PARTY_SIZE,
    },
    generationDate: '2026-09-01',
    homeLocation: 'Auckland',
    itemsPerDay: AI_PLANNER_ITEMS_PER_DAY,
    maxRealPlaceItems: AI_PLANNER_MAX_REAL_PLACE_ITEMS,
    tripLengthTiers: AI_PLANNER_TRIP_LENGTH_TIERS,
  });
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

  expect(prompt).toContain('Every id you reference must be one you declared');
  expect(prompt).toContain('must not use priority "must_go"');
  expect(prompt).toContain('destination_inferred');
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
  expect(instructions.at(-1)).toContain('Every day must contain items');
  expect(instructions.at(-1)).toContain('separate entry in places for each real stop');
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
  expect(AI_PLANNER_SCHEMA_DESCRIPTION).toContain('no day left without items');
});

test('a proposal is sparse when it leaves a day of the selected length empty', () => {
  const items = [{ dayIndex: 0 }, { dayIndex: 0 }, { dayIndex: 1 }];

  expect(coveredDayCount(items)).toBe(2);
  expect(isSparseProposal({ items, selectedDurationDays: 5 })).toBe(true);
  expect(isSparseProposal({ items, selectedDurationDays: 2 })).toBe(false);
  // Unscheduled items cannot make a day look covered.
  expect(coveredDayCount([{ dayIndex: null }, { dayIndex: 3 }])).toBe(1);
});

test('an exact-date proposal is never treated as sparse', () => {
  // The tier is null when the traveller gave real dates, so there is no
  // expected day count to measure against and a retry would be guesswork.
  expect(isSparseProposal({ items: [{ dayIndex: 0 }], selectedDurationDays: null })).toBe(false);
});

test('only the retry prompt carries the corrective note', () => {
  const first = buildAiPlannerPrompt('Five days in Tokyo', context());
  const retry = buildAiPlannerPrompt('Five days in Tokyo', context(), { coverageRetry: true });

  expect(first).not.toContain('A previous attempt');
  expect(retry).toContain('A previous attempt at this request left days empty');
});
