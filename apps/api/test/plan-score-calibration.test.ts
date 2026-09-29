import { expect, test } from 'vitest';
import type { DestinationContextGroup } from '@trove/types';
import {
  evaluateScoredDay,
  interestsForPlaceTypes,
  loadScore,
  daylightUtc,
  type ScoredDayInput,
} from '../src/services/plan-score-evaluation.js';
import {
  scoringCommitments,
  normalizeScoringItems,
  dayOrigin,
  scoringOpeningHours,
} from '../src/services/plan-score-normalization.js';
import { buildPlanScoreFromEvaluations, buildTripPlanScore } from '../src/services/plan-score.js';
import { scoreDay, scoreTrip, toOutcome } from '../src/services/plan-score-rules.js';
import type { PlanScoreDayItem } from '../src/services/plan-score-factors.js';
const at = (minutes: number) => ({ minutes, source: 'USER_OWNED' as const });
const visit = (id: string, extra: Partial<PlanScoreDayItem> = {}): PlanScoreDayItem => ({
  id,
  placeId: id,
  duration: at(60),
  fixed: true,
  start: at(540),
  startWindow: null,
  inboundTravel: null,
  openingHours: {
    status: 'KNOWN',
    source: 'CACHED_PROVIDER',
    intervals: [{ startMinute: 0, endMinute: 1440 }],
  },
  ...extra,
});
const input = (extra: Partial<ScoredDayInput> = {}): ScoredDayInput => ({
  dayId: 'day',
  date: '2026-09-29',
  timeZone: 'Asia/Singapore',
  originInstant: dayOrigin('2026-09-29', 'Asia/Singapore'),
  commitments: [],
  items: [visit('museum')],
  places: [
    {
      tripPlaceId: 'museum',
      name: 'Museum',
      types: ['museum'],
      source: 'CACHED_PROVIDER',
      rating: { status: 'KNOWN', rating: 4.5, reviewCount: 50, source: 'CACHED_PROVIDER' },
    },
  ],
  segments: [{ id: 'local', scope: 'LOCAL', status: 'KNOWN', mode: 'drive', duration: at(0) }],
  preferences: { pace: 'balanced', interests: ['art_museums'], unmatchedInterests: [] },
  planningContext: { intent: 'focused', availability: null },
  ...extra,
});
const assess = (extra: Partial<ScoredDayInput> = {}) => evaluateScoredDay(input(extra));
const score = (extra: Partial<ScoredDayInput> = {}) => scoreDay(assess(extra).input);

test('whole-day propagation catches a conflict that independent adjacent pairs would miss', () => {
  const result = assess({
    items: [
      visit('a', { start: at(540), duration: at(120) }),
      visit('b', { fixed: false, start: null, inboundTravel: at(30), duration: at(120) }),
      visit('c', { start: at(750), inboundTravel: at(30) }),
    ],
  });
  expect(result.conflicts).toMatchObject([
    { kind: 'ARRIVES_AFTER_FIXED_START', severity: 'HARD', verified: true, subjectIds: ['b', 'c'] },
  ]);
  expect(scoreDay(result.input).caps[0]?.limit).toBe(59);
});
test('flexible placement waits for opening and fits around a standalone timed reservation', () => {
  const result = assess({
    items: [
      visit('a', {
        fixed: false,
        start: null,
        startWindow: { earliestMinute: 540, latestMinute: 720, source: 'ESTIMATED' },
        openingHours: {
          status: 'KNOWN',
          source: 'CACHED_PROVIDER',
          intervals: [{ startMinute: 600, endMinute: 900 }],
        },
      }),
    ],
    commitments: [{ id: 'booking', source: 'USER_OWNED', startMinute: 600, endMinute: 660 }],
  });
  expect(result.conflicts).toEqual([]);
});
test('one flexible placement missing both hours and daypart is one material conflict', () => {
  const result = assess({
    items: [
      visit('a', {
        fixed: false,
        start: null,
        startWindow: { earliestMinute: 1080, latestMinute: 1140, source: 'ESTIMATED' },
        openingHours: {
          status: 'KNOWN',
          source: 'CACHED_PROVIDER',
          intervals: [{ startMinute: 540, endMinute: 1020 }],
        },
      }),
    ],
  });
  expect(result.conflicts).toHaveLength(1);
  expect(result.conflicts[0]?.severity).toBe('MATERIAL');
  expect(scoreDay(result.input).caps[0]?.limit).toBe(74);
});
test('estimated durations can support a qualified risk but never a hard cap', () => {
  const result = assess({
    items: [
      visit('a', { duration: { minutes: 180, source: 'ESTIMATED' } }),
      visit('b', { start: at(660), inboundTravel: at(0) }),
    ],
  });
  expect(result.conflicts.some((c) => c.verified && c.severity === 'HARD')).toBe(false);
  expect(scoreDay(result.input).caps).toEqual([]);
});
test('linked journey duration is counted once and its own booking cannot collide with it', () => {
  const commitments = [
    {
      id: 'flight',
      itemId: 'a',
      source: 'USER_OWNED' as const,
      startMinute: 600,
      endMinute: 900,
      longDistance: true,
      endKnown: true,
    },
  ];
  const items = normalizeScoringItems('2026-09-29', 'Asia/Singapore', [visit('a')], {
    commitments,
  });
  const result = assess({ items, commitments, segments: [] });
  expect(result.conflicts).toEqual([]);
  expect(result.pace.activeMinutes).toBe(150);
});
test('generic linked reservations do not double count the visit', () => {
  const result = assess({
    commitments: [
      { id: 'booking', itemId: 'museum', source: 'USER_OWNED', startMinute: 540, endMinute: 600 },
    ],
  });
  expect(result.pace.activeMinutes).toBe(60);
  expect(result.conflicts).toEqual([]);
});
test.each([
  ['relaxed', 70],
  ['balanced', 100],
  ['packed', 100],
] as const)('%s uses the approved comfort target', (pace, expected) => {
  expect(
    toOutcome(
      assess({
        items: [visit('museum', { duration: at(450) })],
        preferences: { pace, interests: [], unmatchedInterests: [] },
      }).pace.factor,
    ),
  ).toMatchObject({ score: expected });
});
test.each([
  [1, 100],
  [1.125, 85],
  [1.25, 70],
  [1.375, 55],
  [1.5, 40],
  [1.75, 20],
  [2, 0],
  [3, 0],
])('comfort interpolation at %f is %f', (ratio, expected) =>
  expect(loadScore(ratio)).toBe(expected),
);
test.each([
  ['walk', 75],
  ['drive', 60],
  ['transit', 45],
])('%s has the prescribed effort multiplier', (mode, load) => {
  expect(
    assess({
      items: [],
      places: [],
      segments: [{ id: 'leg', scope: 'LOCAL', status: 'KNOWN', mode, duration: at(60) }],
      planningContext: { intent: 'transit', availability: null },
    }).pace.activeMinutes,
  ).toBe(load);
});
test('known available time constrains the comfort target', () => {
  const result = assess({
    items: [visit('museum', { duration: at(150) })],
    planningContext: { intent: 'focused', availability: { start: '09:00', end: '11:00' } },
  });
  expect(toOutcome(result.pace.factor)).toMatchObject({ score: 70 });
});
test('missing durations remain unknown except when a known lower bound proves overload', () => {
  const unknown = assess({ items: [visit('a', { duration: null })] });
  expect(unknown.pace.factor.state).toBe('UNKNOWN');
  const overload = assess({
    items: [
      visit('a', { duration: at(700) }),
      visit('b', { duration: null, inboundTravel: at(0), start: at(1300) }),
    ],
  });
  expect(overload.pace.factor).toMatchObject({ state: 'EVALUATED', coverage: 50 });
  expect(overload.input.loadRatio).toBeNull();
});
test('missing local legs cannot make a comfortably paced complete day', () => {
  expect(
    assess({ segments: [{ id: 'missing', scope: 'LOCAL', status: 'UNKNOWN' }] }).pace.factor.state,
  ).toBe('UNKNOWN');
});
test('flight distance, omitted meals and omitted break stops are never penalties', () => {
  const one = score();
  const withoutRating = score({
    places: [{ tripPlaceId: 'museum', types: ['museum'], rating: { status: 'UNKNOWN' } }],
  });
  expect(one.score).toBe(100);
  expect(withoutRating.score).toBe(100);
  const flight = (distanceMeters: number) =>
    assess({
      items: [],
      places: [],
      commitments: [
        {
          id: 'flight',
          source: 'USER_OWNED',
          startMinute: 600,
          endMinute: 900,
          longDistance: true,
          endKnown: true,
        },
      ],
      segments: [{ id: 'flight', scope: 'LONG_DISTANCE', status: 'UNKNOWN', distanceMeters }],
      planningContext: { intent: 'transit', availability: null },
    });
  expect(flight(1000).input.factors).toEqual(flight(10_000_000).input.factors);
  expect(flight(1000).input.factors.ROUTE_EFFICIENCY?.state).toBe('NOT_APPLICABLE');
});
test('custom/unrated venues and mismatched interests remain unknown rather than inferior', () => {
  const result = assess({
    places: [{ tripPlaceId: 'custom', types: ['unrecognized'], rating: { status: 'UNKNOWN' } }],
  });
  expect(result.input.factors.EXPERIENCE_QUALITY?.state).toBe('UNKNOWN');
  expect(result.utilization.state).toBe('UNKNOWN');
  expect(interestsForPlaceTypes(['tourist_attraction', 'point_of_interest'])).toEqual([]);
  expect(interestsForPlaceTypes(['art_gallery'])).toEqual(['art_museums']);
  expect(interestsForPlaceTypes(['hiking_area'])).toEqual(['nature_scenery', 'outdoor_activities']);
});
test('ratings alone support only 15 percent of experience coverage, not interest fit or uniqueness', () => {
  const result = assess({
    preferences: { pace: 'balanced', interests: [], unmatchedInterests: [] },
  });
  expect(toOutcome(result.input.factors.EXPERIENCE_QUALITY!)).toMatchObject({
    score: 100,
    coverage: 15,
  });
});
test('intentional focused repetition does not require diversity or extra stops', () => {
  const result = assess({
    items: [visit('museum'), visit('gallery', { start: at(660), inboundTravel: at(0) })],
    places: [
      ...input().places,
      { tripPlaceId: 'gallery', types: ['art_gallery'], rating: { status: 'UNKNOWN' } },
    ],
  });
  expect(result.variety.state).toBe('NOT_APPLICABLE');
  expect(result.input.factors.PLAN_COMPOSITION).toMatchObject({ score: 100 });
});
test('explicit rest with known free availability can score and recover without stops', () => {
  const result = assess({
    items: [],
    places: [],
    segments: [],
    planningContext: { intent: 'rest', availability: { start: '09:00', end: '17:00' } },
  });
  expect(scoreDay(result.input).score).toBe(100);
  expect(result.input.loadRatio).toBe(0);
  expect(score({ items: [], places: [], segments: [], planningContext: null }).score).toBeNull();
  expect(
    assess({
      items: [],
      places: [],
      segments: [],
      planningContext: { intent: 'rest', availability: null },
    }).input.loadRatio,
  ).toBeNull();
});
test('a series of demanding days is worse than the same intrinsic days with recovery', () => {
  const demanding = assess({ items: [visit('museum', { duration: at(600) })] }).input;
  const rest = assess({
    items: [],
    places: [],
    segments: [],
    planningContext: { intent: 'rest', availability: { start: '09:00', end: '17:00' } },
  }).input;
  const sustained = scoreTrip({
    days: [0, 1, 2].map((i) => ({ ...demanding, dayId: String(i), date: `2026-10-0${i + 1}` })),
  });
  const recovered = scoreTrip({
    days: [
      { ...demanding, dayId: 'a', date: '2026-10-01' },
      { ...rest, dayId: 'r', date: '2026-10-02' },
      { ...demanding, dayId: 'b', date: '2026-10-03' },
    ],
  });
  expect(sustained.fatigueAdjustment).toBeGreaterThan(recovered.fatigueAdjustment);
});
test('complementary focused days cover explicit interests at trip scope', () => {
  const preferences = {
    pace: 'balanced',
    interests: ['art_museums', 'nature_scenery'],
    unmatchedInterests: [],
  };
  const a = assess({ preferences });
  const b = assess({
    preferences,
    places: [{ tripPlaceId: 'park', types: ['botanical_garden'], rating: { status: 'UNKNOWN' } }],
  });
  const result = buildPlanScoreFromEvaluations({
    days: [
      { date: '2026-09-29', evaluation: a },
      { date: '2026-09-30', evaluation: b },
    ],
    mustGoIds: [],
    scheduledIds: [],
  });
  expect(result.components.VARIETY_COVERAGE).toMatchObject({ score: 100, coverage: 100 });
});
const context = (
  kind: 'season' | 'holiday' | 'closure',
  interestMatch = true,
): DestinationContextGroup[] => [
  {
    destination: 'singapore',
    records: [
      {
        id: 'record',
        revision: 1,
        scope: { destination: 'singapore', venueAliases: ['Museum'] },
        kind,
        applicability: { kind: 'dates', start: '2026-09-29', end: '2026-09-29' },
        interests: ['nature_scenery'],
        contentKey: 'record',
        sourceUrl: 'https://example.gov',
        certainty: kind === 'season' ? 'tendency' : 'fact',
        reviewedAt: '2026-09-28T00:00:00Z',
        expiresAt: '2026-09-29T16:00:00Z',
        interestMatch,
        matchedDates: ['2026-09-29'],
        ...(kind === 'closure' ? { accessEffect: 'full_closure' as const } : {}),
      },
    ],
  },
];
test('seasonal patterns and holidays never establish closure or quality penalties', () => {
  const plain = score(),
    season = score({ context: context('season') }),
    holiday = score({ context: context('holiday') });
  expect(season.score).toBe(plain.score);
  expect(holiday.score).toBe(plain.score);
  expect(season.caps).toEqual([]);
  expect(holiday.caps).toEqual([]);
  expect(assess({ context: context('season', false) }).seasonalFit.state).toBe('UNKNOWN');
});
test('only dated authoritative full closure for the exact venue establishes a hard conflict', () => {
  expect(score({ context: context('closure') }).caps[0]?.limit).toBe(59);
  expect(
    score({
      context: context('closure').map((g) => ({
        ...g,
        records: g.records.map((r) => ({
          ...r,
          scope: { ...r.scope, venueAliases: ['Other venue'] },
        })),
      })),
    }).caps,
  ).toEqual([]);
});
test('daylight is calculated locally and polar conditions remain unknown', () => {
  const light = daylightUtc('2026-09-29', { latitude: 1.35, longitude: 103.82 });
  expect(light?.sunrise).toBeLessThan(light!.sunset);
  expect(light!.sunset - light!.sunrise).toBeGreaterThan(11 * 3600000);
  expect(daylightUtc('2026-06-21', { latitude: 89, longitude: 0 })).toBeNull();
  const daylightVisit = assess({
    items: [visit('park')],
    places: [
      {
        tripPlaceId: 'park',
        types: ['park'],
        coordinates: { latitude: 1.35, longitude: 103.82 },
        rating: { status: 'UNKNOWN' },
      },
    ],
  });
  expect(daylightVisit.seasonalFit.state).toBe('UNKNOWN');
});
test('overnight journeys occupy both local days and preserve timezone changes', () => {
  const bookings = [
    {
      id: 'flight',
      flightDepartureInstant: new Date('2026-09-29T14:00:00Z'),
      flightArrivalInstant: new Date('2026-09-30T02:00:00Z'),
    },
  ];
  expect(scoringCommitments(bookings, '2026-09-29', 'Asia/Singapore')).toMatchObject([
    { startMinute: 1320, endMinute: 1440, longDistance: true },
  ]);
  expect(scoringCommitments(bookings, '2026-09-30', 'Asia/Tokyo')).toMatchObject([
    { startMinute: 0, endMinute: 660, startKnown: true, longDistance: true },
  ]);
  const arrivalDay = assess({
    commitments: scoringCommitments(bookings, '2026-09-30', 'Asia/Tokyo'),
  });
  expect(arrivalDay.conflicts).toContainEqual(
    expect.objectContaining({ severity: 'HARD', verified: true }),
  );
  expect(scoreDay(arrivalDay.input).caps[0]?.limit).toBe(59);
});
test.each([
  ['2026-03-08', 1380],
  ['2026-11-01', 1500],
])('DST day %s has %i real occupied minutes', (date, minutes) => {
  const origin = dayOrigin(date, 'America/New_York');
  expect(
    scoringCommitments(
      [
        {
          id: 'train',
          transportDepartureInstant: new Date(origin),
          transportArrivalInstant: new Date(origin + minutes * 60000),
        },
      ],
      date,
      'America/New_York',
    ),
  ).toMatchObject([{ startMinute: 0, endMinute: minutes }]);
});
test('missing arrivals never become zero-duration journeys or proven recovery', () => {
  const commitments = scoringCommitments(
    [{ id: 'flight', flightDepartureInstant: new Date('2026-09-29T01:00:00Z') }],
    '2026-09-29',
    'Asia/Singapore',
  );
  expect(commitments).toMatchObject([{ startMinute: 540, endMinute: 540, endKnown: false }]);
  const result = assess({ items: [], places: [], segments: [], commitments });
  expect(result.pace.factor.state).toBe('UNKNOWN');
  expect(result.input.loadRatio).toBeNull();
});
test('one known booking does not establish duration coverage for unrelated long-distance legs', () => {
  const commitments = [
    {
      id: 'booking',
      itemId: 'train',
      longDistance: true,
      source: 'USER_OWNED' as const,
      startMinute: 120,
      endMinute: 180,
      endKnown: true,
    },
  ];
  const segment = { id: 'journey', scope: 'LONG_DISTANCE' as const, status: 'UNKNOWN' as const };
  expect(
    assess({ commitments, segments: [{ ...segment, itemIds: ['another-journey'] }] }).pace.factor
      .state,
  ).toBe('UNKNOWN');
  expect(
    assess({ commitments, segments: [{ ...segment, itemIds: ['train'] }] }).pace.factor.state,
  ).toBe('EVALUATED');
});
test('authoritative instants distinguish both occurrences of a repeated DST hour', () => {
  const items = normalizeScoringItems(
    '2026-11-01',
    'America/New_York',
    [visit('first', { start: at(90) }), visit('second', { start: at(90) })],
    {
      instants: new Map([
        ['first', new Date('2026-11-01T05:30:00Z')],
        ['second', new Date('2026-11-01T06:30:00Z')],
      ]),
    },
  );
  expect(items.map((i) => i.start?.minutes)).toEqual([90, 150]);
});
test('dated hours apply only within their stated horizon; overnight weekly hours cross midnight', () => {
  const date = '2026-09-29',
    zone = 'Asia/Singapore',
    origin = dayOrigin(date, zone);
  const hours = {
    timeZone: zone,
    utcOffsetMinutes: 480,
    periods: [{ open: { day: 2, hour: 9, minute: 0 }, close: { day: 2, hour: 17, minute: 0 } }],
    currentPeriods: [
      { open: { day: 2, hour: 10, minute: 0, date }, close: { day: 2, hour: 12, minute: 0, date } },
    ],
    validFrom: date,
    validThrough: date,
  };
  expect(scoringOpeningHours({ date, zone, origin, hours })).toMatchObject({
    intervals: [{ startMinute: 600, endMinute: 720 }],
  });
  expect(
    scoringOpeningHours({ date: '2026-10-06', zone, origin: dayOrigin('2026-10-06', zone), hours }),
  ).toMatchObject({ intervals: [{ startMinute: 540, endMinute: 1020 }] });
  expect(
    scoringOpeningHours({
      date,
      zone,
      origin,
      hours: {
        ...hours,
        currentPeriods: undefined,
        periods: [{ open: { day: 1, hour: 22, minute: 0 }, close: { day: 2, hour: 2, minute: 0 } }],
      },
    }),
  ).toMatchObject({ intervals: [{ startMinute: 0, endMinute: 120 }] });
});

test('an unknown overnight arrival cannot establish recovery on a later rest day', () => {
  const commitments = scoringCommitments(
    [{ id: 'flight', flightDepartureInstant: new Date('2026-09-28T14:00:00Z') }],
    '2026-09-29',
    'Asia/Singapore',
  );
  expect(commitments).toMatchObject([{ startKnown: false, endKnown: false }]);
  const result = assess({
    items: [],
    places: [],
    segments: [],
    commitments,
    planningContext: { intent: 'rest', availability: { start: '09:00', end: '17:00' } },
  });
  expect(result.input.loadRatio).toBeNull();
  expect(result.conflicts).toEqual([]);
});
test('linked indispensable connections propagate the trip cap and item references', () => {
  const result = assess({
    commitments: [
      {
        id: 'connection',
        source: 'USER_OWNED',
        startMinute: 540,
        endMinute: 660,
        longDistance: true,
        indispensable: true,
      },
    ],
  });
  expect(result.input.indispensableConnectionConflict).toBe(true);
  expect(scoreTrip({ days: [result.input] }).caps[0]?.reason).toBe('TRIP_CONNECTION_CONFLICT');
  expect(scoreDay(result.input).caps[0]?.references).toEqual(['connection', 'museum']);
});

test('an estimated visit end cannot establish an entirely closed fixed visit cap', () => {
  const result = assess({
    items: [
      visit('museum', {
        duration: { minutes: 120, source: 'ESTIMATED' },
        openingHours: {
          status: 'KNOWN',
          source: 'CACHED_PROVIDER',
          intervals: [{ startMinute: 720, endMinute: 1020 }],
        },
      }),
    ],
  });
  expect(result.conflicts[0]).toMatchObject({ verified: false, severity: 'SOFT' });
  expect(scoreDay(result.input).caps).toEqual([]);
});

test('an unreachable daypart remains material when its own duration is missing', () => {
  const result = assess({
    items: [
      visit('a', { start: at(900) }),
      visit('b', {
        fixed: false,
        start: null,
        duration: null,
        inboundTravel: at(90),
        startWindow: { earliestMinute: 540, latestMinute: 720, source: 'ESTIMATED' },
      }),
    ],
  });
  expect(result.conflicts).toContainEqual(
    expect.objectContaining({ severity: 'MATERIAL', kind: 'ARRIVES_AFTER_FIXED_START' }),
  );
});
test('original evidence age changes the assessment fingerprint and its expiry', () => {
  const evaluation = assess();
  const build = (evidenceTimes: string[]) =>
    buildPlanScoreFromEvaluations({
      days: [{ date: '2026-09-29', evaluation }],
      mustGoIds: [],
      scheduledIds: [],
      evaluatedAt: new Date('2026-09-29T00:00:00Z'),
      evidenceTimes,
    });
  const older = build(['2026-08-30T01:00:00Z']),
    fresh = build(['2026-09-28T00:00:00Z']);
  expect(older.fingerprint).not.toBe(fresh.fingerprint);
  expect(older.expiresAt).toBe('2026-09-29T01:00:00.000Z');
  expect(fresh.expiresAt).toBe('2026-09-30T00:00:00.000Z');
});

test('AI estimates and equivalent stored itinerary inputs produce the same category outcomes', () => {
  const original = input();
  const date = original.date!,
    zone = original.timeZone!;
  const hours = new Map([
    [
      'museum',
      {
        periods: [{ open: { day: 0, hour: 0, minute: 0 }, close: null }],
        utcOffsetMinutes: 480,
        timeZone: zone,
        source: 'CACHED_PROVIDER' as const,
      },
    ],
  ]);
  const estimated = visit('museum', {
    fixed: false,
    start: { minutes: 540, source: 'ESTIMATED' },
    duration: { minutes: 60, source: 'ESTIMATED' },
    inboundTravel: at(0),
    inboundRequired: true,
  });
  const planningContext = { intent: 'focused', availability: { start: '09:00', end: '17:00' } };
  const direct = scoreDay(
    evaluateScoredDay({
      ...original,
      planningContext,
      items: normalizeScoringItems(date, zone, [estimated], { hours }),
    }).input,
  );
  const stored = buildTripPlanScore({
    preferences: original.preferences,
    places: new Map(original.places.map((p) => [p.tripPlaceId, p])),
    hours,
    ratings: new Map(),
    mustGoTripPlaceIds: [],
    days: [
      {
        id: 'day',
        date,
        timeZone: zone,
        planningContext,
        commitments: [],
        items: [
          {
            id: 'museum',
            tripPlaceId: 'museum',
            durationMinutes: 60,
            durationProvenance: 'AI_ESTIMATED',
            timeProvenance: 'AI_ESTIMATED',
            timeSemantics: 'FLOATING_LOCAL',
            timeZone: zone,
            startInstant: null,
            localStartTime: new Date('1970-01-01T09:00:00Z'),
            dayPart: null,
            reservationCount: 0,
          },
        ],
      },
    ],
    routes: new Map([
      [
        'day',
        {
          generatedAt: '2026-09-29T00:00:00Z',
          segments: [
            {
              id: 'local',
              mode: 'drive',
              scope: 'local',
              durationSeconds: 0,
              distanceMeters: 0,
              encodedPolyline: null,
              provider: null,
              status: 'ok',
              reason: null,
              origin: { id: 'base', kind: 'daily_base', label: null },
              destination: { id: 'museum', kind: 'itinerary_item', label: null },
              modeOwner: { id: 'day', kind: 'day_start' },
            },
          ],
          summary: {
            distanceMeters: 0,
            durationSeconds: 0,
            knownSegmentCount: 1,
            localSegmentCount: 1,
            scheduledPlaceCount: 1,
            status: 'complete',
            totalSegmentCount: 1,
          },
        },
      ],
    ]),
  });
  expect(stored.days[0]?.factors).toEqual(direct.factors);
  expect(stored.days[0]?.score).toBe(direct.score);
});
