import { expect, test } from 'vitest';
import {
  explainDay,
  explainTrip,
  planReplacement,
  PLAN_SCORE_PRESERVED_ITEM_FIELDS,
} from '../src/services/plan-score-explanations.js';
import {
  scoreDay,
  scoreTrip,
  DAY_FACTOR_IDS,
  type PlanScoreFactorResult,
} from '../src/services/plan-score-rules.js';
const good: PlanScoreFactorResult = {
  state: 'EVALUATED',
  score: 100,
  evidence: [{ ref: 'owned', source: 'USER_OWNED' }],
};
const day = scoreDay({
  dayId: 'day',
  factors: Object.fromEntries(DAY_FACTOR_IDS.map((f) => [f, good])),
});
const input = {
  day,
  conflicts: [],
  alternatives: [],
  pace: { activeMinutes: 240, smallestBufferMinutes: null },
  route: { bestMinutes: null, plannedMinutes: null },
  travel: { totalMinutes: 30 },
};
test('every explanation has stable code, severity, references and a localization key', () => {
  const result = explainDay(input);
  expect(result.whatWorks).toHaveLength(4);
  for (const entry of result.whatWorks)
    expect(entry).toMatchObject({
      code: expect.any(String),
      messageKey: expect.any(String),
      severity: 'INFO',
      references: expect.any(Array),
    });
});
test('verified conflicts precede qualified risks and remain visible without a number', () => {
  const result = explainDay({
    ...input,
    day: { ...day, score: null },
    conflicts: [
      {
        id: 'risk',
        kind: 'TIGHT_TRANSITION',
        severity: 'SOFT',
        verified: false,
        deduction: 10,
        subjectIds: ['a', 'b'],
      },
      {
        id: 'closed',
        kind: 'OUTSIDE_OPENING_HOURS',
        severity: 'HARD',
        verified: true,
        deduction: 50,
        subjectIds: ['c'],
      },
    ],
  });
  expect(result.worthImproving.map((r) => r.code)).toEqual([
    'OUTSIDE_OPENING_HOURS',
    'TIGHT_TRANSITION',
  ]);
  expect(result.worthImproving[0]).toMatchObject({
    severity: 'HARD',
    action: 'ADJUST_TIME',
    references: ['c'],
  });
  expect(result.worthImproving[1]?.values).toEqual({ severity: 'ESTIMATED' });
});
test('sparse categories omit numbers and diagnostic filler without overstating strengths', () => {
  const result = explainDay({
    ...input,
    day: scoreDay({ dayId: 'sparse', factors: { EXPERIENCE_QUALITY: { ...good, coverage: 15 } } }),
  });
  expect(result.uncertainty).toEqual([]);
  expect(result.whatWorks).toEqual([]);
});
test('natural downtime is positive without meal stops', () => {
  const result = explainDay({
    ...input,
    advisories: [{ code: 'NATURAL_DOWNTIME', references: ['a', 'b'] }],
  });
  expect(result.uncertainty).toEqual([]);
  expect(result.worthImproving).toEqual([]);
  expect(result.whatWorks.at(-1)?.code).toBe('NATURAL_DOWNTIME');
});
test('trip explanations expose fatigue, weak days, caps and explicit unscheduled priorities', () => {
  const trip = scoreTrip({
    days: [
      {
        dayId: 'day',
        factors: day.factors.FEASIBILITY.state === 'EVALUATED' ? { FEASIBILITY: good } : {},
      },
      { dayId: 'unknown', factors: {} },
    ],
  });
  const result = explainTrip({
    components: trip.components,
    caps: [{ limit: 69, reason: 'TRIP_CONNECTION_CONFLICT', references: ['day'] }],
    fatigueAdjustment: 2,
    weakDayAdjustment: 3,
    unscheduledMustGoTripPlaceIds: ['priority'],
  });
  expect(result.worthImproving.map((r) => r.code)).toEqual([
    'TRIP_CONNECTION_CONFLICT',
    'SUSTAINED_LOAD',
    'WEAK_DAYS',
    'UNSCHEDULED_MUST_GO',
  ]);
  expect(result.worthImproving.at(-1)?.references).toEqual(['priority']);
});
test('Replace preserves compatible itinerary metadata and requests review of linked records', () => {
  const linkedRecords = [
    { id: 'booking', kind: 'RESERVATION' as const },
    { id: 'expense', kind: 'EXPENSE' as const },
  ];
  const result = planReplacement({
    linkedRecords,
    suggestion: {
      action: 'REPLACE',
      targetItemId: 'item',
      candidateTripPlaceId: 'new',
      candidateRating: 4.5,
      currentRating: 3.5,
      improvement: 30,
    },
  });
  expect(result.preservedFields).toEqual(PLAN_SCORE_PRESERVED_ITEM_FIELDS);
  expect(result.requiresReview).toEqual(linkedRecords);
  expect(linkedRecords).toHaveLength(2);
});

test('a reorder is raised only when it saves a proportion and real minutes', () => {
  const avoidable = (plannedMinutes: number, bestMinutes: number) =>
    explainDay({ ...input, route: { bestMinutes, plannedMinutes } }).worthImproving.find(
      (entry) => entry.code === 'AVOIDABLE_MOVEMENT',
    );
  expect(avoidable(80, 48)).toMatchObject({
    action: 'REORDER_MANUALLY',
    values: { plannedMinutes: 80, bestMinutes: 48 },
  });
  // A fifth faster, but only four minutes: within the straight-line estimate's error.
  expect(avoidable(20, 16)).toBeUndefined();
  // Ten minutes, but only a twentieth of a long day's travel.
  expect(avoidable(200, 190)).toBeUndefined();
});
