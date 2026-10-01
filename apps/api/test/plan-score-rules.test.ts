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
  MISSING_DETAIL_SCORE,
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
  assessmentBasis: ['TIMING'],
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
test('signals renormalize unknowns, while an unknown category is filled low (rubric 12)', () => {
  const partial = combineSignals([
    { weight: 60, result: evaluated(90) },
    { weight: 40, result: UNKNOWN },
  ]);
  expect(partial).toMatchObject({ score: 90, coverage: 60, confidence: 100 });
  const input = day();
  input.factors.EXPERIENCE_QUALITY = UNKNOWN;
  const result = scoreDay(input);
  // Every row carries a number: the unknown category counts at the missing-detail value.
  expect(result.factors.EXPERIENCE_QUALITY).toMatchObject({
    state: 'EVALUATED',
    score: MISSING_DETAIL_SCORE,
    confidence: 0,
  });
  expect(result).toMatchObject({
    score: Math.round((85 * 100 + 15 * MISSING_DETAIL_SCORE) / 100),
    assessmentStatus: 'provisional',
  });
  expect(result.filledFactors).toEqual(['EXPERIENCE_QUALITY']);
});
test('a category below the publish threshold fills its unassessed share low', () => {
  const input = day();
  input.factors.FEASIBILITY = evaluated(100, 10);
  expect(scoreDay(input).factors.FEASIBILITY).toMatchObject({
    state: 'EVALUATED',
    score: Math.round((10 * 100 + 90 * MISSING_DETAIL_SCORE) / 100),
    confidence: 10,
  });
  input.factors.ROUTE_EFFICIENCY = UNKNOWN;
  input.factors.PACE_COMFORT = UNKNOWN;
  const result = scoreDay(input);
  expect(result.score).toBeLessThan(90);
  expect(result.assessmentStatus).toBe('provisional');
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
test('publication uses meaningful evidence instead of a coverage or core gate', () => {
  const input = day();
  input.factors = { PACE_COMFORT: evaluated(100, 10) };
  expect(scoreDay(input)).toMatchObject({
    score: Math.round((10 * 100 + 90 * MISSING_DETAIL_SCORE) / 100),
    assessmentStatus: 'provisional',
    confidence: 2,
  });
  input.assessmentBasis = [];
  expect(scoreDay(input).withheldReasons).toEqual(['NO_MEANINGFUL_EVIDENCE']);
});
test('explicit rest needs supported intent and availability; a blank day remains unspecified', () => {
  const input: PlanScoreDayInput = {
    dayId: 'rest',
    rest: true,
    assessmentBasis: ['REST'],
    factors: {
      FEASIBILITY: NOT_APPLICABLE,
      ROUTE_EFFICIENCY: NOT_APPLICABLE,
      PACE_COMFORT: evaluated(),
      EXPERIENCE_QUALITY: NOT_APPLICABLE,
      PLAN_COMPOSITION: evaluated(),
    },
  };
  expect(scoreDay(input).score).toBe(100);
  expect(scoreDay({ ...input, assessmentBasis: [] }).score).toBeNull();
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
    assessmentBasis: [],
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
test('one qualifying day can support a partial trip, but Must Go alone cannot', () => {
  const unknown: PlanScoreDayInput = { dayId: 'unknown', factors: {} };
  // One of three days is too little daily quality to stand alone: the rest fills low.
  expect(scoreTrip({ days: [day(), unknown, unknown] })).toMatchObject({
    score: Math.round((100 + 2 * MISSING_DETAIL_SCORE) / 3),
    assessedDayCount: 1,
    applicableDayCount: 3,
    assessmentStatus: 'provisional',
  });
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

test('categories fill from unrounded coverage; reliability qualifies rather than hides them', () => {
  const input = day();
  input.factors.EXPERIENCE_QUALITY = evaluated(100, 39.99);
  input.factors.ROUTE_EFFICIENCY = evaluated(100, 40);
  input.factors.PLAN_COMPOSITION = {
    ...evaluated(100),
    confidence: 49.99,
  } as PlanScoreFactorResult;
  const result = scoreDay(input);
  // Just under the threshold, the unassessed share fills low; at it, nothing changes.
  expect(result.factors.EXPERIENCE_QUALITY).toMatchObject({ state: 'EVALUATED', coverage: 100 });
  expect(result.filledFactors).toEqual(['EXPERIENCE_QUALITY']);
  expect(result.factors.ROUTE_EFFICIENCY).toMatchObject({ state: 'EVALUATED', coverage: 40 });
  // Low reliability no longer hides a fully covered category; it is published
  // with its confidence so the traveller sees it as an estimate.
  expect(result.factors.PLAN_COMPOSITION).toMatchObject({ state: 'EVALUATED', score: 100 });
  expect(result.score).toBeLessThan(100);
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
  // 13% of the available time is assessed: the rest of daily quality fills low.
  expect(result.score).toBe(78);
  expect(result.filledComponents).toContain('DAILY_QUALITY');
  expect(result.assessmentStatus).toBe('provisional');
  expect(result.assessedDayCount).toBe(3);
  expect(result.applicableDayCount).toBe(5);
  expect(result.completeness).toBe(13);
});

test('partial trip eligibility stays separate from availability weighting', () => {
  const days = [
    day('a', 80),
    day('b', 80),
    { ...day('c'), factors: {} },
    { ...day('d'), factors: {} },
    { ...day('e'), factors: {} },
  ].map((d, i) => ({ ...d, availableMinutes: i < 2 ? 600 : 60 }));
  expect(scoreTrip({ days }).score).toBe(80);
  days[4]!.availableMinutes = null as never;
  expect(scoreTrip({ days }).score).toBe(80);
});

test('sparse optional trip components fill low rather than lift daily quality', () => {
  const result = scoreTrip({
    days: [day('a', 60)],
    components: {
      DESTINATION_UTILIZATION: evaluated(100, 10),
      VARIETY_COVERAGE: evaluated(100, 10),
    },
  });
  const filled = (10 * 100 + 90 * MISSING_DETAIL_SCORE) / 100;
  expect(result.score).toBe(Math.round((65 * 60 + 15 * filled + 10 * filled) / 90));
  expect(result.components.DESTINATION_UTILIZATION).toMatchObject({
    state: 'EVALUATED',
    coverage: 100,
  });
});

test('reported confidence applies coverage once at each scope without aggregating already discounted confidence', () => {
  const input = { ...day(), factors: { FEASIBILITY: evaluated(100, 50) } };
  expect(scoreDay(input).confidence).toBe(18); // 100 reliability × 17.5% daily coverage.
  const trip = scoreTrip({
    days: [input],
    components: {
      DESTINATION_UTILIZATION: NOT_APPLICABLE,
      VARIETY_COVERAGE: NOT_APPLICABLE,
      SEASONAL_FIT: NOT_APPLICABLE,
    },
  });
  // Daily quality is filled to full coverage, but the filling adds no reliability.
  expect(trip.confidence).toBe(18);
  expect(trip.evidenceCoverage).toBe(100);
  expect(toPlanScoreTripPayload(trip).days[0]).not.toHaveProperty('reliability');
});

test('non-meaningful venue evidence cannot dilute the verified conflict-day proportion', () => {
  const sparse = { dayId: 'conflict', factors: {}, hardConflictIds: ['verified'] };
  const unspecified = Array.from({ length: 5 }, (_, i) => ({
    dayId: `unspecified-${i}`,
    factors: { EXPERIENCE_QUALITY: evaluated() },
  }));
  const result = scoreTrip({ days: [day('meaningful'), sparse, ...unspecified] });
  expect(result.assessedDayCount).toBe(1);
  expect(result.applicableDayCount).toBe(7);
  expect(result.caps[0]?.limit).toBe(69);
});
