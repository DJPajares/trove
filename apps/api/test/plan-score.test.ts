import { expect, test } from 'vitest';

import type {
  ItineraryDayRoutes,
  ItineraryRouteSegment,
} from '../src/services/itinerary-routes.js';
import {
  buildPlanScoreFromEvaluations,
  buildTripPlanScore,
  evaluateScoredDay,
  parseStoredPlanScore,
  readPlanScoreInputs,
  type PlanScoreTripRecord,
} from '../src/services/plan-score.js';

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
      localSegmentCount: segments.filter((entry) => entry.scope === 'local').length,
      scheduledPlaceCount: segments.length,
      status: 'complete',
      totalSegmentCount: segments.length,
    },
  };
}

function localTime(value: string) {
  return new Date(`1970-01-01T${value}:00.000Z`);
}

/** Minutes east of UTC for a zone right now, so the same-zone hours guard passes. */
function currentOffsetMinutes(timeZone: string) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(now);
  const field = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour') % 24,
    field('minute'),
    field('second'),
  );

  return Math.round((asUtc - Math.floor(now.getTime() / 1000) * 1000) / 60_000);
}

const plannedTrip: PlanScoreTripRecord = {
  days: [
    {
      commitments: [],
      date: '2026-09-01',
      id: 'day-1',
      items: [
        {
          dayPart: null,
          durationMinutes: 60,
          id: 'item-a',
          localStartTime: localTime('09:00'),
          reservationCount: 0,
          startInstant: null,
          timeSemantics: 'FLOATING_LOCAL',
          timeProvenance: 'USER_OWNED',
          timeZone: null,
          tripPlaceId: 'tp-1',
        },
        {
          dayPart: null,
          durationMinutes: 60,
          id: 'item-b',
          localStartTime: localTime('11:00'),
          reservationCount: 0,
          startInstant: null,
          timeSemantics: 'FLOATING_LOCAL',
          timeProvenance: 'USER_OWNED',
          timeZone: null,
          tripPlaceId: 'tp-2',
        },
      ],
      timeZone: 'Asia/Singapore',
    },
  ],
  hours: new Map(),
  mustGoTripPlaceIds: ['tp-1', 'tp-3'],
  ratings: new Map([['tp-1', 4.7]]),
  routes: new Map([
    [
      'day-1',
      dayRoutes([segment('seg-base-a', 'item-a', 600), segment('seg-a-b', 'item-b', 1800)]),
    ],
  ]),
};

test('stored timing and complete local routes retain partial coverage honestly', () => {
  const result = buildTripPlanScore(plannedTrip),
    day = result.days[0]!;
  expect(day.score).toBe(100);
  expect(day.completeness).toBeLessThan(60);
  expect(day.factors.ROUTE_EFFICIENCY).toMatchObject({
    state: 'EVALUATED',
    score: 100,
    coverage: 60,
    confidence: 60,
  });
  expect(day.date).toBe('2026-09-01');
  // Half the Must Go places are scheduled, and that is the whole of Destination use.
  expect(result.score).toBe(86);
});
test('burden is known while unevidenced alternative orders reduce route coverage', () => {
  const day = buildTripPlanScore(plannedTrip).days[0]!;
  expect(day.factors.ROUTE_EFFICIENCY).toMatchObject({ state: 'EVALUATED', coverage: 60 });
  expect(day.explanations.uncertainty).toEqual([]);
});

test('a place shut on the day of the visit is a hard feasibility conflict', () => {
  // 2026-09-01 is a Tuesday; the place only opens on Monday, so no placement works.
  const shut = buildTripPlanScore({
    ...plannedTrip,
    hours: new Map([
      [
        'tp-1',
        {
          periods: [
            { close: { day: 1, hour: 17, minute: 0 }, open: { day: 1, hour: 9, minute: 0 } },
          ],
          utcOffsetMinutes: currentOffsetMinutes('Asia/Singapore'),
        },
      ],
    ]),
  }).days[0];
  const conflicts = shut?.explanations.worthImproving ?? [];

  expect(conflicts.map((entry) => entry.messageKey)).toStrictEqual([
    'feasibility.outsideOpeningHours',
  ]);
  expect(conflicts[0]?.references).toStrictEqual(['item-a']);
});

test('known opening hours change the fingerprint', () => {
  const withoutHours = buildTripPlanScore(plannedTrip).fingerprint;
  const withHours = buildTripPlanScore({
    ...plannedTrip,
    hours: new Map([
      [
        'tp-1',
        {
          periods: [
            { close: { day: 2, hour: 17, minute: 0 }, open: { day: 2, hour: 9, minute: 0 } },
          ],
          utcOffsetMinutes: currentOffsetMinutes('Asia/Singapore'),
        },
      ],
    ]),
  }).fingerprint;

  expect(withoutHours).not.toBe(withHours);
});

test('explains a planned day and its unscheduled Must Go places', () => {
  const result = buildTripPlanScore(plannedTrip);

  expect(result.days[0]?.explanations.whatWorks.map((entry) => entry.messageKey)).toEqual(
    expect.arrayContaining(['routeEfficiency.light', 'pace.comfortable']),
  );
  expect(result.explanations.worthImproving).toContainEqual(
    expect.objectContaining({ code: 'UNSCHEDULED_MUST_GO', references: ['tp-3'] }),
  );
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
            dayPart: null,
            durationMinutes: null,
            id: 'item-c',
            localStartTime: null,
            reservationCount: 0,
            startInstant: null,
            timeSemantics: null,
            timeProvenance: null,
            timeZone: null,
            tripPlaceId: null,
          },
        ],
        timeZone: 'Asia/Singapore',
      },
    ],
    hours: new Map(),
    mustGoTripPlaceIds: [],
    ratings: new Map(),
    routes: new Map(),
  });

  expect(result.days[0]?.score).toBe(null);
  expect(result.days[0]?.completeness).toBe(0);
  expect(result.days[0]?.withheldReasons).toStrictEqual(['NO_MEANINGFUL_EVIDENCE']);
  expect(result.score).toBe(null);
  expect(result.withheldReasons).toStrictEqual(['NO_SCORABLE_DAY']);
});

test('a timed item without duration leaves whole-day feasibility unknown', () => {
  // This is the ordinary case: a traveller drags a place into a day and picks
  // a start time. No reservation, no explicit visit length — exactly what
  // real itineraries look like, and previously left Feasibility permanently
  // unevaluable because only reservation-linked items counted as "fixed".
  const day = buildTripPlanScore({
    days: [
      {
        commitments: [],
        date: '2026-09-06',
        id: 'day-2',
        items: [
          {
            dayPart: null,
            durationMinutes: null,
            id: 'item-x',
            localStartTime: localTime('09:00'),
            reservationCount: 0,
            startInstant: null,
            timeSemantics: 'FLOATING_LOCAL',
            timeProvenance: 'USER_OWNED',
            timeZone: null,
            tripPlaceId: 'tp-x',
          },
          {
            dayPart: null,
            durationMinutes: null,
            id: 'item-y',
            localStartTime: localTime('12:00'),
            reservationCount: 0,
            startInstant: null,
            timeSemantics: 'FLOATING_LOCAL',
            timeProvenance: 'USER_OWNED',
            timeZone: null,
            tripPlaceId: 'tp-y',
          },
        ],
        timeZone: 'Pacific/Auckland',
      },
    ],
    hours: new Map(),
    mustGoTripPlaceIds: [],
    ratings: new Map(),
    routes: new Map([['day-2', dayRoutes([segment('seg-x-y', 'item-y', 600)])]]),
  }).days[0];

  expect(day?.factors.FEASIBILITY.state).toBe('UNKNOWN');
  expect(day?.score).toBeNull();
});

test("an item with no visit duration is still caught when it lands inside another item's known interval", () => {
  const day = buildTripPlanScore({
    days: [
      {
        commitments: [],
        date: '2026-09-06',
        id: 'day-2',
        items: [
          {
            dayPart: null,
            durationMinutes: 60,
            id: 'item-long',
            localStartTime: localTime('09:00'),
            reservationCount: 0,
            startInstant: null,
            timeSemantics: 'FLOATING_LOCAL',
            timeProvenance: 'USER_OWNED',
            timeZone: null,
            tripPlaceId: 'tp-long',
          },
          {
            dayPart: null,
            durationMinutes: null,
            id: 'item-instant',
            localStartTime: localTime('09:30'),
            reservationCount: 0,
            startInstant: null,
            timeSemantics: 'FLOATING_LOCAL',
            timeProvenance: 'USER_OWNED',
            timeZone: null,
            tripPlaceId: 'tp-instant',
          },
        ],
        timeZone: 'Pacific/Auckland',
      },
    ],
    hours: new Map(),
    mustGoTripPlaceIds: [],
    ratings: new Map(),
    routes: new Map(),
  }).days[0];
  const conflicts = day?.explanations.worthImproving ?? [];

  expect(conflicts.map((entry) => entry.messageKey)).toStrictEqual([
    'feasibility.overlappingCommitments',
  ]);
  expect(conflicts[0]?.references).toStrictEqual(['item-instant', 'item-long']);
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

  expect(conflicts.map((entry) => entry.messageKey)).toStrictEqual([
    'feasibility.overlappingCommitments',
  ]);
  expect(conflicts[0]?.references).toStrictEqual(['flight-1', 'item-a']);
});

test('produces a stable fingerprint for unchanged evidence', () => {
  const first = buildTripPlanScore(plannedTrip);
  const second = buildTripPlanScore(plannedTrip);

  expect(first.fingerprint).toBe(second.fingerprint);
  expect(first.fingerprint).not.toBe(
    buildTripPlanScore({ ...plannedTrip, ratings: new Map([['tp-1', 3.2]]) }).fingerprint,
  );
});

test('keeps the internal weighting out of the payload', () => {
  const day = buildTripPlanScore(plannedTrip).days[0];

  expect(Object.keys(day ?? {}).toSorted()).toStrictEqual([
    'assessmentBasis',
    'assessmentStatus',
    'caps',
    'completeness',
    'confidence',
    'date',
    'dayId',
    'explanations',
    'factors',
    'limitations',
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
  expect(failedRoute?.factors.ROUTE_EFFICIENCY).toStrictEqual({
    reason: 'MISSING_EVIDENCE',
    state: 'UNKNOWN',
  });
  expect(flight?.factors.ROUTE_EFFICIENCY).toStrictEqual({
    confidence: 60,
    coverage: 60,
    score: 100,
    state: 'EVALUATED',
  });
  expect((flight?.completeness ?? 0) > (failedRoute?.completeness ?? 0)).toBeTruthy();
});

test('a flight leg contributes no travel minutes alongside local legs', () => {
  const mixed = dayWithSecondLeg(flightSegment('seg-a-b', 'item-b'));
  const localOnly = buildTripPlanScore({
    ...plannedTrip,
    routes: new Map([['day-1', dayRoutes([segment('seg-base-a', 'item-a', 600)])]]),
  }).days[0];

  expect(mixed?.factors.ROUTE_EFFICIENCY).toStrictEqual(localOnly?.factors.ROUTE_EFFICIENCY);
});

test('a day whose only movement is a flight drops travel effort from the weight base', () => {
  const flightOnly = buildTripPlanScore({
    ...plannedTrip,
    routes: new Map([['day-1', dayRoutes([flightSegment('seg-a-b', 'item-b')])]]),
  }).days[0];

  // Not applicable rather than unknown, so the factor is renormalized away instead
  // of costing completeness. The day is still withheld here, but on the honest
  // grounds that nothing else about it is known -- not because of the flight.
  expect(flightOnly?.factors.ROUTE_EFFICIENCY).toStrictEqual({ state: 'NOT_APPLICABLE' });
});

test('a coarse daypart is scored rather than ignored', () => {
  // Both items keep their durations and routes but trade exact times for
  // dayparts, so the day still has enough to say something about.
  const vague = buildTripPlanScore({
    ...plannedTrip,
    days: [
      {
        ...plannedTrip.days[0]!,
        items: plannedTrip.days[0]!.items.map((item, index) => ({
          ...item,
          dayPart: index === 0 ? 'MORNING' : 'AFTERNOON',
          localStartTime: null,
          timeSemantics: null,
        })),
      },
    ],
  }).days[0];

  expect(vague?.factors.PACE_COMFORT.state).toBe('EVALUATED');
  expect(vague?.score).toBe(100);
  expect(vague?.completeness).toBeLessThan(60);
});

test('a daypart lowers confidence below what an exact time earns', () => {
  const vague = buildTripPlanScore({
    ...plannedTrip,
    days: [
      {
        ...plannedTrip.days[0]!,
        items: plannedTrip.days[0]!.items.map((item, index) => ({
          ...item,
          dayPart: index === 0 ? 'MORNING' : 'AFTERNOON',
          localStartTime: null,
          timeSemantics: null,
        })),
      },
    ],
  }).days[0];
  const exact = buildTripPlanScore(plannedTrip).days[0];

  // Reliability 50 for coarse daypart evidence, per PRD section 29.2.
  expect((vague?.confidence ?? 0) < (exact?.confidence ?? 0)).toBeTruthy();
});

test('anytime is treated as no timing at all', () => {
  const withAnytime = (dayPart: string | null) =>
    buildTripPlanScore({
      ...plannedTrip,
      days: [
        {
          ...plannedTrip.days[0]!,
          items: plannedTrip.days[0]!.items.map((item) => ({
            ...item,
            dayPart,
            localStartTime: null,
            timeSemantics: null,
          })),
        },
      ],
    }).days[0];

  expect(withAnytime('ANYTIME')?.factors).toStrictEqual(withAnytime(null)?.factors);
});

test('an exact time wins over a daypart left on the same item', () => {
  const both = buildTripPlanScore({
    ...plannedTrip,
    days: [
      {
        ...plannedTrip.days[0]!,
        items: plannedTrip.days[0]!.items.map((item) => ({ ...item, dayPart: 'EVENING' })),
      },
    ],
  }).days[0];
  const exactOnly = buildTripPlanScore(plannedTrip).days[0];

  expect(both?.factors).toStrictEqual(exactOnly?.factors);
});

/**
 * The stored score is read back through a schema written by hand, so drift
 * between it and the payload the scorer emits would not throw — every stored
 * score would quietly parse to null and no panel would ever render one. Round
 * a real score through JSON to keep the two honest.
 */
test('a real score survives being stored and read back', () => {
  const score = buildPlanScoreFromEvaluations({
    days: [
      {
        date: '2026-10-02',
        evaluation: evaluateScoredDay({
          commitments: [],
          dayId: '2026-10-02',
          items: [
            {
              duration: { minutes: 60, source: 'ESTIMATED' },
              fixed: false,
              id: 'item:a',
              inboundTravel: { minutes: 10, source: 'FRESH_PROVIDER' },
              openingHours: {
                intervals: [{ endMinute: 1_080, startMinute: 540 }],
                source: 'FRESH_PROVIDER',
                status: 'KNOWN',
              },
              start: null,
              startWindow: { earliestMinute: 0, latestMinute: 720, source: 'ESTIMATED' },
            },
          ],
          places: [
            {
              rating: { rating: 4.6, source: 'FRESH_PROVIDER', status: 'KNOWN' },
              tripPlaceId: 'place:a',
            },
          ],
          segments: [
            {
              duration: { minutes: 10, source: 'FRESH_PROVIDER' },
              id: 'segment:a',
              scope: 'LOCAL',
              status: 'KNOWN',
            },
          ],
        }),
      },
    ],
    mustGoIds: ['place:a'],
    scheduledIds: ['place:a'],
  });

  const stored = JSON.parse(JSON.stringify(score)) as unknown;
  expect(parseStoredPlanScore(stored)).toStrictEqual(stored);
  expect(parseStoredPlanScore(null)).toBeNull();
  expect(parseStoredPlanScore({ score: 80 })).toBeNull();
});

test('presentation metadata is additive and validates without changing the version-5 measurement', () => {
  const score = buildTripPlanScore(plannedTrip);
  expect(score.schemaVersion).toBe(7);
  expect(score.rubricVersion).toBe(9);
  expect(score.presentation?.adjustments).toEqual({ fatigue: 0, weakDays: 0 });
  expect(parseStoredPlanScore(score)).toEqual(score);
  const { presentation: _presentation, ...legacyCompatible } = score;
  expect(parseStoredPlanScore(legacyCompatible)).toEqual(legacyCompatible);
  expect(
    parseStoredPlanScore({
      ...score,
      presentation: { ...score.presentation, adjustments: { fatigue: -1, weakDays: 0 } },
    }),
  ).toBeNull();
  expect(parseStoredPlanScore({ ...score, rubricVersion: 4 })).toBeNull();
});

test('planning revisions distinguish owned edits from provider cache updates', () => {
  const now = new Date('2026-09-29T00:00:00Z');
  const rows = {
    startDate: new Date('2026-10-01'),
    endDate: new Date('2026-10-02'),
    itineraryDays: [],
    reservations: [],
    tripPlaces: [],
    destinations: [
      {
        id: 'destination',
        placeId: 'place',
        position: 0,
        timeZone: 'Asia/Singapore',
        place: {
          customName: 'Singapore',
          customLatitude: 1.35,
          customLongitude: 103.82,
          providerRefs: [
            {
              cachedAt: now,
              cachedName: 'Singapore',
              cachedLatitude: 1.35,
              cachedLongitude: 103.82,
            },
          ],
        },
      },
    ],
  };
  const first = readPlanScoreInputs(rows, now);
  rows.destinations[0]!.place.providerRefs[0]!.cachedName = 'New cached name';
  expect(readPlanScoreInputs(rows, now).planningRevision).toBe(first.planningRevision);
  rows.destinations[0]!.place.customLatitude = 1.36;
  expect(readPlanScoreInputs(rows, now).planningRevision).not.toBe(first.planningRevision);
});

test('reference targets include only known owned rows already named in explanations', async () => {
  const { planScoreReferenceTargets } =
    await import('../src/services/plan-score-reference-targets.js');
  const score = buildTripPlanScore(plannedTrip);
  score.explanations.worthImproving = [
    {
      action: 'ADJUST_TIME',
      factor: 'FEASIBILITY',
      code: 'conflict',
      severity: 'HARD',
      messageKey: 'unused',
      values: {},
      references: ['item', 'reservation', 'unknown'],
    },
  ];
  expect(
    planScoreReferenceTargets(score, {
      items: [
        { id: 'item', dayId: 'day' },
        { id: 'unreferenced', dayId: 'day' },
      ],
      reservationIds: ['reservation'],
      tripPlaceIds: [],
    }),
  ).toEqual({ item: { kind: 'item', dayId: 'day' }, reservation: { kind: 'reservation' } });
});
