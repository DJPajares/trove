import { expect, test } from 'vitest';

import {
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
  type PlanScoreRouteLeg,
  type PlanScoreRouteSegment,
  type PlanScoreRouteStop,
} from '../src/services/plan-score-factors.js';
import { buildTripPlanScore } from '../src/services/plan-score.js';
import {
  scoreDay,
  scoreTrip,
  type PlanScoreDayInput,
  type PlanScoreEvidenceSource,
  type PlanScoreFactorResult,
} from '../src/services/plan-score-rules.js';

/**
 * Plan Score calibration scenarios (PRD section 29).
 *
 * Each scenario runs real rubric evidence through the factor evaluators and the
 * scoring contract, so the checks below protect end-to-end behaviour rather than
 * hand-written factor scores. Intent is documented per scenario; the assertions
 * pin both the qualitative ordering the product depends on and the exact frozen
 * numbers, so an accidental recalibration fails loudly.
 */

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

function hours(
  startMinute: number,
  endMinute: number,
  source: PlanScoreEvidenceSource = 'FRESH_PROVIDER',
): PlanScoreOpeningHours {
  return { intervals: [{ endMinute, startMinute }], source, status: 'KNOWN' };
}

const DAYTIME = () => hours(540, 1020);

function segments(...values: Array<number | null>): PlanScoreRouteSegment[] {
  return values.map((value, index) =>
    value === null
      ? { id: `segment-${index}`, scope: 'LOCAL', status: 'UNKNOWN' }
      : {
          duration: at(value, 'FRESH_PROVIDER'),
          id: `segment-${index}`,
          scope: 'LOCAL',
          status: 'KNOWN',
        },
  );
}

/** Four stops on a straight line, so the shortest order is unambiguous. */
const LINE_STOPS = [
  { id: 'base', position: 0 },
  { id: 'a', position: 20 },
  { id: 'b', position: 50 },
  { id: 'c', position: 80 },
];

function lineLegs(): PlanScoreRouteLeg[] {
  return LINE_STOPS.flatMap((from) =>
    LINE_STOPS.filter((to) => to.id !== from.id).map((to) => ({
      duration: at(Math.abs(from.position - to.position), 'FRESH_PROVIDER'),
      fromId: from.id,
      toId: to.id,
    })),
  );
}

function routeStops(order: string[]): PlanScoreRouteStop[] {
  return order.map((id) => ({ fixed: id === 'base', id }));
}

function places(...ratings: number[]): PlanScorePlace[] {
  return ratings.map((rating, index) => ({
    rating: { rating, source: 'FRESH_PROVIDER', status: 'KNOWN' },
    tripPlaceId: `place-${index}`,
  }));
}

type ScenarioInput = {
  items: PlanScoreDayItem[];
  places?: PlanScorePlace[];
  routeOrder?: string[];
  segments: PlanScoreRouteSegment[];
};

function buildDay(dayId: string, scenario: ScenarioInput): PlanScoreDayInput {
  const feasibility = evaluateFeasibility({ commitments: [], items: scenario.items });
  const routeEfficiency = scenario.routeOrder
    ? evaluateRouteEfficiency({ legs: lineLegs(), stops: routeStops(scenario.routeOrder) }).factor
    : ({ reason: 'MISSING_EVIDENCE', state: 'UNKNOWN' } satisfies PlanScoreFactorResult);

  return {
    dayId,
    factors: {
      FEASIBILITY: feasibility.factor,
      PACE_BUFFER: evaluatePaceBuffer({ items: scenario.items, segments: scenario.segments })
        .factor,
      PLACE_QUALITY: evaluatePlaceQuality(scenario.places ?? []),
      ROUTE_EFFICIENCY: routeEfficiency,
      TRAVEL_EFFORT: evaluateTravelEffort(scenario.segments).factor,
    },
  };
}

const RATED_PLACES = places(4.6, 4.2, 4);
const EFFICIENT_ORDER = ['base', 'a', 'b', 'c'];

/** A comfortable sightseeing day: open places, real buffers, compact travel. */
const strongDay: ScenarioInput = {
  items: [
    item({ duration: at(90), id: 'a', openingHours: DAYTIME(), start: at(540) }),
    item({
      duration: at(90),
      id: 'b',
      inboundTravel: at(30, 'FRESH_PROVIDER'),
      openingHours: DAYTIME(),
      start: at(690),
    }),
    item({
      duration: at(90),
      id: 'c',
      inboundTravel: at(30, 'FRESH_PROVIDER'),
      openingHours: DAYTIME(),
      start: at(870),
    }),
  ],
  places: RATED_PLACES,
  routeOrder: EFFICIENT_ORDER,
  segments: segments(20, 30, 30, 20),
};

/** The same places, but travel makes the traveller arrive late for a booked stop. */
const lateForBookingDay: ScenarioInput = {
  items: [
    item({ duration: at(90), id: 'a', openingHours: DAYTIME(), start: at(540) }),
    item({
      duration: at(90),
      fixed: true,
      id: 'b',
      inboundTravel: at(90, 'FRESH_PROVIDER'),
      openingHours: DAYTIME(),
      start: at(660),
    }),
    item({
      duration: at(90),
      id: 'c',
      inboundTravel: at(30, 'FRESH_PROVIDER'),
      openingHours: DAYTIME(),
      start: at(870),
    }),
  ],
  places: RATED_PLACES,
  routeOrder: EFFICIENT_ORDER,
  segments: segments(20, 90, 30, 20),
};

/** The same places, but the last visit is planned after everything closes. */
const closedPlaceDay: ScenarioInput = {
  ...strongDay,
  items: [
    strongDay.items[0]!,
    strongDay.items[1]!,
    item({
      duration: at(90),
      id: 'c',
      inboundTravel: at(30, 'FRESH_PROVIDER'),
      openingHours: DAYTIME(),
      start: at(1080),
    }),
  ],
};

test('scores a comfortable sightseeing day near the top of the range', () => {
  const result = scoreDay(buildDay('strong', strongDay));

  expect(result.score).toBe(95);
  expect(result.completeness).toBe(100);
  expect(result.confidence).toBe(100);
  expect(result.withheldReasons).toStrictEqual([]);
});

test('scores a known timing failure materially worse than the same places planned well', () => {
  const strong = scoreDay(buildDay('strong', strongDay));
  const late = scoreDay(buildDay('late', lateForBookingDay));

  expect(late.score).toBe(58);
  expect((strong.score ?? 0) - (late.score ?? 0) >= 30).toBe(true);
});

test('penalizes a visit planned outside known hours without punishing missing hours', () => {
  const closed = scoreDay(buildDay('closed', closedPlaceDay));
  const unknownHours = scoreDay(
    buildDay('unknown-hours', {
      ...closedPlaceDay,
      items: closedPlaceDay.items.map((entry) => ({
        ...entry,
        openingHours: { status: 'UNKNOWN' },
      })),
    }),
  );
  const staleHours = scoreDay(
    buildDay('stale-hours', {
      ...closedPlaceDay,
      items: closedPlaceDay.items.map((entry) => ({
        ...entry,
        openingHours: hours(540, 1020, 'STALE'),
      })),
    }),
  );

  expect(closed.score).toBe(76);
  expect(unknownHours.score).toBe(95);
  expect(staleHours.score).toBe(closed.score);
  expect(
    (staleHours.confidence ?? 0) < (closed.confidence ?? 0),
    'stale hours must cost confidence, not score',
  ).toBe(true);
});

test('scores an exhausting travel day well below a compact one', () => {
  const heavyTravel = scoreDay(
    buildDay('heavy-travel', {
      ...strongDay,
      items: strongDay.items.map((entry, index) =>
        index === 0 ? entry : { ...entry, inboundTravel: at(120, 'FRESH_PROVIDER') },
      ),
      segments: segments(60, 120, 120, 60),
    }),
  );

  expect(heavyTravel.score).toBe(67);
});

test('scores an overpacked day below the same places with breathing room', () => {
  const overpacked = scoreDay(
    buildDay('overpacked', {
      ...strongDay,
      items: [
        item({ duration: at(240), id: 'a', openingHours: hours(480, 1440), start: at(540) }),
        item({
          duration: at(240),
          id: 'b',
          inboundTravel: at(10, 'FRESH_PROVIDER'),
          openingHours: hours(480, 1440),
          start: at(790),
        }),
        item({
          duration: at(240),
          id: 'c',
          inboundTravel: at(10, 'FRESH_PROVIDER'),
          openingHours: hours(480, 1440),
          start: at(1040),
        }),
      ],
      segments: segments(10, 10, 10, 10),
    }),
  );

  expect(overpacked.score).toBe(79);
});

test('notices backtracking without letting it dominate the day', () => {
  const strong = scoreDay(buildDay('strong', strongDay));
  const backtracking = scoreDay(
    buildDay('backtracking', { ...strongDay, routeOrder: ['base', 'c', 'a', 'b'] }),
  );

  expect(backtracking.score).toBe(86);
  expect((strong.score ?? 0) - (backtracking.score ?? 0) <= 10).toBe(true);
});

test('keeps a small rating advantage from rescuing an unworkable plan', () => {
  const wellRatedButLate = scoreDay(
    buildDay('well-rated', { ...lateForBookingDay, places: places(4.9, 4.8, 4.7) }),
  );
  const workableButPlain = scoreDay(buildDay('plain', { ...strongDay, places: places(3.2, 3.1) }));

  expect((workableButPlain.score ?? 0) > (wellRatedButLate.score ?? 0)).toBe(true);
});

test('reports an incomplete day honestly instead of scoring it harshly', () => {
  const result = scoreDay(
    buildDay('incomplete', {
      items: [
        item({ duration: at(90), id: 'a', start: at(540) }),
        item({
          duration: at(90),
          id: 'b',
          inboundTravel: at(30, 'FRESH_PROVIDER'),
          start: at(690),
        }),
      ],
      segments: segments(20, 30),
    }),
  );

  expect(result.score).toBe(100);
  expect(result.completeness).toBe(83);
  expect(result.factors.PLACE_QUALITY).toStrictEqual({
    reason: 'MISSING_EVIDENCE',
    state: 'UNKNOWN',
  });
  expect(result.withheldReasons).toStrictEqual([]);
});

test('judges a travel-heavy day without sightseeing assumptions', () => {
  const result = scoreDay({
    dayId: 'travel-heavy',
    factors: {
      FEASIBILITY: evaluateFeasibility({
        commitments: [{ endMinute: 660, id: 'flight', source: 'USER_OWNED', startMinute: 540 }],
        items: [],
      }).factor,
      PACE_BUFFER: { state: 'NOT_APPLICABLE' },
      PLACE_QUALITY: { state: 'NOT_APPLICABLE' },
      ROUTE_EFFICIENCY: { state: 'NOT_APPLICABLE' },
      TRAVEL_EFFORT: evaluateTravelEffort(segments(45)).factor,
    },
  });

  expect(result.completeness).toBe(100);
  expect(result.score).toBe(100);
  expect(result.factors.PLACE_QUALITY).toStrictEqual({ state: 'NOT_APPLICABLE' });
});

test('excludes unrated places rather than treating them as poor quality', () => {
  const unrated = evaluatePlaceQuality([
    { rating: { status: 'UNKNOWN' }, tripPlaceId: 'place-0' },
    { rating: { rating: 4.6, source: 'FRESH_PROVIDER', status: 'KNOWN' }, tripPlaceId: 'place-1' },
  ]);

  expect(unrated).toStrictEqual({
    evidence: [{ ref: 'rating:place-1', source: 'FRESH_PROVIDER' }],
    score: 100,
    state: 'EVALUATED',
  });
});

test('withholds travel effort when the day has no usable route evidence', () => {
  const result = scoreDay(
    buildDay('routes-unavailable', { ...strongDay, segments: segments(null, null, null, null) }),
  );

  expect(result.factors.TRAVEL_EFFORT).toStrictEqual({
    reason: 'INSUFFICIENT_EVIDENCE',
    state: 'UNKNOWN',
  });
  expect(result.score).not.toBe(0);
});

test('moves the trip score with Must Go fit under the frozen 90/10 rule', () => {
  const days = [buildDay('strong', strongDay)];
  const dayMean = scoreTrip({ days, mustGoPriorityFit: { state: 'NOT_APPLICABLE' } }).score;
  const allScheduled = scoreTrip({
    days,
    mustGoPriorityFit: evaluateMustGoPriorityFit({
      mustGoTripPlaceIds: ['x', 'y'],
      scheduledTripPlaceIds: ['x', 'y'],
      source: 'USER_OWNED',
    }),
  }).score;
  const oneScheduled = scoreTrip({
    days,
    mustGoPriorityFit: evaluateMustGoPriorityFit({
      mustGoTripPlaceIds: ['x', 'y', 'z', 'w'],
      scheduledTripPlaceIds: ['x'],
      source: 'USER_OWNED',
    }),
  }).score;

  expect(dayMean).toBe(95);
  expect(allScheduled).toBe(96);
  expect(oneScheduled).toBe(88);
});

test('pins the frozen base weights through the influence of a single weak factor', () => {
  const evaluated = (score: number): PlanScoreFactorResult => ({
    evidence: [{ ref: 'evidence', source: 'USER_OWNED' }],
    score,
    state: 'EVALUATED',
  });
  const bothCoreFactors = { FEASIBILITY: evaluated(100), TRAVEL_EFFORT: evaluated(100) };
  const withWeakFactor = (factor: keyof PlanScoreDayInput['factors']) =>
    scoreDay({ dayId: 'weights', factors: { ...bothCoreFactors, [factor]: evaluated(0) } }).score;

  // Each secondary factor is paired with both core factors, because a day scored
  // from secondary factors alone falls under the display gate and is withheld.
  expect(
    scoreDay({
      dayId: 'core-split',
      factors: { FEASIBILITY: evaluated(100), TRAVEL_EFFORT: evaluated(0) },
    }).score,
  ).toBe(58);
  expect(withWeakFactor('PACE_BUFFER')).toBe(80);
  expect(withWeakFactor('ROUTE_EFFICIENCY')).toBe(86);
  expect(withWeakFactor('PLACE_QUALITY')).toBe(92);
});

test('rounds a displayed score half-up from the unrounded calculation', () => {
  const evaluated = (score: number): PlanScoreFactorResult => ({
    evidence: [{ ref: 'evidence', source: 'USER_OWNED' }],
    score,
    state: 'EVALUATED',
  });
  const result = scoreDay({
    dayId: 'rounding',
    factors: { FEASIBILITY: evaluated(100), TRAVEL_EFFORT: evaluated(22) },
  });

  // The unrounded weighted mean is exactly 67.5.
  expect(result.score).toBe(68);
});

test('respects the item time zone when deriving local start times', () => {
  const withZone = (timeZone: string) =>
    buildTripPlanScore({
      days: [
        {
          commitments: [{ endMinute: 300, id: 'transfer', startMinute: 180 }],
          date: '2026-09-01',
          id: 'day-1',
          items: [
            {
              dayPart: null,
              durationMinutes: 60,
              id: 'item-a',
              localStartTime: null,
              reservationCount: 1,
              startInstant: new Date('2026-09-01T16:00:00.000Z'),
              timeSemantics: 'AUTHORITATIVE_INSTANT',
              timeProvenance: null,
              timeZone,
              tripPlaceId: null,
            },
          ],
          timeZone: 'UTC',
        },
      ],
      hours: new Map(),
      mustGoTripPlaceIds: [],
      ratings: new Map(),
      routes: new Map(),
    });

  // 16:00 UTC is 04:00 in Auckland, inside the transfer window, and 16:00 in UTC, outside it.
  expect(
    withZone('Pacific/Auckland').days[0]?.explanations.worthImproving.map(
      (entry) => entry.messageKey,
    ),
  ).toStrictEqual(['feasibility.overlappingCommitments']);
  expect(withZone('UTC').days[0]?.explanations.worthImproving).toStrictEqual([]);
});

test('returns identical results for identical evidence', () => {
  const days = [buildDay('strong', strongDay), buildDay('late', lateForBookingDay)];
  const mustGoPriorityFit = evaluateMustGoPriorityFit({
    mustGoTripPlaceIds: ['x', 'y'],
    scheduledTripPlaceIds: ['x'],
    source: 'USER_OWNED',
  });

  expect(scoreTrip({ days, mustGoPriorityFit })).toStrictEqual(
    scoreTrip({ days, mustGoPriorityFit }),
  );
});
