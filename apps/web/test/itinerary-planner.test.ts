import type { PlanScoreExplanation, TripPlanScoreDay } from '@trove/types';
import { expect, test } from 'vitest';

import type {
  ItineraryDay,
  ItineraryDayRoutes,
  ItineraryItem,
  ItineraryTripPlace,
  PlaceHoursStatus,
} from '../lib/itinerary/api.ts';
import { withDayPartBands } from '../lib/itinerary/day-bands.ts';
import { dayFacts, dayHeading, plannedStopMinutes } from '../lib/itinerary/day-facts.ts';
import { buildDaySequence } from '../lib/itinerary/day-sequence.ts';
import { daySketchPlaces } from '../lib/itinerary/day-sketch.ts';
import { plannerDays } from '../lib/itinerary/planner-days.ts';
import { stayChapters } from '../lib/itinerary/stay-chapters.ts';
import { formatPlannedDuration, formatTravelDuration } from '../lib/itinerary/route-format.ts';
import { stopHoursAt } from '../lib/itinerary/stop-hours.ts';
import { dayNeedsAttention, problemsByStop } from '../lib/plan-score/attention.ts';

function place(
  id: string,
  location: { latitude: number; longitude: number } | null,
  address: string | null = null,
): ItineraryTripPlace {
  return {
    customName: null,
    id,
    note: null,
    place: {
      id: `place-${id}`,
      kind: 'custom',
      location: location ? { ...location, timeZone: null } : null,
      name: id,
      note: null,
      providerAddress: address,
      providerLabel: null,
      providerRefs: [],
      timeZone: null,
    },
    priority: null,
  };
}

function item(id: string, overrides: Partial<ItineraryItem> = {}): ItineraryItem {
  return {
    createdAt: '2026-09-05T00:00:00.000Z',
    customLabel: id,
    customLocation: null,
    dayPart: null,
    durationMinutes: null,
    id,
    itineraryDayId: 'day',
    localStartTime: null,
    notes: null,
    plannedCost: null,
    position: 0,
    priority: null,
    startInstant: null,
    timeSemantics: null,
    timeZone: null,
    timeZoneSource: null,
    travelStatus: 'upcoming',
    tripPlace: null,
    updatedAt: '2026-09-05T00:00:00.000Z',
    ...overrides,
  };
}

function day(id: string, overrides: Partial<ItineraryDay> = {}): ItineraryDay {
  return {
    dailyBaseDepartureTripPlaceId: null,
    dailyBaseTripPlaceId: null,
    date: '2026-09-05',
    defaultTimeZone: 'Asia/Ho_Chi_Minh',
    defaultTimeZoneSource: 'trip_reference',
    defaultTimeZoneSourceTripPlaceId: null,
    experienceNote: null,
    experienceRating: null,
    id,
    items: [],
    name: null,
    notes: null,
    routeStartTravelMode: 'drive',
    ...overrides,
  };
}

function problem(
  code: string,
  severity: PlanScoreExplanation['severity'],
  references: string[],
): PlanScoreExplanation {
  return {
    action: 'ADJUST_TIME',
    code,
    factor: 'FEASIBILITY',
    messageKey: `reasons.${code}`,
    references,
    severity,
    values: {},
  };
}

function scoreDay(dayId: string, worthImproving: PlanScoreExplanation[]): TripPlanScoreDay {
  return {
    assessmentBasis: [],
    assessmentStatus: 'available',
    caps: [],
    completeness: 1,
    confidence: 1,
    date: '2026-09-05',
    dayId,
    explanations: { uncertainty: [], whatWorks: [], worthImproving },
    factors: {
      EXPERIENCE_QUALITY: { state: 'NOT_APPLICABLE' },
      FEASIBILITY: { state: 'NOT_APPLICABLE' },
      PACE_COMFORT: { state: 'NOT_APPLICABLE' },
      PLAN_COMPOSITION: { state: 'NOT_APPLICABLE' },
      ROUTE_EFFICIENCY: { state: 'NOT_APPLICABLE' },
    },
    limitations: [],
    score: 80,
    withheldReasons: [],
  };
}

const HOTEL = place(
  'hotel',
  { latitude: 15.877, longitude: 108.326 },
  '1 Riverside, Hội An, Vietnam',
);
const MARKET = place(
  'market',
  { latitude: 15.879, longitude: 108.335 },
  '2 Market St, Hội An, Vietnam',
);
const BEACH = place('beach', { latitude: 15.9, longitude: 108.36 }, 'An Bang, Hội An, Vietnam');
const UNLOCATED = place('somewhere', null);

test('a day is headed by its name, else its town, else its date - and the date is said once', () => {
  expect(dayHeading({ name: '  Lantern night ' }, 'Hội An')).toStrictEqual({
    source: 'name',
    title: 'Lantern night',
  });
  expect(dayHeading({ name: null }, 'Hội An')).toStrictEqual({ source: 'town', title: 'Hội An' });
  expect(dayHeading({ name: '   ' }, null)).toStrictEqual({ source: 'date' });
});

test('planned time is only totalled when every stop says how long it takes', () => {
  expect(plannedStopMinutes(item('a', { localEndTime: '10:30', localStartTime: '09:00' }))).toBe(
    90,
  );
  // A visit running past midnight is still a visit, not a negative one.
  expect(plannedStopMinutes(item('b', { localEndTime: '01:00', localStartTime: '23:00' }))).toBe(
    120,
  );
  expect(plannedStopMinutes(item('c', { durationMinutes: 45 }))).toBe(45);
  expect(plannedStopMinutes(item('d'))).toBeNull();

  const known = day('known', {
    items: [
      item('a', { durationMinutes: 60 }),
      item('b', { durationMinutes: 90, durationProvenance: 'ai_estimated' }),
    ],
  });
  expect(dayFacts(known, null).planned).toStrictEqual({ approximate: true, minutes: 150 });
  expect(dayFacts(known, null).travel).toBeNull();

  const partly = day('partly', { items: [item('a', { durationMinutes: 60 }), item('b')] });
  expect(dayFacts(partly, null).planned).toBeNull();
  expect(dayFacts(day('empty'), null)).toStrictEqual({ planned: null, stopCount: 0, travel: null });
});

test('travel facts say what is not known rather than reporting zero', () => {
  const summary = (overrides: Partial<ItineraryDayRoutes['summary']>) => ({
    summary: {
      distanceMeters: 4200,
      durationSeconds: 1500,
      knownSegmentCount: 3,
      localSegmentCount: 3,
      scheduledPlaceCount: 3,
      status: 'complete' as const,
      totalSegmentCount: 3,
      ...overrides,
    },
  });
  const facts = (overrides: Partial<ItineraryDayRoutes['summary']>) =>
    dayFacts(day('d'), summary(overrides)).travel;

  expect(facts({})).toStrictEqual({
    distanceMeters: 4200,
    durationSeconds: 1500,
    kind: 'known',
    partial: false,
  });
  expect(facts({ status: 'partial' })).toMatchObject({ kind: 'known', partial: true });
  expect(facts({ durationSeconds: null, status: 'unavailable' })).toStrictEqual({
    kind: 'unavailable',
  });
  expect(facts({ localSegmentCount: 0 })).toStrictEqual({ kind: 'long_distance_only' });
  expect(facts({ localSegmentCount: 0, totalSegmentCount: 0 })).toStrictEqual({ kind: 'none' });
});

test('day-part labels mark where the day moves on, and never reorder it', () => {
  const morning = item('morning', { localStartTime: '08:30' });
  const loose = item('loose');
  const lunch = item('lunch', { dayPart: 'afternoon' });
  const late = item('late', { localStartTime: '19:00' });
  const early = item('early', { localStartTime: '07:00' });
  const entries = buildDaySequence({
    bases: { arrivalTripPlaceId: 'hotel', departureTripPlaceId: 'hotel' },
    items: [morning, loose, lunch, late, early],
    routeSegments: [
      {
        destination: { id: 'lunch', kind: 'itinerary_item', label: null },
        distanceMeters: 100,
        durationSeconds: 60,
        encodedPolyline: null,
        id: 'to-lunch',
        mode: 'walk',
        modeOwner: { id: 'loose', kind: 'item_departure' },
        origin: { id: 'loose', kind: 'itinerary_item', label: null },
        provider: null,
        reason: null,
        scope: 'local',
        status: 'ok',
      },
    ],
  });

  const shape = withDayPartBands(entries).map((entry) =>
    entry.kind === 'band'
      ? `[${entry.band}]`
      : entry.kind === 'stop'
        ? entry.item.id
        : entry.kind === 'leg'
          ? `~${entry.segment.id}`
          : `stay-${entry.role}`,
  );

  expect(shape).toStrictEqual([
    'stay-arrival',
    '[morning]',
    'morning',
    'loose',
    // The leg into the afternoon belongs to the afternoon.
    '[afternoon]',
    '~to-lunch',
    'lunch',
    '[evening]',
    'late',
    // Placed after the evening by the traveller, and shown where they placed it.
    '[morning]',
    'early',
    'stay-departure',
  ]);

  const untimed = buildDaySequence({
    bases: { arrivalTripPlaceId: null, departureTripPlaceId: null },
    items: [item('a'), item('b', { dayPart: 'anytime' })],
  });
  expect(withDayPartBands(untimed).some((entry) => entry.kind === 'band')).toBe(false);
});

test("a stop's hours are read against the time it is planned for", () => {
  const open = (spans: Array<{ close: string; open: string }>): PlaceHoursStatus => ({
    asOf: '2026-09-01T00:00:00.000Z',
    spans,
    special: false,
    status: 'open',
  });
  const daytime = open([{ close: '17:00', open: '09:00' }]);
  const split = open([
    { close: '14:00', open: '11:00' },
    { close: '22:00', open: '17:30' },
  ]);

  expect(stopHoursAt(undefined, '10:00', null)).toBeNull();
  expect(
    stopHoursAt({ asOf: '2026-09-01T00:00:00.000Z', status: 'closed' }, '10:00', null),
  ).toStrictEqual({ kind: 'closed_day' });
  expect(stopHoursAt(daytime, null, null)).toBeNull();
  expect(stopHoursAt(daytime, '10:00', '11:00')).toStrictEqual({
    close: '17:00',
    kind: 'open_until',
  });
  expect(stopHoursAt(daytime, '16:00', '18:00')).toStrictEqual({
    close: '17:00',
    kind: 'closes_during',
  });
  expect(stopHoursAt(daytime, '19:00', null)).toStrictEqual({ kind: 'closed_at', opens: null });
  expect(stopHoursAt(split, '15:00', null)).toStrictEqual({ kind: 'closed_at', opens: '17:30' });
  expect(stopHoursAt(split, '18:00', '23:30')).toStrictEqual({
    close: '22:00',
    kind: 'closes_during',
  });
  // A visit running past midnight outlasts a place that closes at midnight.
  expect(stopHoursAt(open([{ close: '24:00', open: '18:00' }]), '23:00', '00:30')).toStrictEqual({
    close: '24:00',
    kind: 'closes_during',
  });
  expect(stopHoursAt(open([{ close: '24:00', open: '00:00' }]), '03:00', null)).toStrictEqual({
    kind: 'open_all_day',
  });
});

test('the sketch follows the day as travelled, skipping stops with nowhere to be', () => {
  const entries = buildDaySequence({
    bases: { arrivalTripPlaceId: 'hotel', departureTripPlaceId: 'hotel' },
    items: [
      item('market', { tripPlace: MARKET }),
      item('label-only'),
      item('lost', { tripPlace: UNLOCATED }),
      item('beach', { tripPlace: BEACH }),
    ],
  });

  expect(
    daySketchPlaces(entries, [HOTEL, MARKET, BEACH, UNLOCATED]).map(
      (place) => `${place.kind}:${place.key}:${place.number}`,
    ),
  ).toStrictEqual([
    'stay:stay-arrival:1',
    'stop:market:2',
    'stop:beach:5',
    'stay:stay-departure:6',
  ]);
});

test('the ribbon numbers days in order, names their towns and flags verified problems only', () => {
  const days = [
    day('d1', { date: '2026-09-05', dailyBaseTripPlaceId: 'hotel' }),
    day('d2', { date: '2026-09-06', items: [item('x'), item('y')], name: ' Beach day ' }),
  ];
  const ribbon = plannerDays({
    days,
    planScoreDays: [
      scoreDay('d1', [problem('OVERLAP', 'HARD', ['x'])]),
      scoreDay('d2', [problem('LONG_GAP', 'RISK', ['y'])]),
    ],
    today: '2026-09-06',
    tripPlaces: [HOTEL],
  });

  expect(ribbon).toStrictEqual([
    {
      attention: true,
      date: '2026-09-05',
      id: 'd1',
      isToday: false,
      name: null,
      number: 1,
      stopCount: 0,
      town: 'Hội An',
    },
    {
      attention: false,
      date: '2026-09-06',
      id: 'd2',
      isToday: true,
      name: 'Beach day',
      number: 2,
      stopCount: 2,
      town: null,
    },
  ]);
});

test('advice that belongs to Insights never raises a day, and a disabled score raises nothing', () => {
  expect(dayNeedsAttention(scoreDay('d', [problem('RAIN_FORECAST', 'HARD', ['x'])]))).toBe(false);
  expect(
    dayNeedsAttention({
      ...scoreDay('d', [problem('OVERLAP', 'HARD', ['x'])]),
      withheldReasons: ['ADMINISTRATIVELY_DISABLED'],
    }),
  ).toBe(false);
  expect(dayNeedsAttention(undefined)).toBe(false);
});

test("a day's problems are placed with the stop they name, the rest stay with the day", () => {
  const overlap = problem('OVERLAP', 'HARD', ['other-day-item', 'b']);
  const pace = problem('PACE', 'MATERIAL', ['d1']);
  const rain = problem('RAIN_FORECAST', 'RISK', ['a']);
  const untimed = problem('DETAIL_MISSING', 'INFO', ['a', 'b']);
  const { byItem, day: dayLevel } = problemsByStop(
    { uncertainty: [], whatWorks: [], worthImproving: [pace, rain, overlap, untimed] },
    ['a', 'b'],
  );

  expect(byItem.get('b')).toStrictEqual([overlap]);
  // Rain is Insights' to say, not the score's.
  expect(byItem.has('a')).toBe(false);
  // A problem about several of the day's stops is about the day, not the first of them.
  expect(dayLevel).toStrictEqual([pace, untimed]);
  expect(problemsByStop(null, ['a']).day).toStrictEqual([]);
});

test('travel and planned time read the way people say them', () => {
  expect(formatTravelDuration(12 * 60, 'en')).toBe('12 min');
  expect(formatTravelDuration(65 * 60, 'en')).toBe('1 hr 5 min');
  expect(formatTravelDuration(2 * 60 * 60, 'en')).toBe('2 hr');
  expect(formatPlannedDuration(45, 'en')).toBe('45 min');
  expect(formatPlannedDuration(5 * 60 + 20, 'en')).toBe('5 hr 15 min');
});

test('the trip falls into chapters by where each night is spent, in the order lived', () => {
  const stayAt = (id: string, date: string, tripPlaceId: string | null) =>
    day(id, {
      date,
      stay: tripPlaceId
        ? {
            endSource: 'accommodation',
            endTripPlaceId: tripPlaceId,
            startSource: 'accommodation',
            startTripPlaceId: tripPlaceId,
          }
        : undefined,
    });
  const days = [
    stayAt('d1', '2026-09-05', 'hotel'),
    stayAt('d2', '2026-09-06', 'hotel'),
    stayAt('d3', '2026-09-07', 'beach-house'),
    stayAt('d4', '2026-09-08', null),
    stayAt('d5', '2026-09-09', null),
    stayAt('d6', '2026-09-10', 'hotel'),
  ];
  const ribbon = plannerDays({ days, today: null, tripPlaces: [HOTEL] }).map((entry, index) => ({
    ...entry,
    // Days 4 and 5 are in one town written two ways; the rest name nothing new.
    town: index === 3 ? 'Hội An' : index === 4 ? 'Hoi An' : entry.town,
  }));

  const chapters = stayChapters({ days, plannerDays: ribbon });

  expect(
    chapters.map((chapter) => [chapter.kind, chapter.days.map((entry) => entry.id)]),
  ).toStrictEqual([
    ['stay', ['d1', 'd2']],
    ['stay', ['d3']],
    ['town', ['d4', 'd5']],
    // Back at the first hotel later on is a chapter of its own.
    ['stay', ['d6']],
  ]);
  expect(chapters[0]?.stayTripPlaceId).toBe('hotel');
});
