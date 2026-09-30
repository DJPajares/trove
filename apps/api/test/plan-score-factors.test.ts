import { expect, test } from 'vitest';
import {
  evaluateFeasibility,
  evaluatePlaceQuality,
  evaluateTravelEffort,
  evaluateRouteEfficiency,
  evaluateMustGoPriorityFit,
  buildReplacementAlternatives,
  type PlanScoreDayItem,
  type PlanScoreMinutes,
  type PlanScorePlace,
} from '../src/services/plan-score-factors.js';
import { evidenceConfidence } from '../src/services/plan-score-rules.js';
const at = (
  minutes: number,
  source: PlanScoreMinutes['source'] = 'USER_OWNED',
): PlanScoreMinutes => ({ minutes, source });
const item = (id: string, overrides: Partial<PlanScoreDayItem> = {}): PlanScoreDayItem => ({
  id,
  duration: null,
  fixed: false,
  start: null,
  startWindow: null,
  inboundTravel: null,
  openingHours: { status: 'UNKNOWN' },
  ...overrides,
});
const local = (minutes: number | null, id = 'leg') =>
  minutes === null
    ? { id, scope: 'LOCAL' as const, status: 'UNKNOWN' as const }
    : {
        id,
        scope: 'LOCAL' as const,
        status: 'KNOWN' as const,
        duration: at(minutes, 'CACHED_PROVIDER'),
      };
const value = (result: ReturnType<typeof evaluatePlaceQuality>) =>
  result.state === 'EVALUATED' ? result.score : null;
const rated = (id: string, rating: number | null, count?: number): PlanScorePlace => ({
  tripPlaceId: id,
  rating:
    rating === null
      ? { status: 'UNKNOWN' }
      : { status: 'KNOWN', rating, reviewCount: count, source: 'CACHED_PROVIDER' },
});

test.each([
  [0, 100],
  [60, 100],
  [61, 85],
  [120, 85],
  [121, 70],
  [180, 70],
  [181, 50],
  [240, 50],
  [241, 30],
])('local burden at %i minutes scores %i', (minutes, score) => {
  expect(value(evaluateTravelEffort([local(minutes)]).factor)).toBe(score);
});
test('partial local legs and an absent route never imply zero travel', () => {
  expect(evaluateTravelEffort([local(0), local(null, 'missing')]).factor.state).toBe('UNKNOWN');
  expect(evaluateTravelEffort([]).factor.state).toBe('UNKNOWN');
  expect(value(evaluateTravelEffort([local(0)]).factor)).toBe(100);
});
test('long-distance transport is excluded from local travel burden', () => {
  const flight = {
    id: 'flight',
    scope: 'LONG_DISTANCE' as const,
    status: 'KNOWN' as const,
    duration: at(1200),
  };
  expect(evaluateTravelEffort([flight]).factor.state).toBe('NOT_APPLICABLE');
  expect(evaluateTravelEffort([flight, local(30)]).totalMinutes).toBe(30);
});
test('fixed overlap and the resulting late transition deduct only once', () => {
  const result = evaluateFeasibility({
    commitments: [],
    items: [
      item('a', { fixed: true, start: at(600), duration: at(120) }),
      item('b', { fixed: true, start: at(660), duration: at(60), inboundTravel: at(0) }),
    ],
  });
  expect(result.conflicts).toHaveLength(1);
  expect(value(result.factor)).toBe(50);
  expect(result.conflicts[0]).toMatchObject({
    kind: 'OVERLAPPING_COMMITMENTS',
    verified: true,
    severity: 'HARD',
  });
});
test.each([
  [620, 'HARD', 50],
  [650, 'MATERIAL', 75],
  [670, 'SOFT', 90],
  [700, null, 100],
])('fixed arrival at %i follows the deduction bands', (start, severity, score) => {
  const result = evaluateFeasibility({
    commitments: [],
    items: [
      item('a', { fixed: true, start: at(540), duration: at(60) }),
      item('b', {
        fixed: true,
        start: at(start),
        duration: at(30),
        inboundTravel: at(60, 'CACHED_PROVIDER'),
      }),
    ],
  });
  expect(result.conflicts[0]?.severity ?? null).toBe(severity);
  expect(value(result.factor)).toBe(score);
});
test('linked reservations cannot conflict with their own itinerary item', () => {
  const result = evaluateFeasibility({
    commitments: [
      { id: 'booking', itemId: 'a', source: 'USER_OWNED', startMinute: 600, endMinute: 660 },
    ],
    items: [item('a', { fixed: true, start: at(600), duration: at(60) })],
  });
  expect(result.conflicts).toEqual([]);
  expect(value(result.factor)).toBe(100);
});
test('a timed point can conflict with a verified occupied interval without inventing its duration', () => {
  const result = evaluateFeasibility({
    commitments: [{ id: 'train', source: 'USER_OWNED', startMinute: 600, endMinute: 660 }],
    items: [item('a', { fixed: true, start: at(630) })],
  });
  expect(result.conflicts[0]).toMatchObject({ kind: 'OVERLAPPING_COMMITMENTS', verified: true });
});
test.each([
  [4.75, 100],
  [4.25, 92.5],
  [3.75, 77.5],
  [3.25, 62.5],
  [1.5, 47.5],
  [0, 40],
])('ratings interpolate at %f to %f', (rating, score) => {
  expect(value(evaluatePlaceQuality([rated('p', rating)]))).toBe(score);
});
test('review count changes confidence, never quality or popularity value', () => {
  const small = evaluatePlaceQuality([rated('p', 4.5, 5)]),
    large = evaluatePlaceQuality([rated('p', 4.5, 500)]);
  expect(value(small)).toBe(value(large));
  expect(small.state === 'EVALUATED' && evidenceConfidence(small.evidence)).toBeCloseTo(
    (75 * 5) / 55,
  );
  expect(large.state === 'EVALUATED' && evidenceConfidence(large.evidence)).toBeCloseTo(
    (75 * 500) / 550,
  );
});
test('unrated places reduce coverage without lowering rated quality; duplicate visits add no confidence', () => {
  const result = evaluatePlaceQuality([
    rated('a', 4.5, 50),
    rated('a', 4.5, 50),
    rated('custom', null),
  ]);
  expect(result).toMatchObject({ score: 100, coverage: 50 });
  expect(result.state === 'EVALUATED' && result.evidence).toHaveLength(1);
  expect(evaluatePlaceQuality([rated('custom', null)]).state).toBe('UNKNOWN');
});
const positions = { base: 0, a: 10, b: 20, c: 30 };
const legs = () =>
  Object.entries(positions).flatMap(([fromId, from]) =>
    Object.entries(positions)
      .filter(([to]) => to !== fromId)
      .map(([toId, to]) => ({
        fromId,
        toId,
        duration: at(Math.abs(from - to), 'CACHED_PROVIDER'),
      })),
  );
const stops = (ids: string[]) => ids.map((id) => ({ id, fixed: id === 'base' }));
test('only complete routes and feasible alternative orders support avoidable movement', () => {
  const input = { stops: stops(['base', 'c', 'a', 'b']), legs: legs() };
  expect(evaluateRouteEfficiency(input).factor.state).toBe('UNKNOWN');
  expect(evaluateRouteEfficiency({ ...input, isFeasibleOrder: () => false }).factor.state).toBe(
    'UNKNOWN',
  );
  const result = evaluateRouteEfficiency({ ...input, isFeasibleOrder: () => true });
  expect(result).toMatchObject({ plannedMinutes: 60, bestMinutes: 30, factor: { score: 40 } });
});
test('the best order is returned so it can be previewed, with fixed stops in place', () => {
  const result = evaluateRouteEfficiency({
    stops: stops(['base', 'c', 'a', 'b']),
    legs: legs(),
    isFeasibleOrder: () => true,
  });
  expect(result.bestOrder).toStrictEqual(['base', 'a', 'b', 'c']);

  const scheduled = evaluateRouteEfficiency({
    stops: stops(['base', 'c', 'a', 'b']),
    legs: legs(),
    isFeasibleOrder: (order) => order[1] === 'c',
  });
  expect(scheduled.bestOrder?.[1]).toBe('c');
});
test('planned legs alone cannot establish optimality, even when their coordinates cluster', () => {
  const input = {
    stops: stops(['base', 'a', 'b', 'c']),
    legs: legs().filter(
      (l) =>
        (l.fromId === 'base' && l.toId === 'a') ||
        (l.fromId === 'a' && l.toId === 'b') ||
        (l.fromId === 'b' && l.toId === 'c'),
    ),
    isFeasibleOrder: () => true,
  };
  expect(evaluateRouteEfficiency(input).factor.state).toBe('UNKNOWN');
});
test('an evidenced faster order rejected by scheduling is not a scoring improvement', () => {
  const result = evaluateRouteEfficiency({
    stops: stops(['base', 'c', 'a', 'b']),
    legs: legs(),
    isFeasibleOrder: (order) => order[1] === 'c',
  });
  expect(result).toMatchObject({ plannedMinutes: 60, bestMinutes: 50, factor: { score: 80 } });
});
test('Must Go uses distinct scheduled priorities, with no generic landmark quota', () => {
  expect(
    value(
      evaluateMustGoPriorityFit({
        mustGoTripPlaceIds: ['a', 'a', 'b'],
        scheduledTripPlaceIds: ['a'],
        source: 'USER_OWNED',
      }),
    ),
  ).toBe(50);
  expect(
    evaluateMustGoPriorityFit({
      mustGoTripPlaceIds: [],
      scheduledTripPlaceIds: [],
      source: 'USER_OWNED',
    }).state,
  ).toBe('NOT_APPLICABLE');
});
test('existing replacement suggestions stay advisory and do not mutate evidence', () => {
  const candidates = [
    { candidate: rated('better', 4.5), current: rated('current', 3.5), targetItemId: 'a' },
  ];
  const original = structuredClone(candidates);
  expect(buildReplacementAlternatives(candidates)).toMatchObject([
    { action: 'REPLACE', improvement: 30 },
  ]);
  expect(candidates).toEqual(original);
});
