import { expect, test } from 'vitest';
import type { PlanScoreDayItem } from '../src/services/plan-score-factors.js';
import { evaluateScoredDay, type ScoredDayInput } from '../src/services/plan-score-evaluation.js';
import { scoreDay, scoreTrip } from '../src/services/plan-score-rules.js';
import { buildPlanScoreFromEvaluations, parseStoredPlanScore } from '../src/services/plan-score.js';

const at = (minutes: number) => ({ minutes, source: 'USER_OWNED' as const });
const stop = (id = 'custom', extra: Partial<PlanScoreDayItem> = {}): PlanScoreDayItem => ({
  id,
  blockType: 'activity',
  fixed: true,
  start: at(540),
  duration: at(90),
  startWindow: null,
  inboundTravel: null,
  openingHours: { status: 'UNKNOWN' },
  ...extra,
});
const day = (extra: Partial<ScoredDayInput> = {}): ScoredDayInput => ({
  dayId: 'day',
  date: '2026-10-01',
  items: [stop()],
  commitments: [],
  places: [],
  segments: [],
  preferences: { pace: 'balanced', interests: [], unmatchedInterests: [] },
  ...extra,
});
const evaluate = (extra: Partial<ScoredDayInput> = {}) => evaluateScoredDay(day(extra));

test('one timed custom stop scores without applicable movement, hours, ratings or linking prompts', () => {
  const evaluated = evaluate();
  const result = scoreDay(evaluated.input);
  expect(result).toMatchObject({
    score: 100,
    assessmentStatus: 'provisional',
    assessmentBasis: ['TIMING', 'ACTIVITY_LOAD'],
  });
  expect(result.factors.ROUTE_EFFICIENCY).toEqual({ state: 'NOT_APPLICABLE' });
  expect(evaluated.missingInformation).toEqual([]);
  expect(result.confidence).toBeLessThan(80);
  expect(result.caps).toEqual([]);
});

test('duration-only plans assess known activity time without inventing schedule evidence', () => {
  const evaluated = evaluate({ items: [stop('custom', { start: null, fixed: false })] });
  const result = scoreDay(evaluated.input);
  expect(result).toMatchObject({
    score: 100,
    assessmentStatus: 'provisional',
    assessmentBasis: ['ACTIVITY_LOAD'],
  });
  expect(result.factors.FEASIBILITY.state).toBe('UNKNOWN');
  expect(result.limitations).toContain('TIMING_UNKNOWN');
});

test('unknown configured base keeps travel unknown but cannot erase the single stop interval', () => {
  const evaluated = evaluate({
    items: [stop('custom', { inboundRequired: true })],
    segments: [{ id: 'base-custom', scope: 'LOCAL', status: 'UNKNOWN', itemIds: ['custom'] }],
  });
  expect(scoreDay(evaluated.input)).toMatchObject({ score: 100, assessmentStatus: 'provisional' });
  expect(evaluated.input.limitations).toContain('TRAVEL_TIME_UNKNOWN');
  expect(evaluated.travel.factor.state).toBe('UNKNOWN');
  expect(evaluated.input.loadRatio).toBeNull();
  expect(evaluated.pace.factor).toMatchObject({ state: 'EVALUATED', coverage: 50 });
  expect(evaluated.missingInformation).toEqual([]);
});

test('multiple unlocated stops retain intrinsic timing and count unknown legs in load coverage', () => {
  const evaluated = evaluate({
    items: [stop('a'), stop('b', { start: at(720) }), stop('c', { start: at(900) })],
    segments: [
      { id: 'a-b', scope: 'LOCAL', status: 'UNKNOWN', itemIds: ['a', 'b'] },
      { id: 'b-c', scope: 'LOCAL', status: 'UNKNOWN', itemIds: ['b', 'c'] },
    ],
  });
  expect(evaluated.pace.factor).toMatchObject({ state: 'EVALUATED', coverage: 60 });
  expect(evaluated.input.factors.FEASIBILITY).toMatchObject({ state: 'EVALUATED', coverage: 60 });
  expect(scoreDay(evaluated.input).score).toBe(100);
  expect(evaluated.missingInformation).toEqual([]);
});

test('partial routes contribute known effort without claiming complete route burden', () => {
  const evaluated = evaluate({
    items: [stop('a'), stop('b', { start: at(720), inboundTravel: at(30) })],
    segments: [
      {
        id: 'a-b',
        scope: 'LOCAL',
        status: 'KNOWN',
        duration: at(30),
        mode: 'walk',
        itemIds: ['a', 'b'],
      },
      { id: 'b-base', scope: 'LOCAL', status: 'UNKNOWN', itemIds: ['b'] },
    ],
  });
  expect(evaluated.travel.totalMinutes).toBeNull();
  expect(evaluated.pace.factor).toMatchObject({ coverage: 75, score: 100 });
  expect(evaluated.input.partialLoadRatio).toBeCloseTo((180 + 37.5) / 480);
});

test('unknown inbound movement preserves verified availability and commitment conflicts', () => {
  const evaluated = evaluate({
    items: [stop('a', { start: at(900), inboundRequired: true }), stop('b', { start: at(930) })],
    availability: { startMinute: 540, endMinute: 960 },
    segments: [{ id: 'unknown', scope: 'LOCAL', status: 'UNKNOWN', itemIds: ['a', 'b'] }],
  });
  expect(evaluated.conflicts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'OUTSIDE_AVAILABILITY', verified: true }),
      expect.objectContaining({
        kind: 'OVERLAPPING_COMMITMENTS',
        severity: 'HARD',
        verified: true,
      }),
    ]),
  );
  expect(scoreDay(evaluated.input).score).toBeLessThanOrEqual(59);
});

test('flexible daypart duration remains independently assessable with unknown inbound travel', () => {
  const evaluated = evaluate({
    items: [
      stop('a', {
        fixed: false,
        start: null,
        inboundRequired: true,
        startWindow: { earliestMinute: 540, latestMinute: 720, source: 'ESTIMATED' },
      }),
    ],
    segments: [{ id: 'base-a', scope: 'LOCAL', status: 'UNKNOWN', itemIds: ['a'] }],
  });
  expect(scoreDay(evaluated.input).score).toBe(100);
  expect(evaluated.input.assessmentBasis).toContain('TIMING');
});

test('known overload can score even when another activity duration is unspecified', () => {
  const evaluated = evaluate({
    items: [
      stop('a', { start: null, duration: at(720) }),
      stop('b', { start: null, duration: null }),
    ],
  });
  expect(evaluated.input.assessmentBasis).toEqual(['VERIFIED_PROBLEM']);
  expect(evaluated.pace.lowerBoundMinutes).toBe(720);
  expect(scoreDay(evaluated.input).score).toBeLessThan(100);
});

test('empty, labels-only and time-only plans have no meaningful basis', () => {
  for (const items of [
    [],
    [stop('label', { start: null, duration: null })],
    [stop('time', { duration: null })],
    [stop('zero', { duration: at(0) })],
  ]) {
    const evaluated = evaluate({ items });
    expect(scoreDay(evaluated.input).score).toBeNull();
    expect(scoreDay(evaluated.input).withheldReasons).toEqual(['NO_MEANINGFUL_EVIDENCE']);
  }
});

test('only access to a linked timed reservation warrants a scoring location action', () => {
  const evaluated = evaluate({
    items: [stop('booking', { inboundRequired: true })],
    commitments: [
      {
        id: 'reservation',
        itemId: 'booking',
        startMinute: 540,
        endMinute: 630,
        source: 'USER_OWNED',
      },
    ],
    segments: [{ id: 'base-booking', scope: 'LOCAL', status: 'UNKNOWN', itemIds: ['booking'] }],
  });
  expect(evaluated.missingInformation).toMatchObject([
    { code: 'TIMED_ACCESS_LOCATION', action: 'LINK_PLACE' },
  ]);
  const missingArrival = evaluate({
    commitments: [
      {
        id: 'journey',
        longDistance: true,
        endKnown: false,
        startMinute: 480,
        endMinute: 480,
        source: 'USER_OWNED',
      },
    ],
  });
  expect(missingArrival.missingInformation).toMatchObject([
    { code: 'MISSING_ARRIVAL', action: 'EDIT_TRANSFER' },
  ]);
});

test('partial load cannot recover debt; a known lower bound can increase it and complete rest can recover', () => {
  const a = evaluate({ dayId: 'demanding', items: [stop('a', { duration: at(720) })] }).input;
  const b = evaluate({
    dayId: 'partial-light',
    items: [stop('b'), stop('unknown', { duration: null })],
  }).input;
  const c = evaluate({
    dayId: 'partial-heavy',
    items: [stop('c', { duration: at(960) }), stop('unknown', { duration: null })],
  }).input;
  const d = evaluate({
    dayId: 'rest',
    items: [],
    planningContext: { intent: 'rest', availability: { start: '09:00', end: '17:00' } },
  }).input;
  const e = evaluate({ dayId: 'after-rest' }).input;
  const result = scoreTrip({
    days: [a, b, c, d, e].map((input, index) => ({ ...input, date: `2026-10-0${index + 1}` })),
  });
  expect(result.days.map((d) => d.incomingDebt)).toEqual([0, 0.6, 0.6, 1, 0.15000000000000002]);
});

test('one qualifying day scores a longer trip with partial coverage and hidden unsupported rows', () => {
  const result = scoreTrip({
    days: [
      evaluate().input,
      ...Array.from({ length: 4 }, (_, i) => evaluate({ dayId: `empty-${i}`, items: [] }).input),
    ],
  });
  expect(result).toMatchObject({
    score: 100,
    assessmentStatus: 'provisional',
    assessedDayCount: 1,
    applicableDayCount: 5,
  });
  expect(result.confidence).toBeLessThan(20);
  expect(result.limitations).toContain('UNASSESSED_DAYS');
  expect(result.components.DAILY_QUALITY.state).toBe('LIMITED');
});

test('v7 rejects v6 while retaining original freshness and evidence ages', () => {
  const score = buildPlanScoreFromEvaluations({
    days: [{ date: '2026-10-01', evaluation: evaluate() }],
    mustGoIds: [],
    scheduledIds: [],
    evaluatedAt: new Date('2026-09-29T12:00:00Z'),
    evidenceTimes: ['2026-09-20T00:00:00Z'],
    evidenceDeadlines: ['2026-10-20T00:00:00Z'],
  });
  expect(parseStoredPlanScore(score)).toEqual(score);
  expect(parseStoredPlanScore({ ...score, schemaVersion: 6, rubricVersion: 6 })).toBeNull();
  expect(score.evidenceAsOf).toBe('2026-09-20T00:00:00.000Z');
  expect(score.recomputeAfter).toBe('2026-09-30T12:00:00.000Z');
  expect(score.evidenceExpiresAt).toBe('2026-10-20T00:00:00.000Z');
});

test('a linked known long-distance journey counts once and permits complete load despite route placeholder', () => {
  const evaluated = evaluate({
    items: [stop('flight', { blockType: 'transport', longDistance: true, duration: at(600) })],
    commitments: [
      {
        id: 'booking',
        itemId: 'flight',
        longDistance: true,
        startMinute: 540,
        endMinute: 1140,
        endKnown: true,
        source: 'USER_OWNED',
      },
    ],
    segments: [{ id: 'flight', scope: 'LONG_DISTANCE', status: 'UNKNOWN', itemIds: ['flight'] }],
    places: [],
  });
  expect(evaluated.pace.activeMinutes).toBe(300);
  expect(evaluated.pace.factor).toMatchObject({ coverage: 100 });
  expect(evaluated.input.limitations).not.toContain('TRAVEL_TIME_UNKNOWN');
  expect(evaluated.input.loadRatio).toBeCloseTo(300 / 480);
});

test('a venue with hours but no planned timing cannot acquire an invented midnight conflict', () => {
  const evaluated = evaluate({
    items: [
      stop('venue', {
        placeId: 'venue',
        fixed: false,
        start: null,
        duration: null,
        openingHours: {
          status: 'KNOWN',
          source: 'CACHED_PROVIDER',
          intervals: [{ startMinute: 540, endMinute: 1020 }],
        },
      }),
    ],
  });
  expect(evaluated.conflicts).toEqual([]);
  expect(scoreDay(evaluated.input).score).toBeNull();
});

test('an unlocated origin warrants repair only when it prevents checking access to a timed booking', () => {
  const evaluated = evaluate({
    items: [stop('origin'), stop('booking', { start: at(720), placeId: 'located-booking' })],
    places: [
      {
        tripPlaceId: 'located-booking',
        rating: { status: 'UNKNOWN' },
        coordinates: { latitude: 1.3, longitude: 103.8 },
      },
    ],
    commitments: [
      {
        id: 'reservation',
        itemId: 'booking',
        startMinute: 720,
        endMinute: 810,
        source: 'USER_OWNED',
      },
    ],
    segments: [
      { id: 'origin-booking', scope: 'LOCAL', status: 'UNKNOWN', itemIds: ['origin', 'booking'] },
    ],
  });
  expect(evaluated.missingInformation).toMatchObject([
    { code: 'TIMED_ACCESS_LOCATION', references: ['origin'], action: 'LINK_PLACE' },
  ]);
});

test('a delayed flexible block cannot turn an estimated upstream duration into a verified availability cap', () => {
  const evaluated = evaluate({
    items: [
      stop('estimated', { duration: { minutes: 500, source: 'ESTIMATED' } }),
      stop('flexible', {
        fixed: false,
        start: null,
        duration: at(80),
        inboundTravel: at(0),
        startWindow: { earliestMinute: 600, latestMinute: 1200, source: 'USER_OWNED' },
      }),
    ],
    availability: { startMinute: 540, endMinute: 900 },
  });
  expect(evaluated.conflicts.every((c) => c.verified === false)).toBe(true);
  expect(scoreDay(evaluated.input).caps).toEqual([]);
});

test('a standalone unspecified transfer is required movement, not an inapplicable route', () => {
  const evaluated = evaluate({ items: [stop('transfer', { blockType: 'transport' })] });
  expect(evaluated.travel.factor.state).toBe('UNKNOWN');
  expect(evaluated.input.limitations).toContain('TRAVEL_TIME_UNKNOWN');
  expect(evaluated.missingInformation).toMatchObject([{ action: 'EDIT_TRANSFER' }]);
  expect(scoreDay(evaluated.input)).toMatchObject({ score: 100, assessmentStatus: 'provisional' });
});
