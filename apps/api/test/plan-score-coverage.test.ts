import { expect, test } from 'vitest';

import type {
  ItineraryDayRoutes,
  ItineraryRouteSegment,
} from '../src/services/itinerary-routes.js';
import type { ScoringPlace } from '../src/services/plan-score-evaluation.js';
import { buildTripPlanScore, type PlanScoreTripRecord } from '../src/services/plan-score.js';

/**
 * Rubric 10 regression scenarios (PRD 29.1-29.2): ordinary days publish every
 * applicable category from the best available evidence, missing provider data
 * lowers reliability rather than hiding a category, and estimates never verify
 * a conflict or a cap.
 */

const DAY = '2026-10-07';
const ZONE = 'Asia/Singapore';
const place = (
  tripPlaceId: string,
  types: string[],
  coordinates: ScoringPlace['coordinates'],
): ScoringPlace => ({
  tripPlaceId,
  types,
  coordinates,
  source: 'CACHED_PROVIDER',
  rating: { status: 'UNKNOWN' },
});
const places = new Map<string, ScoringPlace>([
  ['stay', place('stay', ['lodging', 'hotel'], { latitude: 1.29, longitude: 103.85 })],
  [
    'museum',
    place('museum', ['museum', 'tourist_attraction'], { latitude: 1.2966, longitude: 103.8485 }),
  ],
  ['lunch', place('lunch', ['restaurant', 'food'], { latitude: 1.299, longitude: 103.855 })],
  ['park', place('park', ['park'], { latitude: 1.2816, longitude: 103.8636 })],
  ['beach', place('beach', ['beach'], { latitude: 1.25, longitude: 103.82 })],
  // A custom place saved with a name only: no kind, no location.
  ['custom', { tripPlaceId: 'custom', linked: false, rating: { status: 'UNKNOWN' } }],
]);

type Stop = {
  place: string;
  time?: string;
  dayPart?: string;
  minutes?: number;
  planner?: 'AI' | 'USER';
};
const localTime = (value: string) => new Date(`1970-01-01T${value}:00.000Z`);

/** A day starting and ending at the stay, with every leg unrouted: nobody opened the map. */
function day(id: string, stops: Stop[]): PlanScoreTripRecord['days'][number] {
  return {
    id,
    date: DAY,
    timeZone: ZONE,
    commitments: [],
    items: stops.map((stop, index) => ({
      id: `${id}:${index}`,
      tripPlaceId: stop.place,
      dayPart: stop.dayPart ?? null,
      durationMinutes: stop.minutes ?? null,
      durationProvenance: stop.planner === 'USER' ? 'USER_OWNED' : 'AI_ESTIMATED',
      localStartTime: stop.time ? localTime(stop.time) : null,
      startInstant: null,
      timeSemantics: stop.time ? 'FLOATING_LOCAL' : null,
      timeProvenance: stop.time ? (stop.planner === 'USER' ? 'USER_OWNED' : 'AI_ESTIMATED') : null,
      timeZone: null,
      reservationCount: 0,
    })),
  };
}
function unrouted(record: PlanScoreTripRecord['days'][number]): ItineraryDayRoutes {
  const points = [
    { id: 'stay', kind: 'daily_base' as const },
    ...record.items.map((item) => ({ id: item.id, kind: 'itinerary_item' as const })),
    { id: 'stay', kind: 'daily_base' as const },
  ];
  const segments = points.slice(1).map((destination, index): ItineraryRouteSegment => ({
    destination: { ...destination, label: null },
    distanceMeters: null,
    durationSeconds: null,
    encodedPolyline: null,
    id: `leg-${index}`,
    mode: 'drive',
    modeOwner: { id: record.id, kind: 'day_start' },
    origin: { ...points[index]!, label: null },
    provider: 'google',
    reason: 'route_not_found',
    scope: 'local',
    status: 'unavailable',
  }));
  return {
    generatedAt: `${DAY}T00:00:00.000Z`,
    segments,
    summary: {
      distanceMeters: null,
      durationSeconds: null,
      knownSegmentCount: 0,
      localSegmentCount: segments.length,
      scheduledPlaceCount: record.items.length,
      status: 'unavailable',
      totalSegmentCount: segments.length,
    },
  };
}
function score(days: PlanScoreTripRecord['days'], extra: Partial<PlanScoreTripRecord> = {}) {
  return buildTripPlanScore(
    {
      days,
      hours: new Map(),
      mustGoTripPlaceIds: [],
      ratings: new Map(),
      places,
      routes: new Map(days.map((entry) => [entry.id, unrouted(entry)])),
      ...extra,
    },
    { evaluatedAt: new Date(`${DAY}T00:00:00.000Z`) },
  );
}
const published = (factors: Record<string, { state: string }>) =>
  Object.entries(factors)
    .filter(([, outcome]) => outcome.state === 'EVALUATED')
    .map(([id]) => id)
    .toSorted();
const ALL = [
  'EXPERIENCE_QUALITY',
  'FEASIBILITY',
  'PACE_COMFORT',
  'PLAN_COMPOSITION',
  'ROUTE_EFFICIENCY',
].toSorted();

test('an AI-planned day with no routed legs or rich evidence publishes every category', () => {
  const [result] = score([
    day('ai', [
      { place: 'museum', time: '10:00', minutes: 120 },
      { place: 'lunch', time: '12:30', minutes: 60 },
      { place: 'park', time: '15:00', minutes: 60 },
    ]),
  ]).days;
  expect(published(result!.factors)).toEqual(ALL);
  expect(result!.score).not.toBeNull();
  expect(result!.limitations).toContain('TRAVEL_TIME_ESTIMATED');
  expect(result!.caps).toEqual([]);
});

test('a manual day with times but no durations publishes every category, as an estimate', () => {
  const [result] = score([
    day('manual', [
      { place: 'museum', time: '10:00', planner: 'USER' },
      { place: 'lunch', time: '13:00', planner: 'USER' },
      { place: 'park', time: '16:00', planner: 'USER' },
    ]),
  ]).days;
  expect(published(result!.factors)).toEqual(ALL);
  expect(result!.assessmentStatus).toBe('provisional');
  expect(result!.limitations).toEqual(
    expect.arrayContaining(['TRAVEL_TIME_ESTIMATED', 'DURATION_ESTIMATED']),
  );
});

test('a day with dayparts only is assessed from typical visit lengths, to the depth it supports', () => {
  const plan = day('dayparts', [
    { place: 'museum', dayPart: 'MORNING' },
    { place: 'lunch', dayPart: 'AFTERNOON' },
    { place: 'park', dayPart: 'AFTERNOON' },
  ]);
  const [result] = score([plan]).days;
  expect(result!.limitations).toContain('DURATION_ESTIMATED');
  // Without stated lengths nothing shows whether a visit is rushed, so experience
  // rests on time of day alone: every category still shows, experience filled low
  // and named as the row that needs detail...
  expect(published(result!.factors)).toEqual(ALL);
  expect(result!.explanations.uncertainty).toContainEqual(
    expect.objectContaining({ code: 'ROW_NEEDS_DETAIL', factor: 'EXPERIENCE_QUALITY' }),
  );
  // ...until the traveller's declared interests add depth of their own.
  const [withInterests] = score([plan], {
    preferences: { pace: null, interests: ['art_museums', 'food_drink'], unmatchedInterests: [] },
  }).days;
  expect(published(withInterests!.factors)).toEqual(ALL);
  expect(
    withInterests!.explanations.uncertainty.filter((reason) => reason.code === 'ROW_NEEDS_DETAIL'),
  ).toEqual([]);
});

test('an unlocated custom stop counts low on its own route; the rest of the day is still assessed', () => {
  const [result] = score([
    day('custom', [
      { place: 'museum', time: '10:00', minutes: 120 },
      { place: 'custom', time: '12:30', minutes: 60 },
      { place: 'park', time: '15:00', minutes: 60 },
    ]),
  ]).days;
  // Trove never bypasses a stop it cannot place: its legs stay unknown and
  // count low until the traveller locates it...
  expect(result!.factors.ROUTE_EFFICIENCY).toMatchObject({ state: 'EVALUATED' });
  const route = result!.factors.ROUTE_EFFICIENCY;
  expect(route.state === 'EVALUATED' && route.score).toBeLessThan(100);
  expect(result!.limitations).toEqual(
    expect.arrayContaining(['TRAVEL_TIME_UNKNOWN', 'DETAIL_MISSING']),
  );
  expect(result!.explanations.worthImproving).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: 'STOPS_NOT_LOCATED', references: ['custom:1'] }),
    ]),
  );
  // ...while the rest of the day is still assessed.
  for (const id of ['FEASIBILITY', 'PACE_COMFORT', 'PLAN_COMPOSITION'] as const)
    expect(result!.factors[id].state, id).toBe('EVALUATED');
});

test('estimated travel can raise a risk but never verify a conflict or cap the day', () => {
  const [result] = score([
    day('tight', [
      // The traveller fixed both times; the estimated leg between them makes the second late.
      { place: 'museum', time: '10:00', minutes: 60, planner: 'USER' },
      { place: 'beach', time: '11:00', minutes: 60, planner: 'USER' },
    ]),
  ]).days;
  expect(result!.caps).toEqual([]);
  expect(
    result!.explanations.worthImproving.find(
      (reason) => reason.code === 'ARRIVES_AFTER_FIXED_START',
    ),
  ).toMatchObject({ values: { severity: 'ESTIMATED' } });
});

test('experience flags a stop out of its hours and a rushed visit from stated times', () => {
  const [result] = score([
    day('experience', [
      { place: 'lunch', time: '09:00', minutes: 45, planner: 'USER' },
      { place: 'museum', time: '10:00', minutes: 20, planner: 'USER' },
    ]),
  ]).days;
  const codes = result!.explanations.worthImproving.map((reason) => reason.code);
  expect(codes).toContain('TIME_OF_DAY_MISMATCH');
  expect(codes).toContain('RUSHED_VISIT');
  expect(result!.factors.EXPERIENCE_QUALITY).toMatchObject({ state: 'EVALUATED' });
});

test('on a public holiday, weekly hours are only an estimate for holiday-sensitive stops', () => {
  const weekly = Array.from({ length: 7 }, (_, weekday) => ({
    open: { day: weekday, hour: 9, minute: 0 },
    close: { day: weekday, hour: 18, minute: 0 },
  }));
  const hours = new Map([
    [
      'museum',
      {
        periods: weekly,
        utcOffsetMinutes: 480,
        source: 'CACHED_PROVIDER' as const,
        timeZone: ZONE,
      },
    ],
  ]);
  const plan = day('holiday', [
    { place: 'museum', time: '10:00', minutes: 120 },
    { place: 'lunch', time: '12:30', minutes: 60 },
  ]);
  const holiday = score([plan], {
    hours,
    holidays: new Map([['holiday', { certainty: 'official' }]]),
  });
  const reason = holiday.days[0]!.explanations.worthImproving.find(
    (entry) => entry.code === 'HOLIDAY_HOURS_RISK',
  );
  expect(reason).toMatchObject({ factor: 'EXPERIENCE_QUALITY', references: ['holiday:0'] });
  // Date-specific hours for the holiday settle it.
  const dated = new Map([
    [
      'museum',
      {
        ...hours.get('museum')!,
        currentPeriods: [
          {
            open: { day: 3, hour: 9, minute: 0, date: DAY },
            close: { day: 3, hour: 17, minute: 0, date: DAY },
          },
        ],
        validFrom: DAY,
        validThrough: DAY,
      },
    ],
  ]);
  const confirmed = score([plan], {
    hours: dated,
    holidays: new Map([['holiday', { certainty: 'official' }]]),
  });
  expect(confirmed.days[0]!.explanations.worthImproving.map((entry) => entry.code)).not.toContain(
    'HOLIDAY_HOURS_RISK',
  );
});

test('seasonal fit rewards indoor plans in a wet month and flags outdoor-heavy days', () => {
  const wet = { temperatureMaxC: 31, temperatureMinC: 24, wetDayShare: 0.8 };
  const indoor = score(
    [
      day('indoor', [
        { place: 'museum', time: '10:00', minutes: 120 },
        { place: 'lunch', time: '12:30', minutes: 60 },
      ]),
    ],
    { climate: new Map([['indoor', wet]]) },
  );
  expect(indoor.components.SEASONAL_FIT).toMatchObject({ state: 'EVALUATED', score: 100 });
  const outdoor = score(
    [
      day('outdoor', [
        { place: 'park', time: '09:00', minutes: 90 },
        { place: 'beach', time: '16:00', minutes: 120 },
      ]),
    ],
    { climate: new Map([['outdoor', wet]]) },
  );
  expect(outdoor.components.SEASONAL_FIT).toMatchObject({ state: 'EVALUATED' });
  expect(
    outdoor.components.SEASONAL_FIT.state === 'EVALUATED' && outdoor.components.SEASONAL_FIT.score,
  ).toBeLessThan(100);
  expect(outdoor.explanations.worthImproving.map((reason) => reason.code)).toContain(
    'SEASONAL_OUTDOOR_WET',
  );
  // Without a cached norm nothing is guessed about the season: the row shows the
  // missing-detail value and says why.
  const none = score([day('none', [{ place: 'park', time: '09:00', minutes: 90 }])]);
  expect(none.components.SEASONAL_FIT).toMatchObject({ state: 'EVALUATED', score: 78 });
  expect(none.explanations.uncertainty).toContainEqual(
    expect.objectContaining({ code: 'ROW_NEEDS_DETAIL', factor: 'SEASONAL_FIT' }),
  );
});
