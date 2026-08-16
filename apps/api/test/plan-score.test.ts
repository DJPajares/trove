import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  ItineraryDayRoutes,
  ItineraryRouteSegment,
} from '../src/services/itinerary-routes.js';
import { buildTripPlanScore, type PlanScoreTripRecord } from '../src/services/plan-score.js';

function segment(id: string, destinationId: string, durationSeconds: number | null) {
  return {
    destination: { id: destinationId, kind: 'itinerary_item', label: null },
    distanceMeters: durationSeconds === null ? null : 1000,
    durationSeconds,
    encodedPolyline: null,
    id,
    mode: 'drive',
    modeOwner: { id: 'day-1', kind: 'day_start' },
    origin: { id: 'base', kind: 'daily_base', label: null },
    provider: 'google',
    reason: null,
    scope: 'local',
    status: durationSeconds === null ? 'unavailable' : 'ok',
  } satisfies ItineraryRouteSegment;
}

function flightSegment(id: string, destinationId: string) {
  return {
    destination: { id: destinationId, kind: 'itinerary_item', label: null },
    distanceMeters: null,
    durationSeconds: null,
    encodedPolyline: null,
    id,
    mode: 'flight',
    modeOwner: { id: 'day-1', kind: 'day_start' },
    origin: { id: 'base', kind: 'daily_base', label: null },
    provider: null,
    reason: null,
    scope: 'long_distance',
    status: 'not_estimated',
  } satisfies ItineraryRouteSegment;
}

function dayRoutes(segments: ItineraryRouteSegment[]): ItineraryDayRoutes {
  return {
    generatedAt: '2026-09-01T00:00:00.000Z',
    segments,
    summary: {
      distanceMeters: null,
      durationSeconds: null,
      knownSegmentCount: segments.length,
      scheduledPlaceCount: segments.length,
      status: 'complete',
      totalSegmentCount: segments.length,
    },
  };
}

function localTime(value: string) {
  return new Date(`1970-01-01T${value}:00.000Z`);
}

const plannedTrip: PlanScoreTripRecord = {
  days: [
    {
      commitments: [],
      date: '2026-09-01',
      id: 'day-1',
      items: [
        {
          durationMinutes: 60,
          id: 'item-a',
          localStartTime: localTime('09:00'),
          reservationCount: 0,
          startInstant: null,
          timeSemantics: 'FLOATING_LOCAL',
          timeZone: null,
          tripPlaceId: 'tp-1',
        },
        {
          durationMinutes: 60,
          id: 'item-b',
          localStartTime: localTime('11:00'),
          reservationCount: 0,
          startInstant: null,
          timeSemantics: 'FLOATING_LOCAL',
          timeZone: null,
          tripPlaceId: 'tp-2',
        },
      ],
      timeZone: 'Asia/Singapore',
    },
  ],
  mustGoTripPlaceIds: ['tp-1', 'tp-3'],
  ratings: new Map([['tp-1', 4.7]]),
  routes: new Map([
    [
      'day-1',
      dayRoutes([segment('seg-base-a', 'item-a', 600), segment('seg-a-b', 'item-b', 1800)]),
    ],
  ]),
};

test('scores a planned day from stored timing and live route evidence', () => {
  const result = buildTripPlanScore(plannedTrip);
  const day = result.days[0];

  assert.equal(day?.score, 100);
  assert.equal(day?.completeness, 89);
  assert.equal(day?.confidence, 100);
  assert.equal(day?.date, '2026-09-01');
  assert.deepEqual(day?.factors.TRAVEL_EFFORT, { confidence: 100, score: 100, state: 'EVALUATED' });
  assert.equal(result.score, 95);
});

test('leaves route efficiency and opening hours unknown instead of guessing them', () => {
  const day = buildTripPlanScore(plannedTrip).days[0];

  assert.deepEqual(day?.factors.ROUTE_EFFICIENCY, {
    reason: 'MISSING_EVIDENCE',
    state: 'UNKNOWN',
  });
  assert.deepEqual(
    day?.explanations.uncertainty.map((entry) => entry.messageKey),
    ['routeEfficiency.unknown'],
  );
});

test('explains a planned day and its unscheduled Must Go places', () => {
  const result = buildTripPlanScore(plannedTrip);

  assert.deepEqual(
    result.days[0]?.explanations.whatWorks.map((entry) => entry.messageKey),
    ['feasibility.noConflicts', 'travelEffort.light', 'pace.comfortable', 'placeQuality.strong'],
  );
  assert.deepEqual(result.explanations.worthImproving, [
    {
      action: 'SCHEDULE_MUST_GO',
      factor: 'MUST_GO_PRIORITY_FIT',
      messageKey: 'mustGo.unscheduled',
      references: ['tp-3'],
      values: { count: 1 },
    },
  ]);
});

test('withholds a day score when the day has no usable evidence', () => {
  const result = buildTripPlanScore({
    days: [
      {
        commitments: [],
        date: '2026-09-02',
        id: 'day-2',
        items: [
          {
            durationMinutes: null,
            id: 'item-c',
            localStartTime: null,
            reservationCount: 0,
            startInstant: null,
            timeSemantics: null,
            timeZone: null,
            tripPlaceId: null,
          },
        ],
        timeZone: 'Asia/Singapore',
      },
    ],
    mustGoTripPlaceIds: [],
    ratings: new Map(),
    routes: new Map(),
  });

  assert.equal(result.days[0]?.score, null);
  assert.equal(result.days[0]?.completeness, 0);
  assert.deepEqual(result.days[0]?.withheldReasons, [
    'INSUFFICIENT_COMPLETENESS',
    'NO_EVALUABLE_CORE_FACTOR',
  ]);
  assert.equal(result.score, null);
  assert.deepEqual(result.withheldReasons, ['NO_SCORABLE_DAY']);
});

test('detects a timing conflict against a structured journey commitment', () => {
  const result = buildTripPlanScore({
    ...plannedTrip,
    days: [
      {
        ...plannedTrip.days[0]!,
        commitments: [{ endMinute: 660, id: 'flight-1', startMinute: 570 }],
        items: [
          {
            ...plannedTrip.days[0]!.items[0]!,
            reservationCount: 1,
          },
          plannedTrip.days[0]!.items[1]!,
        ],
      },
    ],
  });
  const conflicts = result.days[0]?.explanations.worthImproving ?? [];

  assert.deepEqual(
    conflicts.map((entry) => entry.messageKey),
    ['feasibility.overlappingCommitments'],
  );
  assert.deepEqual(conflicts[0]?.references, ['flight-1', 'item-a']);
});

test('produces a stable fingerprint for unchanged evidence', () => {
  const first = buildTripPlanScore(plannedTrip);
  const second = buildTripPlanScore(plannedTrip);

  assert.equal(first.fingerprint, second.fingerprint);
  assert.notEqual(
    first.fingerprint,
    buildTripPlanScore({ ...plannedTrip, ratings: new Map([['tp-1', 3.2]]) }).fingerprint,
  );
});

test('keeps the internal weighting out of the payload', () => {
  const day = buildTripPlanScore(plannedTrip).days[0];

  assert.deepEqual(Object.keys(day ?? {}).toSorted(), [
    'completeness',
    'confidence',
    'date',
    'dayId',
    'explanations',
    'factors',
    'score',
    'withheldReasons',
  ]);
});

function dayWithSecondLeg(second: ItineraryRouteSegment) {
  return buildTripPlanScore({
    ...plannedTrip,
    routes: new Map([['day-1', dayRoutes([segment('seg-base-a', 'item-a', 600), second])]]),
  }).days[0];
}

test('a flight leg leaves travel effort evaluable where a failed route does not', () => {
  const flight = dayWithSecondLeg(flightSegment('seg-a-b', 'item-b'));
  const failedRoute = dayWithSecondLeg(segment('seg-a-b', 'item-b', null));

  // The defect this fixes: routing a long-distance hop as a drive returns nothing,
  // which dragged the whole day's travel effort into unknown and cost completeness.
  assert.deepEqual(failedRoute?.factors.TRAVEL_EFFORT, {
    reason: 'INSUFFICIENT_EVIDENCE',
    state: 'UNKNOWN',
  });
  assert.deepEqual(flight?.factors.TRAVEL_EFFORT, {
    confidence: 100,
    score: 100,
    state: 'EVALUATED',
  });
  assert.ok((flight?.completeness ?? 0) > (failedRoute?.completeness ?? 0));
});

test('a flight leg contributes no travel minutes alongside local legs', () => {
  const mixed = dayWithSecondLeg(flightSegment('seg-a-b', 'item-b'));
  const localOnly = buildTripPlanScore({
    ...plannedTrip,
    routes: new Map([['day-1', dayRoutes([segment('seg-base-a', 'item-a', 600)])]]),
  }).days[0];

  assert.deepEqual(mixed?.factors.TRAVEL_EFFORT, localOnly?.factors.TRAVEL_EFFORT);
});

test('a day whose only movement is a flight drops travel effort from the weight base', () => {
  const flightOnly = buildTripPlanScore({
    ...plannedTrip,
    routes: new Map([['day-1', dayRoutes([flightSegment('seg-a-b', 'item-b')])]]),
  }).days[0];

  // Not applicable rather than unknown, so the factor is renormalized away instead
  // of costing completeness. The day is still withheld here, but on the honest
  // grounds that nothing else about it is known -- not because of the flight.
  assert.deepEqual(flightOnly?.factors.TRAVEL_EFFORT, { state: 'NOT_APPLICABLE' });
});
