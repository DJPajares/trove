import { expect, test } from 'vitest';
import {
  scoreDay,
  scoreTrip,
  combineSignals,
  evidenceConfidence,
  planScoreFingerprint,
  toPlanScoreDayPayload,
  toPlanScoreTripPayload,
  type PlanScoreDayInput,
  type PlanScoreFactorResult,
  DAY_FACTOR_IDS,
  UNKNOWN,
  NOT_APPLICABLE,
} from '../src/services/plan-score-rules.js';
const evaluated = (score = 100, coverage = 100): PlanScoreFactorResult => ({
  state: 'EVALUATED',
  score,
  coverage,
  evidence: [{ ref: 'owned', source: 'USER_OWNED' }],
});
const day = (id = 'day', score = 100): PlanScoreDayInput => ({
  dayId: id,
  factors: Object.fromEntries(DAY_FACTOR_IDS.map((f) => [f, evaluated(score)])),
  loadRatio: 0.8,
});
test('five category weights implement the approved weighted mean', () => {
  const input = day();
  input.factors = {
    FEASIBILITY: evaluated(100),
    ROUTE_EFFICIENCY: evaluated(85),
    PACE_COMFORT: evaluated(80),
    EXPERIENCE_QUALITY: evaluated(40),
    PLAN_COMPOSITION: evaluated(100),
  };
  expect(scoreDay(input)).toMatchObject({ score: 84, completeness: 100, confidence: 100 });
  expect(Object.keys(scoreDay(input).factors)).toEqual([...DAY_FACTOR_IDS]);
});
test('quality renormalizes unknown signals while coverage keeps them in the denominator', () => {
  const partial = combineSignals([
    { weight: 60, result: evaluated(90) },
    { weight: 40, result: UNKNOWN },
  ]);
  expect(partial).toMatchObject({ score: 90, coverage: 60, confidence: 100 });
  const input = day();
  input.factors.EXPERIENCE_QUALITY = UNKNOWN;
  expect(scoreDay(input)).toMatchObject({ score: 100, completeness: 85 });
});
test('partial evidence cannot make an entire category look covered', () => {
  const input = day();
  input.factors.FEASIBILITY = evaluated(100, 10);
  expect(scoreDay(input).completeness).toBe(69);
  input.factors.ROUTE_EFFICIENCY = UNKNOWN;
  input.factors.PACE_COMFORT = UNKNOWN;
  expect(scoreDay(input).score).toBeNull();
});
test('inapplicable weights disappear from both quality and coverage', () => {
  expect(
    combineSignals([
      { weight: 60, result: evaluated(80) },
      { weight: 40, result: NOT_APPLICABLE },
    ]),
  ).toMatchObject({ score: 80, coverage: 100 });
  expect(combineSignals([{ weight: 1, result: NOT_APPLICABLE }])).toEqual(NOT_APPLICABLE);
});
test('daily gate requires unrounded 60 percent coverage and a core signal', () => {
  const input = day();
  input.factors = {
    FEASIBILITY: evaluated(100),
    PACE_COMFORT: evaluated(100),
    PLAN_COMPOSITION: evaluated(100, 49),
  };
  expect(scoreDay(input).score).toBeNull();
  input.factors.PLAN_COMPOSITION = evaluated(100, 50);
  expect(scoreDay(input).score).toBe(100);
  input.coreEvaluated = false;
  expect(scoreDay(input).withheldReasons).toContain('NO_EVALUABLE_CORE_FACTOR');
});
test('an explicit rest day can use comfort/composition without a logistics core', () => {
  const input: PlanScoreDayInput = {
    dayId: 'rest',
    rest: true,
    coreEvaluated: false,
    factors: {
      FEASIBILITY: NOT_APPLICABLE,
      ROUTE_EFFICIENCY: NOT_APPLICABLE,
      PACE_COMFORT: evaluated(),
      EXPERIENCE_QUALITY: NOT_APPLICABLE,
      PLAN_COMPOSITION: evaluated(),
    },
  };
  expect(scoreDay(input).score).toBe(100);
  expect(scoreDay({ ...input, rest: false }).score).toBeNull();
});
test.each([
  [['a'], [], 59],
  [['a', 'b'], [], 39],
  [[], ['a'], 74],
] as const)('feasibility caps bound quality: %j %j', (hard, material, cap) => {
  expect(
    scoreDay({ ...day(), hardConflictIds: [...hard], materialConflictIds: [...material] }).score,
  ).toBe(cap);
});
test('caps remain visible without enough evidence for a number', () => {
  const result = scoreDay({
    ...day(),
    factors: { FEASIBILITY: evaluated(50, 10) },
    hardConflictIds: ['conflict'],
  });
  expect(result.score).toBeNull();
  expect(result.caps[0]?.limit).toBe(59);
});
test('duplicate evidence does not improve confidence', () => {
  const evidence = [{ ref: 'one', source: 'ESTIMATED' as const }];
  expect(evidenceConfidence([...evidence, ...evidence])).toBe(50);
});
test('trip numbers require at least 60 percent of days and cannot live on Must Go alone', () => {
  const unknown: PlanScoreDayInput = { dayId: 'unknown', factors: {} };
  expect(scoreTrip({ days: [day(), unknown, unknown] }).score).toBeNull();
  expect(scoreTrip({ days: [day('a'), day('b'), day('c'), unknown, unknown] }).score).toBe(100);
  expect(
    scoreTrip({ days: [unknown], components: { DESTINATION_UTILIZATION: evaluated() } })
      .withheldReasons,
  ).toContain('NO_SCORABLE_DAY');
});
test('all known availability weights coverage and intrinsic daily quality', () => {
  const a = { ...day('a', 100), availableMinutes: 60 },
    b = { ...day('b', 80), availableMinutes: 180 };
  const result = scoreTrip({ days: [a, b] });
  // Mean 85; nearest-rank lower quintile 80; weak adjustment 1.
  expect(result.score).toBe(84);
  expect(scoreTrip({ days: [a, { ...b, availableMinutes: null }] }).score).toBe(88);
});
test('sustained load is chronological and uses intrinsic scores to avoid double charging fatigue', () => {
  const days = [0, 1, 2].map((i) => ({
    ...day(String(i)),
    date: `2026-10-0${i + 1}`,
    loadRatio: 1.25,
  }));
  const result = scoreTrip({ days: days.toReversed() });
  result.days.forEach((d, i) => expect(d.incomingDebt).toBeCloseTo([0, 0.35, 0.525][i]!));
  expect(result.days.map((d) => d.intrinsicScore)).toEqual([100, 100, 100]);
  expect(result.days.map((d) => d.score)).toEqual([100, 99, 98]);
  expect(result.fatigueAdjustment).toBeCloseTo(4.375);
  expect(result.score).toBe(96);
});
test('unknown days carry debt without decay; known rest can recover', () => {
  const result = scoreTrip({
    days: [
      { ...day('a'), date: '2026-10-01', loadRatio: 1.5 },
      { ...day('b'), date: '2026-10-02', loadRatio: null },
      { ...day('c'), date: '2026-10-03', loadRatio: 0 },
      { ...day('d'), date: '2026-10-04', loadRatio: 0.8 },
    ],
  });
  expect(result.days.map((d) => d.incomingDebt)).toEqual([0, 0.6, 0.6, 0]);
});
test('weak-day nearest rank is deterministic for small trips', () => {
  const result = scoreTrip({ days: [day('a', 100), day('b', 50)] });
  expect(result.weakDayAdjustment).toBe(5);
  expect(result.score).toBe(70);
});
test('hard conflicts on unscorable days still constrain a publishable trip', () => {
  const sparse = {
    dayId: 'sparse',
    factors: { FEASIBILITY: evaluated(50, 5) },
    hardConflictIds: ['conflict'],
  };
  const result = scoreTrip({ days: [day('a'), day('b'), day('c'), sparse] });
  expect(result.caps[0]?.limit).toBe(69);
  expect(result.score).toBeLessThanOrEqual(69);
  const oneOfSix = scoreTrip({
    days: [...Array.from({ length: 5 }, (_, i) => day(String(i))), sparse],
  });
  expect(oneOfSix.caps[0]?.limit).toBe(84);
  expect(
    scoreTrip({
      days: [
        ...Array.from({ length: 5 }, (_, i) => day(String(i))),
        { ...sparse, indispensableConnectionConflict: true },
      ],
    }).caps[0]?.limit,
  ).toBe(69);
});
test('trip components use 65/15/10/10 and renormalize unknown components', () => {
  const result = scoreTrip({
    days: [day()],
    components: {
      DESTINATION_UTILIZATION: evaluated(80),
      VARIETY_COVERAGE: evaluated(60),
      SEASONAL_FIT: evaluated(40),
    },
  });
  expect(result.score).toBe(87);
  expect(scoreTrip({ days: [day()] }).score).toBe(100);
});
test('public payloads exclude raw evidence, weights and intrinsic fatigue bookkeeping', () => {
  expect(toPlanScoreDayPayload(scoreDay(day()))).not.toHaveProperty('evidence');
  const payload = toPlanScoreTripPayload(scoreTrip({ days: [day()] }));
  expect(payload).not.toHaveProperty('fatigueAdjustment');
  expect(payload.days[0]).not.toHaveProperty('intrinsicScore');
});
test('fingerprint changes for timing inputs, context or fatigue-relevant order', () => {
  const input = { days: [day()] };
  expect(planScoreFingerprint(input)).not.toBe(
    planScoreFingerprint({ days: [{ ...day(), loadRatio: 1.5 }] }),
  );
  expect(planScoreFingerprint(input)).toBe(planScoreFingerprint(structuredClone(input)));
});

test('thin supported signals contribute in proportion to coverage, without treating missing data as zero', () => {
  const aggregate = combineSignals([
    { weight: 50, result: evaluated(40, 100) },
    { weight: 50, result: evaluated(100, 10) },
  ]);
  expect(aggregate.state).toBe('EVALUATED');
  if (aggregate.state !== 'EVALUATED') return;
  expect(aggregate.score).toBeCloseTo((40 * 50 + 100 * 5) / 55);
  expect(aggregate.coverage).toBe(55);
  expect(
    combineSignals([
      { weight: 50, result: evaluated(40) },
      { weight: 50, result: UNKNOWN },
    ]),
  ).toMatchObject({ score: 40, coverage: 50 });
});

test('category numbers require unrounded support and reliability thresholds', () => {
  const input = day();
  input.factors.EXPERIENCE_QUALITY = evaluated(100, 59.99);
  input.factors.PLAN_COMPOSITION = {
    ...evaluated(100),
    confidence: 49.99,
  } as PlanScoreFactorResult;
  const result = scoreDay(input);
  expect(result.factors.EXPERIENCE_QUALITY.state).toBe('LIMITED');
  expect(result.factors.PLAN_COMPOSITION.state).toBe('LIMITED');
  expect(result.factors.EXPERIENCE_QUALITY).not.toHaveProperty('score');
  expect(result.score).toBe(100);
});

test('three of five days pass even when unscorable days have most available time', () => {
  const days = [
    day('a', 80),
    day('b', 80),
    day('c', 80),
    { ...day('d'), factors: {} },
    { ...day('e'), factors: {} },
  ].map((d, i) => ({ ...d, availableMinutes: i < 3 ? 60 : 600 }));
  const result = scoreTrip({ days });
  expect(result.score).toBe(80);
  expect(result.assessmentStatus).toBe('provisional');
  expect(result.assessedDayCount).toBe(3);
  expect(result.applicableDayCount).toBe(5);
  expect(result.completeness).toBe(13);
});

test('the fully known time gate can pass fewer days without selectively dropping unknown availability', () => {
  const days = [
    day('a', 80),
    day('b', 80),
    { ...day('c'), factors: {} },
    { ...day('d'), factors: {} },
    { ...day('e'), factors: {} },
  ].map((d, i) => ({ ...d, availableMinutes: i < 2 ? 600 : 60 }));
  expect(scoreTrip({ days }).score).toBe(80);
  days[4]!.availableMinutes = null as never;
  expect(scoreTrip({ days }).score).toBeNull();
});

test('weak optional trip components cannot overwhelm better-supported daily quality', () => {
  const result = scoreTrip({
    days: [day('a', 60)],
    components: {
      DESTINATION_UTILIZATION: evaluated(100, 10),
      VARIETY_COVERAGE: evaluated(100, 10),
    },
  });
  expect(result.score).toBe(Math.round((65 * 60 + 1.5 * 100 + 1 * 100) / 67.5));
  expect(result.components.DESTINATION_UTILIZATION.state).toBe('LIMITED');
});
