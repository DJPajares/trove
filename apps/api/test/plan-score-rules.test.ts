import { expect, test } from 'vitest';

import {
  planScoreFingerprint,
  scoreDay,
  scoreTrip,
  toPlanScoreDayPayload,
  toPlanScoreTripPayload,
  type PlanScoreEvidenceSource,
  type PlanScoreFactorResult,
} from '../src/services/plan-score-rules.js';

function evaluated(score: number, ...sources: PlanScoreEvidenceSource[]): PlanScoreFactorResult {
  return {
    evidence: sources.map((source, index) => ({ ref: `evidence-${index}`, source })),
    score,
    state: 'EVALUATED',
  };
}

const NOT_APPLICABLE: PlanScoreFactorResult = { state: 'NOT_APPLICABLE' };

const completeSightseeingDay = {
  dayId: 'day-complete',
  factors: {
    FEASIBILITY: evaluated(100, 'USER_OWNED'),
    PACE_BUFFER: evaluated(80, 'USER_OWNED'),
    PLACE_QUALITY: evaluated(40, 'CACHED_PROVIDER'),
    ROUTE_EFFICIENCY: evaluated(60, 'FRESH_PROVIDER'),
    TRAVEL_EFFORT: evaluated(85, 'FRESH_PROVIDER'),
  },
};

test('scores a fully evidenced sightseeing day with the authoritative base weights', () => {
  expect(scoreDay(completeSightseeingDay)).toStrictEqual({
    completeness: 100,
    confidence: 99,
    dayId: 'day-complete',
    evidence: {
      FEASIBILITY: [{ ref: 'evidence-0', source: 'USER_OWNED' }],
      PACE_BUFFER: [{ ref: 'evidence-0', source: 'USER_OWNED' }],
      PLACE_QUALITY: [{ ref: 'evidence-0', source: 'CACHED_PROVIDER' }],
      ROUTE_EFFICIENCY: [{ ref: 'evidence-0', source: 'FRESH_PROVIDER' }],
      TRAVEL_EFFORT: [{ ref: 'evidence-0', source: 'FRESH_PROVIDER' }],
    },
    factors: {
      FEASIBILITY: { confidence: 100, score: 100, state: 'EVALUATED' },
      PACE_BUFFER: { confidence: 100, score: 80, state: 'EVALUATED' },
      PLACE_QUALITY: { confidence: 75, score: 40, state: 'EVALUATED' },
      ROUTE_EFFICIENCY: { confidence: 100, score: 60, state: 'EVALUATED' },
      TRAVEL_EFFORT: { confidence: 100, score: 85, state: 'EVALUATED' },
    },
    score: 85,
    withheldReasons: [],
  });
});

test('keeps Must Go priority fit out of day scoring entirely', () => {
  expect(Object.keys(scoreDay(completeSightseeingDay).factors).toSorted()).toStrictEqual([
    'FEASIBILITY',
    'PACE_BUFFER',
    'PLACE_QUALITY',
    'ROUTE_EFFICIENCY',
    'TRAVEL_EFFORT',
  ]);
});

test('renormalizes evaluable weights instead of scoring missing evidence as zero', () => {
  const result = scoreDay({
    dayId: 'day-partial',
    factors: {
      FEASIBILITY: evaluated(100, 'USER_OWNED'),
      TRAVEL_EFFORT: evaluated(60, 'FRESH_PROVIDER'),
    },
  });

  // Zero-filling the three unknown factors would give 5000/90 = 56, not 5000/60 = 83.
  expect(result.score).toBe(83);
  expect(result.completeness).toBe(67);
  expect(result.factors.PACE_BUFFER).toStrictEqual({
    reason: 'MISSING_EVIDENCE',
    state: 'UNKNOWN',
  });
  expect(result.withheldReasons).toStrictEqual([]);
});

test('withholds the number when completeness or a core factor is insufficient', () => {
  const result = scoreDay({
    dayId: 'day-incomplete',
    factors: { PLACE_QUALITY: evaluated(100, 'FRESH_PROVIDER') },
  });

  expect(result.score).toBe(null);
  expect(result.completeness).toBe(6);
  expect(result.withheldReasons).toStrictEqual([
    'INSUFFICIENT_COMPLETENESS',
    'NO_EVALUABLE_CORE_FACTOR',
  ]);
});

test('treats a travel-heavy day as complete after excluding non-applicable factors', () => {
  const result = scoreDay({
    dayId: 'day-travel',
    factors: {
      FEASIBILITY: evaluated(90, 'USER_OWNED'),
      PACE_BUFFER: evaluated(75, 'ESTIMATED'),
      PLACE_QUALITY: NOT_APPLICABLE,
      ROUTE_EFFICIENCY: NOT_APPLICABLE,
      TRAVEL_EFFORT: evaluated(50, 'FRESH_PROVIDER'),
    },
  });

  expect(result.completeness).toBe(100);
  expect(result.confidence).toBe(90);
  expect(result.score).toBe(74);
  expect(result.factors.ROUTE_EFFICIENCY).toStrictEqual({ state: 'NOT_APPLICABLE' });
});

test('moves confidence independently of the score for identical factor scores', () => {
  const factors = {
    FEASIBILITY: evaluated(100, 'STALE'),
    TRAVEL_EFFORT: evaluated(60, 'STALE'),
  };
  const stale = scoreDay({ dayId: 'day-stale', factors });
  const fresh = scoreDay({
    dayId: 'day-fresh',
    factors: {
      FEASIBILITY: evaluated(100, 'USER_OWNED'),
      TRAVEL_EFFORT: evaluated(60, 'FRESH_PROVIDER'),
    },
  });

  expect(stale.score).toBe(fresh.score);
  expect(stale.completeness).toBe(fresh.completeness);
  expect(stale.confidence).toBe(25);
  expect(fresh.confidence).toBe(100);
});

test('clamps evaluable factor scores to 0-100', () => {
  const result = scoreDay({
    dayId: 'day-clamped',
    factors: {
      FEASIBILITY: evaluated(140, 'USER_OWNED'),
      TRAVEL_EFFORT: evaluated(-20, 'FRESH_PROVIDER'),
    },
  });

  expect(result.factors.FEASIBILITY).toStrictEqual({
    confidence: 100,
    score: 100,
    state: 'EVALUATED',
  });
  expect(result.factors.TRAVEL_EFFORT).toStrictEqual({
    confidence: 100,
    score: 0,
    state: 'EVALUATED',
  });
  expect(result.score).toBe(58);
});

const tripDays = [
  { dayId: 'day-a', factors: completeSightseeingDay.factors },
  {
    dayId: 'day-b',
    factors: {
      FEASIBILITY: evaluated(60, 'USER_OWNED'),
      TRAVEL_EFFORT: evaluated(60, 'USER_OWNED'),
    },
  },
];

test('weights trip days by completeness and blends trip-level Must Go priority fit', () => {
  const withoutMustGo = scoreTrip({ days: tripDays, mustGoPriorityFit: NOT_APPLICABLE });
  const withMustGo = scoreTrip({
    days: tripDays,
    mustGoPriorityFit: evaluated(50, 'USER_OWNED'),
  });
  const unknownMustGo = scoreTrip({
    days: tripDays,
    mustGoPriorityFit: { reason: 'MISSING_EVIDENCE', state: 'UNKNOWN' },
  });

  expect(withoutMustGo.score).toBe(75);
  expect(withMustGo.score).toBe(72);
  expect(unknownMustGo.score).toBe(withoutMustGo.score);
  expect(withMustGo.mustGoPriorityFit).toStrictEqual({
    confidence: 100,
    score: 50,
    state: 'EVALUATED',
  });
});

test('withholds the trip score when no day is scorable, even with Must Go evidence', () => {
  const result = scoreTrip({
    days: [
      { dayId: 'day-incomplete', factors: { PLACE_QUALITY: evaluated(100, 'FRESH_PROVIDER') } },
    ],
    mustGoPriorityFit: evaluated(100, 'USER_OWNED'),
  });

  expect(result.score).toBe(null);
  expect(result.withheldReasons).toStrictEqual(['NO_SCORABLE_DAY']);
});

test('produces identical results and fingerprints for identical evidence', () => {
  const input = { days: tripDays, mustGoPriorityFit: evaluated(50, 'USER_OWNED') };
  const reordered = {
    days: tripDays,
    mustGoPriorityFit: {
      evidence: [
        { ref: 'evidence-1', source: 'USER_OWNED' as const },
        { ref: 'evidence-0', source: 'USER_OWNED' as const },
      ],
      score: 50,
      state: 'EVALUATED' as const,
    },
  };

  expect(scoreTrip(input)).toStrictEqual(scoreTrip(input));
  expect(planScoreFingerprint(input)).toBe(planScoreFingerprint(input));
  expect(
    planScoreFingerprint({
      ...input,
      mustGoPriorityFit: evaluated(50, 'USER_OWNED', 'USER_OWNED'),
    }),
  ).toBe(planScoreFingerprint(reordered));
});

test('changes the fingerprint when evidence reliability changes', () => {
  const days = [{ dayId: 'day-a', factors: { FEASIBILITY: evaluated(100, 'USER_OWNED') } }];

  expect(planScoreFingerprint({ days, mustGoPriorityFit: NOT_APPLICABLE })).not.toBe(
    planScoreFingerprint({
      days: [{ dayId: 'day-a', factors: { FEASIBILITY: evaluated(100, 'STALE') } }],
      mustGoPriorityFit: NOT_APPLICABLE,
    }),
  );
});

test('preserves the evidence snapshot and keeps it out of the user-facing payload', () => {
  const result = scoreDay(completeSightseeingDay);
  const payload = toPlanScoreDayPayload(result);

  expect(result.evidence.PLACE_QUALITY).toStrictEqual([
    { ref: 'evidence-0', source: 'CACHED_PROVIDER' },
  ]);
  expect(Object.keys(payload).toSorted()).toStrictEqual([
    'completeness',
    'confidence',
    'dayId',
    'factors',
    'score',
    'withheldReasons',
  ]);
  expect(Object.keys(payload.factors.FEASIBILITY).toSorted()).toStrictEqual([
    'confidence',
    'score',
    'state',
  ]);
});

test('keeps trip evidence snapshots out of the trip payload', () => {
  const result = scoreTrip({ days: tripDays, mustGoPriorityFit: evaluated(50, 'USER_OWNED') });
  const payload = toPlanScoreTripPayload(result);

  expect(result.mustGoEvidence).toStrictEqual([{ ref: 'evidence-0', source: 'USER_OWNED' }]);
  expect(Object.keys(payload).toSorted()).toStrictEqual([
    'days',
    'mustGoPriorityFit',
    'score',
    'withheldReasons',
  ]);
  expect(payload.days.every((day) => !Object.hasOwn(day, 'evidence'))).toBe(true);
  expect(payload.score).toBe(result.score);
});

test('derives day confidence from the frozen evidence reliability tiers', () => {
  const dayFrom = (source: PlanScoreEvidenceSource) =>
    scoreDay({
      dayId: 'day',
      factors: { FEASIBILITY: evaluated(100, source), TRAVEL_EFFORT: evaluated(100, source) },
    });
  const stale = dayFrom('STALE');

  expect(dayFrom('USER_OWNED').confidence).toBe(100);
  expect(dayFrom('FRESH_PROVIDER').confidence).toBe(100);
  expect(dayFrom('CACHED_PROVIDER').confidence).toBe(75);
  expect(dayFrom('ESTIMATED').confidence).toBe(50);
  expect({ confidence: stale.confidence, score: stale.score }).toStrictEqual({
    confidence: 25,
    score: 100,
  });
});

const fullyEvidencedDay = {
  dayId: 'planned',
  factors: {
    FEASIBILITY: evaluated(100, 'USER_OWNED'),
    PACE_BUFFER: evaluated(100, 'USER_OWNED'),
    PLACE_QUALITY: evaluated(100, 'USER_OWNED'),
    ROUTE_EFFICIENCY: evaluated(100, 'USER_OWNED'),
    TRAVEL_EFFORT: evaluated(100, 'USER_OWNED'),
  },
};

test('moves completeness and confidence for a partially evidenced day without collapsing its score', () => {
  const complete = scoreDay(fullyEvidencedDay);
  const partial = scoreDay({
    dayId: 'partial',
    factors: {
      FEASIBILITY: evaluated(100, 'USER_OWNED'),
      TRAVEL_EFFORT: evaluated(100, 'ESTIMATED'),
    },
  });

  expect(complete.score).toBe(partial.score);
  expect({ completeness: complete.completeness, confidence: complete.confidence }).toStrictEqual({
    completeness: 100,
    confidence: 100,
  });
  expect({ completeness: partial.completeness, confidence: partial.confidence }).toStrictEqual({
    completeness: 67,
    confidence: 79,
  });
});

test('stops a low-information day from pulling the trip score toward its own', () => {
  const trip = scoreTrip({
    days: [
      fullyEvidencedDay,
      {
        dayId: 'travel',
        factors: {
          FEASIBILITY: evaluated(60, 'USER_OWNED'),
          TRAVEL_EFFORT: evaluated(60, 'USER_OWNED'),
        },
      },
    ],
    mustGoPriorityFit: NOT_APPLICABLE,
  });

  // An unweighted mean of the two day scores would be 80.
  expect(trip.score).toBe(84);
  expect(trip.days.map((day) => day.completeness)).toStrictEqual([100, 67]);
});

test('rejects evaluated factors without evidence or with an unusable score', () => {
  expect(() =>
    scoreDay({
      dayId: 'day-a',
      factors: { FEASIBILITY: { evidence: [], score: 100, state: 'EVALUATED' } },
    }),
  ).toThrow(/missing_factor_evidence/);
  expect(() =>
    scoreDay({ dayId: 'day-a', factors: { FEASIBILITY: evaluated(Number.NaN, 'USER_OWNED') } }),
  ).toThrow(/invalid_factor_score/);
});
