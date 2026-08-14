import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReplacementAlternatives,
  evaluateFeasibility,
  evaluateMustGoPriorityFit,
  evaluatePaceBuffer,
  evaluatePlaceQuality,
  evaluateRouteEfficiency,
  evaluateTravelEffort,
  type PlanScoreDayItem,
  type PlanScoreMinutes,
  type PlanScoreOpeningHours,
  type PlanScorePlace,
  type PlanScoreRouteSegment,
  type PlanScoreRouteStop,
} from '../src/services/plan-score-factors.js';
import {
  scoreDay,
  scoreTrip,
  type PlanScoreEvidenceSource,
  type PlanScoreFactorResult,
} from '../src/services/plan-score-rules.js';

function at(value: number, source: PlanScoreEvidenceSource = 'USER_OWNED'): PlanScoreMinutes {
  return { minutes: value, source };
}

function item(overrides: Partial<PlanScoreDayItem> & { id: string }): PlanScoreDayItem {
  return {
    duration: null,
    fixed: false,
    inboundTravel: null,
    openingHours: { status: 'UNKNOWN' },
    start: null,
    ...overrides,
  };
}

function local(minutes: number | null, id = `segment-${minutes}`): PlanScoreRouteSegment {
  return minutes === null
    ? { id, scope: 'LOCAL', status: 'UNKNOWN' }
    : { duration: at(minutes, 'FRESH_PROVIDER'), id, scope: 'LOCAL', status: 'KNOWN' };
}

function feasibilityScore(input: Parameters<typeof evaluateFeasibility>[0]) {
  const { factor } = evaluateFeasibility(input);
  return factor.state === 'EVALUATED' ? factor.score : null;
}

test('detects overlapping fixed commitments as a hard conflict', () => {
  const result = evaluateFeasibility({
    commitments: [],
    items: [
      item({ duration: at(120), fixed: true, id: 'museum', start: at(600) }),
      item({ duration: at(60), fixed: true, id: 'lunch', start: at(660) }),
    ],
  });

  assert.deepEqual(result.conflicts, [
    {
      deduction: 50,
      id: 'overlap:lunch:museum',
      kind: 'OVERLAPPING_COMMITMENTS',
      severity: 'HARD',
      subjectIds: ['lunch', 'museum'],
    },
  ]);
  assert.equal(result.factor.state === 'EVALUATED' && result.factor.score, 50);
});

test('deducts an overlapping reservation pair once rather than once per direction', () => {
  const result = evaluateFeasibility({
    commitments: [
      { endMinute: 720, id: 'tour', source: 'USER_OWNED', startMinute: 600 },
      { endMinute: 780, id: 'ferry', source: 'USER_OWNED', startMinute: 660 },
    ],
    items: [],
  });

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.factor.state === 'EVALUATED' && result.factor.score, 50);
});

test('separates visits entirely and partially outside known opening hours', () => {
  const hours: PlanScoreOpeningHours = {
    intervals: [{ endMinute: 1020, startMinute: 540 }],
    source: 'FRESH_PROVIDER',
    status: 'KNOWN',
  };

  const outside = evaluateFeasibility({
    commitments: [],
    items: [item({ duration: at(60), id: 'gallery', openingHours: hours, start: at(1200) })],
  });
  const partial = evaluateFeasibility({
    commitments: [],
    items: [item({ duration: at(120), id: 'gallery', openingHours: hours, start: at(960) })],
  });

  assert.equal(outside.conflicts[0]?.severity, 'HARD');
  assert.equal(outside.factor.state === 'EVALUATED' && outside.factor.score, 50);
  assert.equal(partial.conflicts[0]?.severity, 'MATERIAL');
  assert.equal(partial.factor.state === 'EVALUATED' && partial.factor.score, 75);
});

const feasibleDayItems = (hoursSource: PlanScoreEvidenceSource | null): PlanScoreDayItem[] => {
  const openingHours: PlanScoreOpeningHours =
    hoursSource === null
      ? { status: 'UNKNOWN' }
      : {
          intervals: [{ endMinute: 1020, startMinute: 540 }],
          source: hoursSource,
          status: 'KNOWN',
        };

  return [
    item({ duration: at(60), id: 'park', openingHours, start: at(540) }),
    item({
      duration: at(60),
      id: 'market',
      inboundTravel: at(30, 'FRESH_PROVIDER'),
      openingHours,
      start: at(660),
    }),
  ];
};

test('lets stale or missing opening hours lower confidence without penalizing the score', () => {
  const fresh = scoreDay({
    dayId: 'day',
    factors: {
      FEASIBILITY: evaluateFeasibility({
        commitments: [],
        items: feasibleDayItems('FRESH_PROVIDER'),
      }).factor,
    },
  });
  const stale = scoreDay({
    dayId: 'day',
    factors: {
      FEASIBILITY: evaluateFeasibility({ commitments: [], items: feasibleDayItems('STALE') })
        .factor,
    },
  });
  const missing = evaluateFeasibility({ commitments: [], items: feasibleDayItems(null) });

  assert.deepEqual(fresh.factors.FEASIBILITY, { confidence: 100, score: 100, state: 'EVALUATED' });
  assert.deepEqual(stale.factors.FEASIBILITY, { confidence: 79, score: 100, state: 'EVALUATED' });
  assert.deepEqual(missing.conflicts, []);
  assert.equal(missing.factor.state === 'EVALUATED' && missing.factor.score, 100);
});

test('uses each evidence point once even when several rubric checks read it', () => {
  const { factor } = evaluateFeasibility({
    commitments: [],
    items: feasibleDayItems('FRESH_PROVIDER'),
  });
  const refs = factor.state === 'EVALUATED' ? factor.evidence.map((entry) => entry.ref) : [];

  assert.deepEqual(refs.toSorted(), [
    'duration:market',
    'duration:park',
    'hours:market',
    'hours:park',
    'start:market',
    'start:park',
    'travel:market',
  ]);
});

function lateArrivalDay(fixedStartMinute: number, fixed = true) {
  return {
    commitments: [],
    items: [
      item({ duration: at(60), id: 'park', start: at(540) }),
      item({
        fixed,
        id: 'tour',
        inboundTravel: at(60, 'FRESH_PROVIDER'),
        start: at(fixedStartMinute),
      }),
    ],
  };
}

test('grades arrival against a fixed start using the 50/25/10 deduction contract', () => {
  assert.equal(feasibilityScore(lateArrivalDay(620)), 50);
  assert.equal(feasibilityScore(lateArrivalDay(650)), 75);
  assert.equal(feasibilityScore(lateArrivalDay(670)), 90);
  assert.equal(feasibilityScore(lateArrivalDay(700)), 100);
});

test('counts one late transition once instead of also charging it as tight', () => {
  const result = evaluateFeasibility(lateArrivalDay(620));

  assert.deepEqual(result.conflicts, [
    {
      deduction: 50,
      id: 'transition:tour',
      kind: 'ARRIVES_AFTER_FIXED_START',
      severity: 'HARD',
      subjectIds: ['park', 'tour'],
    },
  ]);
});

test('leaves a negative buffer before a movable item to pace rather than feasibility', () => {
  assert.equal(feasibilityScore(lateArrivalDay(620, false)), 100);
});

test('keeps known evidence usable when another item has no time or location', () => {
  const result = evaluateFeasibility({
    commitments: [],
    items: [...lateArrivalDay(620).items, item({ id: 'unplanned' })],
  });

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.factor.state === 'EVALUATED' && result.factor.score, 50);
});

test('reports feasibility as unknown when the day has no usable evidence', () => {
  const result = evaluateFeasibility({ commitments: [], items: [item({ id: 'unplanned' })] });

  assert.deepEqual(result.factor, { reason: 'MISSING_EVIDENCE', state: 'UNKNOWN' });
  assert.deepEqual(result.conflicts, []);
});

test('scores travel effort with the five known route-time bands', () => {
  const score = (segments: PlanScoreRouteSegment[]) => {
    const { factor } = evaluateTravelEffort(segments);
    return factor.state === 'EVALUATED' ? factor.score : null;
  };

  assert.equal(score([local(45)]), 100);
  assert.equal(score([local(60)]), 100);
  assert.equal(score([local(61)]), 85);
  assert.equal(score([local(30, 'a'), local(30, 'b'), local(30, 'c')]), 85);
  assert.equal(score([local(150)]), 70);
  assert.equal(score([local(200)]), 50);
  assert.equal(score([local(300)]), 30);
});

test('treats incomplete local route coverage as unknown rather than zero or worst case', () => {
  const partial = evaluateTravelEffort([local(30, 'known'), local(null, 'unknown')]);
  const none = evaluateTravelEffort([]);

  assert.deepEqual(partial, {
    factor: { reason: 'INSUFFICIENT_EVIDENCE', state: 'UNKNOWN' },
    totalMinutes: null,
  });
  assert.deepEqual(none, {
    factor: { reason: 'MISSING_EVIDENCE', state: 'UNKNOWN' },
    totalMinutes: null,
  });
});

test('scores a zero-minute total only when every required local segment is known', () => {
  const result = evaluateTravelEffort([local(0, 'a'), local(0, 'b')]);

  assert.equal(result.totalMinutes, 0);
  assert.equal(result.factor.state === 'EVALUATED' && result.factor.score, 100);
});

test('evaluates structured long-distance journeys as logistics, not local travel effort', () => {
  const withJourney = evaluateTravelEffort([
    local(30),
    { duration: at(300, 'USER_OWNED'), id: 'flight', scope: 'LONG_DISTANCE', status: 'KNOWN' },
    { id: 'ferry', scope: 'LONG_DISTANCE', status: 'UNKNOWN' },
  ]);
  const journeyOnly = evaluateTravelEffort([
    { duration: at(300, 'USER_OWNED'), id: 'flight', scope: 'LONG_DISTANCE', status: 'KNOWN' },
  ]);

  assert.equal(withJourney.totalMinutes, 30);
  assert.equal(withJourney.factor.state === 'EVALUATED' && withJourney.factor.score, 100);
  assert.deepEqual(journeyOnly.factor, { reason: 'MISSING_EVIDENCE', state: 'UNKNOWN' });
});

test('feeds both factors into the day contract without changing the inputs', () => {
  const feasibilityInput = lateArrivalDay(620);
  const segments = [local(30, 'a'), local(60, 'b')];
  const snapshot = structuredClone({ feasibilityInput, segments });

  const result = scoreDay({
    dayId: 'day',
    factors: {
      FEASIBILITY: evaluateFeasibility(feasibilityInput).factor,
      TRAVEL_EFFORT: evaluateTravelEffort(segments).factor,
    },
  });

  assert.equal(result.score, 65);
  assert.equal(result.completeness, 67);
  assert.deepEqual({ feasibilityInput, segments }, snapshot);
});

test('rejects impossible minute values instead of scoring them', () => {
  assert.throws(() => evaluateTravelEffort([local(Number.NaN)]), /invalid_plan_score_minutes/);
  assert.throws(
    () =>
      evaluateFeasibility({
        commitments: [{ endMinute: 600, id: 'tour', source: 'USER_OWNED', startMinute: -1 }],
        items: [],
      }),
    /invalid_plan_score_minutes/,
  );
});

function paceScore(input: Parameters<typeof evaluatePaceBuffer>[0]) {
  const { factor } = evaluatePaceBuffer(input);
  return factor.state === 'EVALUATED' ? factor.score : null;
}

test('separates an overpacked timed day from the same places with breathing room', () => {
  const overpacked = evaluatePaceBuffer({
    items: [
      item({ duration: at(180), id: 'a', start: at(540) }),
      item({ duration: at(180), id: 'b', inboundTravel: at(10, 'FRESH_PROVIDER'), start: at(730) }),
      item({ duration: at(180), id: 'c', inboundTravel: at(10, 'FRESH_PROVIDER'), start: at(920) }),
    ],
    segments: [local(10, 's1'), local(10, 's2')],
  });
  const spread = evaluatePaceBuffer({
    items: [
      item({ duration: at(120), id: 'a', start: at(540) }),
      item({ duration: at(120), id: 'b', inboundTravel: at(30, 'FRESH_PROVIDER'), start: at(720) }),
      item({ duration: at(120), id: 'c', inboundTravel: at(30, 'FRESH_PROVIDER'), start: at(900) }),
    ],
    segments: [local(30, 's1'), local(30, 's2')],
  });

  assert.equal(overpacked.factor.state === 'EVALUATED' && overpacked.factor.score, 40);
  assert.equal(overpacked.smallestBufferMinutes, 0);
  assert.equal(overpacked.activeMinutes, 560);
  assert.equal(spread.factor.state === 'EVALUATED' && spread.factor.score, 100);
  assert.equal(spread.smallestBufferMinutes, 30);
});

function bufferDay(startMinute: number) {
  return {
    items: [
      item({ duration: at(60), id: 'a', start: at(540) }),
      item({ id: 'b', inboundTravel: at(30, 'FRESH_PROVIDER'), start: at(startMinute) }),
    ],
    segments: [],
  };
}

test('grades the smallest transition buffer with the frozen pace bands', () => {
  assert.equal(paceScore(bufferDay(660)), 100);
  assert.equal(paceScore(bufferDay(650)), 80);
  assert.equal(paceScore(bufferDay(640)), 60);
  assert.equal(paceScore(bufferDay(632)), 40);
  assert.equal(paceScore(bufferDay(620)), 20);
});

test('grades a fully described day by known activity and local travel minutes', () => {
  const day = (durationMinutes: number) => ({
    items: [item({ duration: at(durationMinutes), id: 'a', start: at(540) })],
    segments: [],
  });

  assert.equal(paceScore(day(480)), 100);
  assert.equal(paceScore(day(540)), 75);
  assert.equal(paceScore(day(660)), 50);
  assert.equal(paceScore(day(800)), 25);
});

test('takes the lower pace rule when comfortable buffers still fill the whole day', () => {
  const result = evaluatePaceBuffer({
    items: [
      item({ duration: at(400), id: 'a', start: at(540) }),
      item({
        duration: at(400),
        id: 'b',
        inboundTravel: at(30, 'FRESH_PROVIDER'),
        start: at(1000),
      }),
    ],
    segments: [local(30, 's1')],
  });

  assert.equal(result.smallestBufferMinutes, 30);
  assert.equal(result.activeMinutes, 830);
  assert.equal(result.factor.state === 'EVALUATED' && result.factor.score, 25);
});

test('leaves pace unknown when neither timing nor full-day coverage is evaluable', () => {
  const untimed = evaluatePaceBuffer({ items: [item({ id: 'a' })], segments: [] });
  const partialRoutes = evaluatePaceBuffer({
    items: [item({ duration: at(120), id: 'a', start: at(540) })],
    segments: [local(30, 'known'), local(null, 'unknown')],
  });

  assert.deepEqual(untimed.factor, { reason: 'INSUFFICIENT_EVIDENCE', state: 'UNKNOWN' });
  assert.deepEqual(partialRoutes.factor, { reason: 'INSUFFICIENT_EVIDENCE', state: 'UNKNOWN' });
});

const LINE_STOPS = [
  { id: 'base', position: 0 },
  { id: 'x', position: 10 },
  { id: 'y', position: 20 },
  { id: 'z', position: 30 },
];

function lineLegs() {
  return LINE_STOPS.flatMap((from) =>
    LINE_STOPS.filter((to) => to.id !== from.id).map((to) => ({
      duration: at(Math.abs(from.position - to.position), 'FRESH_PROVIDER'),
      fromId: from.id,
      toId: to.id,
    })),
  );
}

function routeStops(order: string[], fixedIds: string[] = ['base']): PlanScoreRouteStop[] {
  return order.map((id) => ({ fixed: fixedIds.includes(id), id }));
}

test('identifies backtracking by comparing the planned order with the best available one', () => {
  const efficient = evaluateRouteEfficiency({
    legs: lineLegs(),
    stops: routeStops(['base', 'x', 'y', 'z']),
  });
  const detour = evaluateRouteEfficiency({
    legs: lineLegs(),
    stops: routeStops(['base', 'x', 'z', 'y']),
  });
  const backtracking = evaluateRouteEfficiency({
    legs: lineLegs(),
    stops: routeStops(['base', 'z', 'x', 'y']),
  });

  assert.deepEqual(
    { best: efficient.bestMinutes, planned: efficient.plannedMinutes },
    { best: 30, planned: 30 },
  );
  assert.equal(efficient.factor.state === 'EVALUATED' && efficient.factor.score, 100);
  assert.equal(detour.factor.state === 'EVALUATED' && detour.factor.score, 60);
  assert.equal(backtracking.factor.state === 'EVALUATED' && backtracking.factor.score, 40);
});

test('respects fixed-order commitments and never reorders the planned stops', () => {
  const stops = routeStops(['base', 'z', 'x', 'y'], ['base', 'z']);
  const snapshot = structuredClone(stops);
  const result = evaluateRouteEfficiency({ legs: lineLegs(), stops });

  assert.deepEqual(
    { best: result.bestMinutes, planned: result.plannedMinutes },
    { best: 50, planned: 60 },
  );
  assert.equal(result.factor.state === 'EVALUATED' && result.factor.score, 80);
  assert.deepEqual(stops, snapshot);
});

test('withholds route efficiency without three stops or complete planned legs', () => {
  const tooFewStops = evaluateRouteEfficiency({
    legs: lineLegs(),
    stops: routeStops(['base', 'x']),
  });
  const missingLeg = evaluateRouteEfficiency({
    legs: lineLegs().filter((leg) => !(leg.fromId === 'base' && leg.toId === 'x')),
    stops: routeStops(['base', 'x', 'y', 'z']),
  });
  const manyStops = Array.from({ length: 10 }, (_, index) => ({
    fixed: index === 0,
    id: `stop-${index}`,
  }));
  const oversized = evaluateRouteEfficiency({
    legs: manyStops.flatMap((from) =>
      manyStops
        .filter((to) => to.id !== from.id)
        .map((to) => ({ duration: at(10, 'FRESH_PROVIDER'), fromId: from.id, toId: to.id })),
    ),
    stops: manyStops,
  });

  assert.deepEqual(tooFewStops.factor, { state: 'NOT_APPLICABLE' });
  assert.deepEqual(missingLeg.factor, { reason: 'INSUFFICIENT_EVIDENCE', state: 'UNKNOWN' });
  assert.deepEqual(oversized.factor, { reason: 'UNUSABLE_EVIDENCE', state: 'UNKNOWN' });
  assert.equal(oversized.plannedMinutes, 90);
});

test('scores Must Go priority fit as the scheduled share of distinct priorities', () => {
  const partial = evaluateMustGoPriorityFit({
    mustGoTripPlaceIds: ['a', 'b', 'c', 'd'],
    scheduledTripPlaceIds: ['a', 'b', 'c', 'unrelated'],
    source: 'USER_OWNED',
  });
  const duplicated = evaluateMustGoPriorityFit({
    mustGoTripPlaceIds: ['a', 'a', 'b'],
    scheduledTripPlaceIds: ['a', 'a'],
    source: 'USER_OWNED',
  });
  const none = evaluateMustGoPriorityFit({
    mustGoTripPlaceIds: [],
    scheduledTripPlaceIds: ['a'],
    source: 'USER_OWNED',
  });

  assert.equal(partial.state === 'EVALUATED' && partial.score, 75);
  assert.equal(partial.state === 'EVALUATED' && partial.evidence.length, 4);
  assert.equal(duplicated.state === 'EVALUATED' && duplicated.score, 50);
  assert.deepEqual(none, { state: 'NOT_APPLICABLE' });
});

test('keeps Must Go priority fit at trip scope only', () => {
  const mustGoPriorityFit = evaluateMustGoPriorityFit({
    mustGoTripPlaceIds: ['a', 'b'],
    scheduledTripPlaceIds: ['a'],
    source: 'USER_OWNED',
  });
  const trip = scoreTrip({
    days: [
      {
        dayId: 'day',
        factors: {
          FEASIBILITY: {
            evidence: [{ ref: 'f', source: 'USER_OWNED' }],
            score: 100,
            state: 'EVALUATED',
          },
          TRAVEL_EFFORT: {
            evidence: [{ ref: 't', source: 'USER_OWNED' }],
            score: 100,
            state: 'EVALUATED',
          },
        },
      },
    ],
    mustGoPriorityFit,
  });

  assert.deepEqual(trip.mustGoPriorityFit, { confidence: 100, score: 50, state: 'EVALUATED' });
  assert.equal(trip.score, 95);
  assert.equal(Object.keys(trip.days[0]?.factors ?? {}).includes('MUST_GO_PRIORITY_FIT'), false);
});

function rated(
  tripPlaceId: string,
  rating: number | null,
  source: PlanScoreEvidenceSource = 'CACHED_PROVIDER',
): PlanScorePlace {
  return {
    rating: rating === null ? { status: 'UNKNOWN' } : { rating, source, status: 'KNOWN' },
    tripPlaceId,
  };
}

test('maps public ratings onto the frozen place-quality bands', () => {
  const score = (rating: number) => {
    const factor = evaluatePlaceQuality([rated('place', rating)]);
    return factor.state === 'EVALUATED' ? factor.score : null;
  };

  assert.equal(score(4.7), 100);
  assert.equal(score(4.2), 85);
  assert.equal(score(3.7), 70);
  assert.equal(score(3.2), 55);
  assert.equal(score(2.5), 40);
});

test('excludes unrated Places and counts each Trip Place once', () => {
  const mixed = evaluatePlaceQuality([rated('a', 4.7), rated('b', null), rated('c', 3.2)]);
  const repeated = evaluatePlaceQuality([rated('a', 4.7), rated('a', 4.7), rated('c', 3.2)]);
  const unrated = evaluatePlaceQuality([rated('a', null), rated('b', null)]);

  assert.equal(mixed.state === 'EVALUATED' && mixed.score, 77.5);
  assert.equal(mixed.state === 'EVALUATED' && mixed.evidence.length, 2);
  assert.equal(repeated.state === 'EVALUATED' && repeated.score, 77.5);
  assert.deepEqual(unrated, { reason: 'MISSING_EVIDENCE', state: 'UNKNOWN' });
  assert.throws(() => evaluatePlaceQuality([rated('a', 5.4)]), /invalid_public_rating/);
});

test('keeps place quality from outweighing feasibility and travel effort', () => {
  const evaluated = (score: number): PlanScoreFactorResult => ({
    evidence: [{ ref: 'evidence', source: 'USER_OWNED' }],
    score,
    state: 'EVALUATED',
  });
  const higherRated = scoreDay({
    dayId: 'higher-rated',
    factors: {
      FEASIBILITY: evaluated(50),
      PLACE_QUALITY: evaluatePlaceQuality([rated('a', 4.7)]),
      TRAVEL_EFFORT: evaluated(30),
    },
  });
  const moreFeasible = scoreDay({
    dayId: 'more-feasible',
    factors: {
      FEASIBILITY: evaluated(100),
      PLACE_QUALITY: evaluatePlaceQuality([rated('a', 2.5)]),
      TRAVEL_EFFORT: evaluated(100),
    },
  });

  assert.equal(higherRated.score, 46);
  assert.equal(moreFeasible.score, 95);
});

test('suggests a replacement only for a material, provider-backed improvement', () => {
  const candidates = [
    { candidate: rated('great', 4.7), current: rated('poor', 3.2), targetItemId: 'item-1' },
    { candidate: rated('band-up', 4.6), current: rated('good', 4.2), targetItemId: 'item-2' },
    {
      candidate: rated('marginal', 4.9),
      current: rated('already-great', 4.6),
      targetItemId: 'item-3',
    },
    { candidate: rated('unrated', null), current: rated('poor', 3.2), targetItemId: 'item-4' },
  ];
  const snapshot = structuredClone(candidates);

  assert.deepEqual(buildReplacementAlternatives(candidates), [
    { action: 'REPLACE', candidateTripPlaceId: 'great', improvement: 45, targetItemId: 'item-1' },
    { action: 'REPLACE', candidateTripPlaceId: 'band-up', improvement: 15, targetItemId: 'item-2' },
  ]);
  assert.deepEqual(candidates, snapshot);
});

test('keeps alternatives out of the weighted score', () => {
  const places = [rated('poor', 3.2)];
  const factors = { PLACE_QUALITY: evaluatePlaceQuality(places) };
  const before = scoreDay({ dayId: 'day', factors });

  buildReplacementAlternatives([
    { candidate: rated('great', 4.7), current: places[0] ?? rated('poor', 3.2), targetItemId: 'i' },
  ]);

  assert.deepEqual(scoreDay({ dayId: 'day', factors }), before);
  assert.deepEqual(Object.keys(before.factors).toSorted(), [
    'FEASIBILITY',
    'PACE_BUFFER',
    'PLACE_QUALITY',
    'ROUTE_EFFICIENCY',
    'TRAVEL_EFFORT',
  ]);
});
