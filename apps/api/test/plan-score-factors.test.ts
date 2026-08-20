import { expect, test } from 'vitest';

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
    startWindow: null,
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

  expect(result.conflicts).toStrictEqual([
    {
      deduction: 50,
      id: 'overlap:lunch:museum',
      kind: 'OVERLAPPING_COMMITMENTS',
      severity: 'HARD',
      subjectIds: ['lunch', 'museum'],
    },
  ]);
  expect(result.factor.state === 'EVALUATED' && result.factor.score).toBe(50);
});

test('deducts an overlapping reservation pair once rather than once per direction', () => {
  const result = evaluateFeasibility({
    commitments: [
      { endMinute: 720, id: 'tour', source: 'USER_OWNED', startMinute: 600 },
      { endMinute: 780, id: 'ferry', source: 'USER_OWNED', startMinute: 660 },
    ],
    items: [],
  });

  expect(result.conflicts.length).toBe(1);
  expect(result.factor.state === 'EVALUATED' && result.factor.score).toBe(50);
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

  expect(outside.conflicts[0]?.severity).toBe('HARD');
  expect(outside.factor.state === 'EVALUATED' && outside.factor.score).toBe(50);
  expect(partial.conflicts[0]?.severity).toBe('MATERIAL');
  expect(partial.factor.state === 'EVALUATED' && partial.factor.score).toBe(75);
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

  expect(fresh.factors.FEASIBILITY).toStrictEqual({
    confidence: 100,
    score: 100,
    state: 'EVALUATED',
  });
  expect(stale.factors.FEASIBILITY).toStrictEqual({
    confidence: 79,
    score: 100,
    state: 'EVALUATED',
  });
  expect(missing.conflicts).toStrictEqual([]);
  expect(missing.factor.state === 'EVALUATED' && missing.factor.score).toBe(100);
});

test('uses each evidence point once even when several rubric checks read it', () => {
  const { factor } = evaluateFeasibility({
    commitments: [],
    items: feasibleDayItems('FRESH_PROVIDER'),
  });
  const refs = factor.state === 'EVALUATED' ? factor.evidence.map((entry) => entry.ref) : [];

  expect(refs.toSorted()).toStrictEqual([
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
  expect(feasibilityScore(lateArrivalDay(620))).toBe(50);
  expect(feasibilityScore(lateArrivalDay(650))).toBe(75);
  expect(feasibilityScore(lateArrivalDay(670))).toBe(90);
  expect(feasibilityScore(lateArrivalDay(700))).toBe(100);
});

test('counts one late transition once instead of also charging it as tight', () => {
  const result = evaluateFeasibility(lateArrivalDay(620));

  expect(result.conflicts).toStrictEqual([
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
  expect(feasibilityScore(lateArrivalDay(620, false))).toBe(100);
});

test('keeps known evidence usable when another item has no time or location', () => {
  const result = evaluateFeasibility({
    commitments: [],
    items: [...lateArrivalDay(620).items, item({ id: 'unplanned' })],
  });

  expect(result.conflicts.length).toBe(1);
  expect(result.factor.state === 'EVALUATED' && result.factor.score).toBe(50);
});

test('reports feasibility as unknown when the day has no usable evidence', () => {
  const result = evaluateFeasibility({ commitments: [], items: [item({ id: 'unplanned' })] });

  expect(result.factor).toStrictEqual({ reason: 'MISSING_EVIDENCE', state: 'UNKNOWN' });
  expect(result.conflicts).toStrictEqual([]);
});

test('scores travel effort with the five known route-time bands', () => {
  const score = (segments: PlanScoreRouteSegment[]) => {
    const { factor } = evaluateTravelEffort(segments);
    return factor.state === 'EVALUATED' ? factor.score : null;
  };

  expect(score([local(45)])).toBe(100);
  expect(score([local(60)])).toBe(100);
  expect(score([local(61)])).toBe(85);
  expect(score([local(30, 'a'), local(30, 'b'), local(30, 'c')])).toBe(85);
  expect(score([local(150)])).toBe(70);
  expect(score([local(200)])).toBe(50);
  expect(score([local(300)])).toBe(30);
});

test('treats incomplete local route coverage as unknown rather than zero or worst case', () => {
  const partial = evaluateTravelEffort([local(30, 'known'), local(null, 'unknown')]);
  const none = evaluateTravelEffort([]);

  expect(partial).toStrictEqual({
    factor: { reason: 'INSUFFICIENT_EVIDENCE', state: 'UNKNOWN' },
    totalMinutes: null,
  });
  expect(none).toStrictEqual({
    factor: { reason: 'MISSING_EVIDENCE', state: 'UNKNOWN' },
    totalMinutes: null,
  });
});

test('scores a zero-minute total only when every required local segment is known', () => {
  const result = evaluateTravelEffort([local(0, 'a'), local(0, 'b')]);

  expect(result.totalMinutes).toBe(0);
  expect(result.factor.state === 'EVALUATED' && result.factor.score).toBe(100);
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

  expect(withJourney.totalMinutes).toBe(30);
  expect(withJourney.factor.state === 'EVALUATED' && withJourney.factor.score).toBe(100);
  // Deliberate recalibration: a day whose only movement is long-distance has no
  // local travel to weigh, so the factor drops out of the weight base instead of
  // costing completeness. Treating it as missing evidence withheld the score of
  // flight days for information Trove never intended to hold.
  expect(journeyOnly.factor).toStrictEqual({ state: 'NOT_APPLICABLE' });
  expect(journeyOnly.totalMinutes).toBe(null);
});

test('a day with no segments at all is still missing evidence, not inapplicable', () => {
  const empty = evaluateTravelEffort([]);

  expect(empty.factor).toStrictEqual({ reason: 'MISSING_EVIDENCE', state: 'UNKNOWN' });
  expect(empty.totalMinutes).toBe(null);
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

  expect(result.score).toBe(65);
  expect(result.completeness).toBe(67);
  expect({ feasibilityInput, segments }).toStrictEqual(snapshot);
});

test('rejects impossible minute values instead of scoring them', () => {
  expect(() => evaluateTravelEffort([local(Number.NaN)])).toThrow(/invalid_plan_score_minutes/);
  expect(() =>
    evaluateFeasibility({
      commitments: [{ endMinute: 600, id: 'tour', source: 'USER_OWNED', startMinute: -1 }],
      items: [],
    }),
  ).toThrow(/invalid_plan_score_minutes/);
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

  expect(overpacked.factor.state === 'EVALUATED' && overpacked.factor.score).toBe(40);
  expect(overpacked.smallestBufferMinutes).toBe(0);
  expect(overpacked.activeMinutes).toBe(560);
  expect(spread.factor.state === 'EVALUATED' && spread.factor.score).toBe(100);
  expect(spread.smallestBufferMinutes).toBe(30);
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
  expect(paceScore(bufferDay(660))).toBe(100);
  expect(paceScore(bufferDay(650))).toBe(80);
  expect(paceScore(bufferDay(640))).toBe(60);
  expect(paceScore(bufferDay(632))).toBe(40);
  expect(paceScore(bufferDay(620))).toBe(20);
});

test('grades a fully described day by known activity and local travel minutes', () => {
  const day = (durationMinutes: number) => ({
    items: [item({ duration: at(durationMinutes), id: 'a', start: at(540) })],
    segments: [],
  });

  expect(paceScore(day(480))).toBe(100);
  expect(paceScore(day(540))).toBe(75);
  expect(paceScore(day(660))).toBe(50);
  expect(paceScore(day(800))).toBe(25);
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

  expect(result.smallestBufferMinutes).toBe(30);
  expect(result.activeMinutes).toBe(830);
  expect(result.factor.state === 'EVALUATED' && result.factor.score).toBe(25);
});

test('leaves pace unknown when neither timing nor full-day coverage is evaluable', () => {
  const untimed = evaluatePaceBuffer({ items: [item({ id: 'a' })], segments: [] });
  const partialRoutes = evaluatePaceBuffer({
    items: [item({ duration: at(120), id: 'a', start: at(540) })],
    segments: [local(30, 'known'), local(null, 'unknown')],
  });

  expect(untimed.factor).toStrictEqual({ reason: 'INSUFFICIENT_EVIDENCE', state: 'UNKNOWN' });
  expect(partialRoutes.factor).toStrictEqual({ reason: 'INSUFFICIENT_EVIDENCE', state: 'UNKNOWN' });
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

  expect({ best: efficient.bestMinutes, planned: efficient.plannedMinutes }).toStrictEqual({
    best: 30,
    planned: 30,
  });
  expect(efficient.factor.state === 'EVALUATED' && efficient.factor.score).toBe(100);
  expect(detour.factor.state === 'EVALUATED' && detour.factor.score).toBe(60);
  expect(backtracking.factor.state === 'EVALUATED' && backtracking.factor.score).toBe(40);
});

test('respects fixed-order commitments and never reorders the planned stops', () => {
  const stops = routeStops(['base', 'z', 'x', 'y'], ['base', 'z']);
  const snapshot = structuredClone(stops);
  const result = evaluateRouteEfficiency({ legs: lineLegs(), stops });

  expect({ best: result.bestMinutes, planned: result.plannedMinutes }).toStrictEqual({
    best: 50,
    planned: 60,
  });
  expect(result.factor.state === 'EVALUATED' && result.factor.score).toBe(80);
  expect(stops).toStrictEqual(snapshot);
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

  expect(tooFewStops.factor).toStrictEqual({ state: 'NOT_APPLICABLE' });
  expect(missingLeg.factor).toStrictEqual({ reason: 'INSUFFICIENT_EVIDENCE', state: 'UNKNOWN' });
  expect(oversized.factor).toStrictEqual({ reason: 'UNUSABLE_EVIDENCE', state: 'UNKNOWN' });
  expect(oversized.plannedMinutes).toBe(90);
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

  expect(partial.state === 'EVALUATED' && partial.score).toBe(75);
  expect(partial.state === 'EVALUATED' && partial.evidence.length).toBe(4);
  expect(duplicated.state === 'EVALUATED' && duplicated.score).toBe(50);
  expect(none).toStrictEqual({ state: 'NOT_APPLICABLE' });
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

  expect(trip.mustGoPriorityFit).toStrictEqual({ confidence: 100, score: 50, state: 'EVALUATED' });
  expect(trip.score).toBe(95);
  expect(Object.keys(trip.days[0]?.factors ?? {}).includes('MUST_GO_PRIORITY_FIT')).toBe(false);
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

  expect(score(4.7)).toBe(100);
  expect(score(4.2)).toBe(85);
  expect(score(3.7)).toBe(70);
  expect(score(3.2)).toBe(55);
  expect(score(2.5)).toBe(40);
});

test('excludes unrated Places and counts each Trip Place once', () => {
  const mixed = evaluatePlaceQuality([rated('a', 4.7), rated('b', null), rated('c', 3.2)]);
  const repeated = evaluatePlaceQuality([rated('a', 4.7), rated('a', 4.7), rated('c', 3.2)]);
  const unrated = evaluatePlaceQuality([rated('a', null), rated('b', null)]);

  expect(mixed.state === 'EVALUATED' && mixed.score).toBe(77.5);
  expect(mixed.state === 'EVALUATED' && mixed.evidence.length).toBe(2);
  expect(repeated.state === 'EVALUATED' && repeated.score).toBe(77.5);
  expect(unrated).toStrictEqual({ reason: 'MISSING_EVIDENCE', state: 'UNKNOWN' });
  expect(() => evaluatePlaceQuality([rated('a', 5.4)])).toThrow(/invalid_public_rating/);
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

  expect(higherRated.score).toBe(46);
  expect(moreFeasible.score).toBe(95);
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

  expect(buildReplacementAlternatives(candidates)).toStrictEqual([
    {
      action: 'REPLACE',
      candidateRating: 4.7,
      candidateTripPlaceId: 'great',
      currentRating: 3.2,
      improvement: 45,
      targetItemId: 'item-1',
    },
    {
      action: 'REPLACE',
      candidateRating: 4.6,
      candidateTripPlaceId: 'band-up',
      currentRating: 4.2,
      improvement: 15,
      targetItemId: 'item-2',
    },
  ]);
  expect(candidates).toStrictEqual(snapshot);
});

test('keeps alternatives out of the weighted score', () => {
  const places = [rated('poor', 3.2)];
  const factors = { PLACE_QUALITY: evaluatePlaceQuality(places) };
  const before = scoreDay({ dayId: 'day', factors });

  buildReplacementAlternatives([
    { candidate: rated('great', 4.7), current: places[0] ?? rated('poor', 3.2), targetItemId: 'i' },
  ]);

  expect(scoreDay({ dayId: 'day', factors })).toStrictEqual(before);
  expect(Object.keys(before.factors).toSorted()).toStrictEqual([
    'FEASIBILITY',
    'PACE_BUFFER',
    'PLACE_QUALITY',
    'ROUTE_EFFICIENCY',
    'TRAVEL_EFFORT',
  ]);
});

const MORNING = { earliestMinute: 0, latestMinute: 720, source: 'ESTIMATED' } as const;
const EVENING = { earliestMinute: 1020, latestMinute: 1440, source: 'ESTIMATED' } as const;

function knownHours(startMinute: number, endMinute: number): PlanScoreOpeningHours {
  return { intervals: [{ endMinute, startMinute }], source: 'FRESH_PROVIDER', status: 'KNOWN' };
}

test('a daypart that cannot fit inside opening hours at all is a hard conflict', () => {
  const result = evaluateFeasibility({
    commitments: [],
    items: [
      item({
        duration: at(60),
        id: 'gallery',
        openingHours: knownHours(540, 1020),
        startWindow: EVENING,
      }),
    ],
  });

  expect(result.conflicts[0]?.severity).toBe('HARD');
  expect(result.conflicts[0]?.kind).toBe('OUTSIDE_OPENING_HOURS');
});

test('a daypart with one workable placement is not a conflict at all', () => {
  const result = evaluateFeasibility({
    commitments: [],
    items: [
      item({
        duration: at(60),
        id: 'gallery',
        openingHours: knownHours(600, 840),
        startWindow: MORNING,
      }),
    ],
  });

  expect(result.conflicts).toStrictEqual([]);
  // The daypart is what made the check possible, so it is recorded as the
  // estimated evidence it is rather than passing for a user-owned time.
  const refs = result.factor.state === 'EVALUATED' ? result.factor.evidence : [];
  expect(refs.find((entry) => entry.ref === 'window:gallery')).toStrictEqual({
    ref: 'window:gallery',
    source: 'ESTIMATED',
  });
});

test('a daypart that only ever partly fits the opening hours is material', () => {
  const result = evaluateFeasibility({
    commitments: [],
    items: [
      item({
        duration: at(60),
        id: 'gallery',
        openingHours: knownHours(660, 690),
        startWindow: MORNING,
      }),
    ],
  });

  expect(result.conflicts[0]?.severity).toBe('MATERIAL');
});

test('an unreachable daypart is material, never hard', () => {
  // Arrival is five and a half hours past the last minute the window allows, but
  // a daypart is a preference the traveller can move, so it never reaches HARD.
  const result = evaluateFeasibility({
    commitments: [],
    items: [
      item({ duration: at(60), id: 'park', start: at(900) }),
      item({
        id: 'market',
        inboundTravel: at(90, 'FRESH_PROVIDER'),
        startWindow: MORNING,
      }),
    ],
  });

  expect(result.conflicts[0]?.kind).toBe('ARRIVES_AFTER_FIXED_START');
  expect(result.conflicts[0]?.severity).toBe('MATERIAL');
  expect(result.factor.state === 'EVALUATED' && result.factor.score).toBe(75);
});

test('a reachable but tight daypart is only a soft transition', () => {
  const result = evaluateFeasibility({
    commitments: [],
    items: [
      item({ duration: at(60), id: 'park', start: at(600) }),
      item({ id: 'market', inboundTravel: at(50, 'FRESH_PROVIDER'), startWindow: MORNING }),
    ],
  });

  expect(result.conflicts[0]?.severity).toBe('SOFT');
  expect(result.conflicts[0]?.kind).toBe('TIGHT_TRANSITION');
});

test('a daypart predecessor departs as early as it may', () => {
  // Using the back of the window instead would put arrival long after the fixed
  // start and invent a conflict the traveller could trivially avoid.
  const result = evaluateFeasibility({
    commitments: [],
    items: [
      item({ duration: at(60), id: 'market', startWindow: MORNING }),
      item({
        fixed: true,
        id: 'tour',
        inboundTravel: at(30, 'FRESH_PROVIDER'),
        start: at(300),
      }),
    ],
  });

  expect(result.conflicts).toStrictEqual([]);
});

test('a daypart never counts as fixed, even when the item carries a reservation', () => {
  const result = evaluateFeasibility({
    commitments: [],
    items: [
      item({ duration: at(60), id: 'park', start: at(900) }),
      item({
        duration: at(60),
        fixed: true,
        id: 'market',
        inboundTravel: at(90, 'FRESH_PROVIDER'),
        startWindow: MORNING,
      }),
    ],
  });

  // Would be HARD if the window were treated as an anchored start.
  expect(result.conflicts[0]?.severity).toBe('MATERIAL');
  expect(result.conflicts.some((conflict) => conflict.kind === 'OVERLAPPING_COMMITMENTS')).toBe(
    false,
  );
});

test('dayparts alone prove nothing, so the day stays unknown', () => {
  // Guards the conditional evidence registration: registering a window
  // unconditionally would score these days 100 on no evidence at all.
  const result = evaluateFeasibility({
    commitments: [],
    items: [item({ id: 'a', startWindow: MORNING }), item({ id: 'b', startWindow: EVENING })],
  });

  expect(result.factor).toStrictEqual({ reason: 'MISSING_EVIDENCE', state: 'UNKNOWN' });
});

test('pace measures a pair that a daypart makes comparable', () => {
  const items = [
    item({ duration: at(60), id: 'park', start: at(600) }),
    item({ id: 'market', inboundTravel: at(50, 'FRESH_PROVIDER'), startWindow: MORNING }),
  ];
  const withWindow = evaluatePaceBuffer({ items, segments: [local(30)] });
  const withoutWindow = evaluatePaceBuffer({
    items: [items[0]!, { ...items[1]!, startWindow: null }],
    segments: [local(30)],
  });

  expect(withWindow.smallestBufferMinutes).toBe(10);
  expect(withoutWindow.smallestBufferMinutes).toBe(null);
});
