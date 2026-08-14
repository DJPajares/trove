import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type {
  PlanScoreAlternative,
  PlanScoreConflict,
} from '../src/services/plan-score-factors.js';
import {
  explainDay,
  explainTrip,
  planReplacement,
  type PlanScoreDayExplanationInput,
  type PlanScoreExplanationGroups,
} from '../src/services/plan-score-explanations.js';
import {
  scoreDay,
  type PlanScoreEvidenceSource,
  type PlanScoreFactorResult,
} from '../src/services/plan-score-rules.js';

const messages: unknown = JSON.parse(
  readFileSync(new URL('../../web/messages/en.json', import.meta.url), 'utf8'),
);

function messageExists(key: string) {
  let node: unknown = (messages as { planScore?: unknown }).planScore;

  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return false;
    node = (node as Record<string, unknown>)[part];
  }

  return typeof node === 'string';
}

function factor(
  score: number,
  source: PlanScoreEvidenceSource = 'USER_OWNED',
): PlanScoreFactorResult {
  return { evidence: [{ ref: 'evidence-1', source }], score, state: 'EVALUATED' };
}

const UNKNOWN: PlanScoreFactorResult = { reason: 'MISSING_EVIDENCE', state: 'UNKNOWN' };

function dayInput(
  overrides: Partial<PlanScoreDayExplanationInput> & { day: PlanScoreDayExplanationInput['day'] },
): PlanScoreDayExplanationInput {
  return {
    alternatives: [],
    conflicts: [],
    pace: { activeMinutes: null, smallestBufferMinutes: null },
    route: { bestMinutes: null, plannedMinutes: null },
    travel: { totalMinutes: null },
    ...overrides,
  };
}

function keys(explanations: PlanScoreExplanationGroups[keyof PlanScoreExplanationGroups]) {
  return explanations.map((entry) => entry.messageKey);
}

const strongDay = scoreDay({
  dayId: 'strong',
  factors: {
    FEASIBILITY: factor(100),
    PACE_BUFFER: factor(100),
    PLACE_QUALITY: factor(100),
    ROUTE_EFFICIENCY: factor(100),
    TRAVEL_EFFORT: factor(100),
  },
});

test('explains a strong day entirely through what works', () => {
  const result = explainDay(
    dayInput({
      day: strongDay,
      pace: { activeMinutes: 300, smallestBufferMinutes: 40 },
      route: { bestMinutes: 30, plannedMinutes: 30 },
      travel: { totalMinutes: 30 },
    }),
  );

  assert.deepEqual(keys(result.whatWorks), [
    'feasibility.noConflicts',
    'travelEffort.light',
    'pace.comfortable',
    'routeEfficiency.direct',
    'placeQuality.strong',
  ]);
  assert.deepEqual(result.worthImproving, []);
  assert.deepEqual(result.uncertainty, []);
  assert.deepEqual(result.whatWorks[1]?.values, { minutes: 30 });
});

const conflicts: PlanScoreConflict[] = [
  {
    deduction: 10,
    id: 'transition:market',
    kind: 'TIGHT_TRANSITION',
    severity: 'SOFT',
    subjectIds: ['park', 'market'],
  },
  {
    deduction: 50,
    id: 'overlap:lunch:museum',
    kind: 'OVERLAPPING_COMMITMENTS',
    severity: 'HARD',
    subjectIds: ['lunch', 'museum'],
  },
];

const alternative: PlanScoreAlternative = {
  action: 'REPLACE',
  candidateRating: 4.7,
  candidateTripPlaceId: 'great',
  currentRating: 3.2,
  improvement: 45,
  targetItemId: 'item-1',
};

test('puts severe timing conflicts before minor quality suggestions', () => {
  const result = explainDay(
    dayInput({
      alternatives: [alternative],
      conflicts,
      day: scoreDay({
        dayId: 'conflicts',
        factors: {
          FEASIBILITY: factor(40),
          PLACE_QUALITY: factor(100),
          TRAVEL_EFFORT: factor(100),
        },
      }),
      travel: { totalMinutes: 30 },
    }),
  );

  assert.deepEqual(keys(result.worthImproving), [
    'feasibility.overlappingCommitments',
    'feasibility.tightTransition',
    'alternative.replace',
  ]);
  assert.deepEqual(result.worthImproving[0]?.references, ['lunch', 'museum']);
  assert.equal(result.worthImproving[0]?.action, 'ADJUST_TIME');
  assert.equal(result.worthImproving[1]?.action, 'ADD_BUFFER');
});

test('explains the benefit of an alternative without applying it', () => {
  const result = explainDay(
    dayInput({
      alternatives: [alternative],
      day: scoreDay({ dayId: 'quality', factors: { FEASIBILITY: factor(100) } }),
    }),
  );
  const suggestion = result.worthImproving.at(-1);

  assert.deepEqual(suggestion, {
    action: 'REVIEW_ALTERNATIVE',
    factor: 'PLACE_QUALITY',
    messageKey: 'alternative.replace',
    references: ['item-1', 'great'],
    values: { candidateRating: 4.7, currentRating: 3.2 },
  });
});

test('offers a concrete action for a high-travel day', () => {
  const result = explainDay(
    dayInput({
      day: scoreDay({
        dayId: 'travel',
        factors: { FEASIBILITY: factor(100), TRAVEL_EFFORT: factor(30) },
      }),
      travel: { totalMinutes: 300 },
    }),
  );

  assert.deepEqual(result.worthImproving, [
    {
      action: 'RECONSIDER_DETOUR',
      factor: 'TRAVEL_EFFORT',
      messageKey: 'travelEffort.heavy',
      references: [],
      values: { minutes: 300 },
    },
  ]);
});

test('suggests reordering manually when a better order exists', () => {
  const result = explainDay(
    dayInput({
      day: scoreDay({
        dayId: 'backtracking',
        factors: { FEASIBILITY: factor(100), ROUTE_EFFICIENCY: factor(40) },
      }),
      route: { bestMinutes: 30, plannedMinutes: 60 },
    }),
  );

  assert.deepEqual(result.worthImproving, [
    {
      action: 'REORDER_MANUALLY',
      factor: 'ROUTE_EFFICIENCY',
      messageKey: 'routeEfficiency.backtracking',
      references: [],
      values: { bestMinutes: 30, plannedMinutes: 60 },
    },
  ]);
});

test('describes missing and stale evidence as uncertainty rather than fact', () => {
  const result = explainDay(
    dayInput({
      day: scoreDay({
        dayId: 'uncertain',
        factors: {
          FEASIBILITY: {
            evidence: [{ ref: 'hours:market', source: 'STALE' }],
            score: 100,
            state: 'EVALUATED',
          },
          TRAVEL_EFFORT: UNKNOWN,
        },
      }),
    }),
  );

  assert.deepEqual(keys(result.uncertainty), [
    'feasibility.stale',
    'travelEffort.unknown',
    'pace.unknown',
    'routeEfficiency.unknown',
    'placeQuality.unknown',
  ]);
  assert.deepEqual(result.uncertainty[0]?.references, ['hours:market']);
  assert.deepEqual(keys(result.whatWorks), ['feasibility.noConflicts']);
});

test('skips factors that do not apply to the day', () => {
  const result = explainDay(
    dayInput({
      day: scoreDay({
        dayId: 'travel-heavy',
        factors: {
          FEASIBILITY: factor(100),
          PLACE_QUALITY: { state: 'NOT_APPLICABLE' },
          ROUTE_EFFICIENCY: { state: 'NOT_APPLICABLE' },
          TRAVEL_EFFORT: factor(100),
        },
      }),
      travel: { totalMinutes: 45 },
    }),
  );

  assert.deepEqual(keys(result.whatWorks), ['feasibility.noConflicts', 'travelEffort.light']);
  assert.deepEqual(keys(result.uncertainty), ['pace.unknown']);
});

test('explains trip-level Must Go fit with an actionable target', () => {
  const unscheduled = explainTrip({
    mustGoPriorityFit: { confidence: 100, score: 50, state: 'EVALUATED' },
    unscheduledMustGoTripPlaceIds: ['harbour', 'ruins'],
  });
  const complete = explainTrip({
    mustGoPriorityFit: { confidence: 100, score: 100, state: 'EVALUATED' },
    unscheduledMustGoTripPlaceIds: [],
  });
  const notApplicable = explainTrip({
    mustGoPriorityFit: { state: 'NOT_APPLICABLE' },
    unscheduledMustGoTripPlaceIds: [],
  });

  assert.deepEqual(unscheduled.worthImproving, [
    {
      action: 'SCHEDULE_MUST_GO',
      factor: 'MUST_GO_PRIORITY_FIT',
      messageKey: 'mustGo.unscheduled',
      references: ['harbour', 'ruins'],
      values: { count: 2 },
    },
  ]);
  assert.deepEqual(keys(complete.whatWorks), ['mustGo.allScheduled']);
  assert.deepEqual(notApplicable, { uncertainty: [], whatWorks: [], worthImproving: [] });
});

test('plans a confirmed replacement without changing anything', () => {
  const linkedRecords = [
    { id: 'reservation-1', kind: 'RESERVATION' as const },
    { id: 'expense-1', kind: 'EXPENSE' as const },
  ];
  const snapshot = structuredClone({ alternative, linkedRecords });

  assert.deepEqual(planReplacement({ linkedRecords, suggestion: alternative }), {
    candidateTripPlaceId: 'great',
    preservedFields: ['dayPart', 'durationMinutes', 'notes', 'priority', 'startDate', 'startTime'],
    requiresReview: [
      { id: 'reservation-1', kind: 'RESERVATION' },
      { id: 'expense-1', kind: 'EXPENSE' },
    ],
    targetItemId: 'item-1',
  });
  assert.deepEqual({ alternative, linkedRecords }, snapshot);
  assert.throws(
    () => planReplacement({ linkedRecords: [], suggestion: { ...alternative, action: 'ADD' } }),
    /unsupported_alternative_action/,
  );
});

test('exposes only traveller-facing values and localized message keys', () => {
  const results = [
    explainDay(
      dayInput({
        alternatives: [alternative],
        conflicts,
        day: strongDay,
        pace: { activeMinutes: 700, smallestBufferMinutes: 2 },
        route: { bestMinutes: 30, plannedMinutes: 60 },
        travel: { totalMinutes: 300 },
      }),
    ),
    explainDay(
      dayInput({
        day: scoreDay({
          dayId: 'sparse',
          factors: {
            FEASIBILITY: factor(50),
            PACE_BUFFER: factor(20, 'STALE'),
            ROUTE_EFFICIENCY: factor(40),
          },
        }),
        pace: { activeMinutes: 700, smallestBufferMinutes: 2 },
        route: { bestMinutes: 30, plannedMinutes: 60 },
      }),
    ),
    explainTrip({
      mustGoPriorityFit: { confidence: 100, score: 50, state: 'EVALUATED' },
      unscheduledMustGoTripPlaceIds: ['harbour'],
    }),
  ];
  const explanations = results.flatMap((result) => [
    ...result.uncertainty,
    ...result.whatWorks,
    ...result.worthImproving,
  ]);
  const valueKeys = new Set(explanations.flatMap((entry) => Object.keys(entry.values)));

  assert.equal(explanations.length > 0, true);
  assert.deepEqual([...valueKeys].toSorted(), [
    'activeMinutes',
    'bestMinutes',
    'bufferMinutes',
    'candidateRating',
    'count',
    'currentRating',
    'minutes',
    'plannedMinutes',
    'severity',
  ]);
  for (const entry of explanations) {
    assert.equal(messageExists(entry.messageKey), true, `missing message for ${entry.messageKey}`);
  }
});

test('produces identical explanations for identical evidence', () => {
  const input = dayInput({
    alternatives: [alternative],
    conflicts,
    day: strongDay,
    travel: { totalMinutes: 30 },
  });

  assert.deepEqual(explainDay(input), explainDay(input));
});
