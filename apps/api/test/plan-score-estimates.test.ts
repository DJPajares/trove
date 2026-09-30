import { expect, test } from 'vitest';

import type { ItineraryDayRoutes } from '../src/services/itinerary-routes.js';
import type { PlanScoreDayItem } from '../src/services/plan-score-factors.js';
import {
  estimateLegMinutes,
  inferDurations,
  legCalibration,
  seasonalDayFit,
  withEstimatedLegs,
} from '../src/services/plan-score-estimates.js';
import { interestsForPlaceTypes, placeProfile } from '../src/services/plan-score-place-types.js';

/** A point `km` east of the origin along the equator, so distances are easy to read. */
const east = (km: number) => ({ latitude: 0, longitude: km / 111.195 });

test('leg estimates follow the fitted per-mode model and stay unknown when not local', () => {
  expect(estimateLegMinutes(east(0), east(5), 'drive')).toBeCloseTo(8 + 2.2 * 5, 1);
  // Driving gets faster per kilometre past 10 km.
  expect(estimateLegMinutes(east(0), east(20), 'drive')).toBeCloseTo(8 + 22 + 12, 1);
  expect(estimateLegMinutes(east(0), east(1), 'walk')).toBeCloseTo(17, 1);
  expect(estimateLegMinutes(east(0), east(4), 'transit')).toBeCloseTo(22, 1);
  expect(estimateLegMinutes(east(0), east(0), 'drive')).toBe(0);
  // A drive between stays in different towns reaches highway pace.
  expect(estimateLegMinutes(east(0), east(190), 'drive')).toBeCloseTo(8 + 22 + 48 + 126, 1);
  // A flight is never estimated, and a leg beyond what the mode plausibly covers stays unknown.
  expect(estimateLegMinutes(east(0), east(5), 'flight')).toBeNull();
  expect(estimateLegMinutes(east(0), east(700), 'drive')).toBeNull();
  expect(estimateLegMinutes(east(0), east(30), 'walk')).toBeNull();
});

test("a trip's own routed legs scale its estimates, bounded against one odd leg", () => {
  const model = 8 + 2.2 * 5;
  const calibration = legCalibration([
    { mode: 'drive', km: 5, minutes: model * 1.5 },
    { mode: 'drive', km: 5, minutes: model * 1.5 },
    // One sample is not enough for a median.
    { mode: 'walk', km: 1, minutes: 60 },
  ]);
  expect(calibration.drive).toBeCloseTo(1.5);
  expect(calibration.walk).toBeUndefined();
  expect(estimateLegMinutes(east(0), east(5), 'drive', calibration)).toBeCloseTo(model * 1.5, 1);
  expect(
    legCalibration([
      { mode: 'drive', km: 5, minutes: model * 9 },
      { mode: 'drive', km: 5, minutes: model * 9 },
    ]).drive,
  ).toBe(2);
});

const point = (id: string, kind: 'daily_base' | 'itinerary_item' = 'itinerary_item') => ({
  id,
  kind,
  label: null,
});
function leg(from: string, to: string, durationSeconds: number | null, scope = 'local') {
  return {
    destination: point(to),
    distanceMeters: null,
    durationSeconds,
    encodedPolyline: null,
    id: `${from}>${to}`,
    mode: 'drive',
    modeOwner: { id: from, kind: 'item_departure' },
    origin: point(from),
    provider: 'google',
    reason: durationSeconds === null ? 'route_not_found' : null,
    scope,
    status: durationSeconds === null ? 'unavailable' : 'ok',
  } as ItineraryDayRoutes['segments'][number];
}

test('only unrouted local legs between located stops are estimated, and they say so', () => {
  const places: Record<string, ReturnType<typeof east>> = { a: east(0), b: east(5), c: east(9) };
  const routes = {
    generatedAt: '2026-10-01T00:00:00.000Z',
    segments: [
      leg('a', 'b', null),
      leg('b', 'c', 600),
      leg('c', 'nowhere', null),
      leg('a', 'c', null, 'long_distance'),
    ],
    summary: {} as ItineraryDayRoutes['summary'],
  } satisfies ItineraryDayRoutes;
  const estimated = withEstimatedLegs(routes, (p) => places[p.id] ?? null, {})!;
  expect(estimated.segments[0]).toMatchObject({ estimated: true });
  expect(estimated.segments[0]!.durationSeconds! / 60).toBeCloseTo(8 + 2.2 * 5, 1);
  // A routed leg, an unlocated end and a long-distance leg are left alone.
  expect(estimated.segments[1]).toBe(routes.segments[1]);
  expect(estimated.segments[2]).toMatchObject({ durationSeconds: null });
  expect(estimated.segments[3]).toMatchObject({ durationSeconds: null });
});

const item = (id: string, extra: Partial<PlanScoreDayItem> = {}): PlanScoreDayItem => ({
  id,
  duration: null,
  fixed: true,
  start: null,
  startWindow: null,
  inboundTravel: null,
  openingHours: { status: 'UNKNOWN' },
  ...extra,
});
const at = (minutes: number) => ({ minutes, source: 'USER_OWNED' as const });

test("unstated durations come from the traveller's own timing first, then typical lengths", () => {
  const { items, allowedMinutes, typeInferred } = inferDurations(
    [
      item('museum', { start: at(600) }),
      item('lunch', { start: at(780), inboundTravel: at(20) }),
      item('park', { start: at(900), duration: at(45) }),
      item('evening', { start: at(1140) }),
      item('rest', { start: at(1300), blockType: 'free_time' }),
    ],
    (entry) => ({ museum: 120, lunch: 75, evening: 90 })[entry.id] ?? null,
  );
  // 10:00 to 13:00, less 20 minutes' travel, allows 160; the typical 120 fits inside it.
  expect(allowedMinutes.get('museum')).toBe(160);
  expect(items[0]!.duration).toEqual({ minutes: 120, source: 'ESTIMATED' });
  // 13:00 to 15:00 allows 120: the typical 75 leaves room, and the gap stays traveller-owned.
  expect(items[1]!.duration).toEqual({ minutes: 75, source: 'ESTIMATED' });
  // A stated duration is never replaced.
  expect(items[2]!.duration).toEqual(at(45));
  // An evening stop bounded by a free-time block still infers, leaving a transition buffer.
  expect(items[3]!.duration?.minutes).toBe(90);
  // Non-activity blocks carry no visit length.
  expect(items[4]!.duration).toBeNull();
  expect([...typeInferred]).toEqual([]);

  const untimed = inferDurations([item('museum')], () => 120);
  expect(untimed.items[0]!.duration).toEqual({ minutes: 120, source: 'ESTIMATED' });
  expect(untimed.typeInferred.has('museum')).toBe(true);

  // A gap never fills the whole interval: the next start keeps its transition buffer.
  const tight = inferDurations(
    [item('a', { start: at(600) }), item('b', { start: at(660) })],
    () => null,
  );
  expect(tight.items[0]!.duration?.minutes).toBe(45);
});

test('seasonal fit weighs outdoor time against typical conditions, never indoor plans', () => {
  const wet = { temperatureMaxC: 30, temperatureMinC: 24, wetDayShare: 0.8 };
  const indoor = seasonalDayFit([{ minutes: 120, outdoor: false, midday: true }], wet);
  expect(indoor.factor).toMatchObject({ state: 'EVALUATED', score: 100 });
  expect(indoor.wet).toBe(false);
  const outdoor = seasonalDayFit([{ minutes: 120, outdoor: true, midday: false }], wet);
  expect(outdoor.factor).toMatchObject({ state: 'EVALUATED', score: 60 });
  expect(outdoor.wet).toBe(true);
  const hot = seasonalDayFit([{ minutes: 60, outdoor: true, midday: true }], {
    temperatureMaxC: 36,
    temperatureMinC: 27,
    wetDayShare: 0.1,
  });
  expect(hot.factor).toMatchObject({ score: 80 });
  expect(hot.heat).toBe(true);
  expect(seasonalDayFit([{ minutes: 60, outdoor: true, midday: false }], null).factor.state).toBe(
    'UNKNOWN',
  );
  expect(seasonalDayFit([], wet).factor.state).toBe('NOT_APPLICABLE');
});

test('place profiles prefer the specific kind and keep logistics out of visits', () => {
  expect(placeProfile(['tourist_attraction', 'seafood_restaurant', 'restaurant'])).toMatchObject({
    kind: 'visit',
    visit: { typical: 75, minimum: 30 },
  });
  expect(placeProfile(['international_airport', 'airport'])?.kind).toBe('logistics');
  expect(placeProfile(['tourist_attraction'])?.visit?.typical).toBe(60);
  expect(placeProfile(['park'])).toMatchObject({ outdoor: true, windows: 'DAYLIGHT' });
  expect(placeProfile(['museum'])).toMatchObject({ windowKind: 'ACCESS', holidaySensitive: true });
  expect(placeProfile(['point_of_interest', 'establishment'])).toBeNull();
  expect(placeProfile([])).toBeNull();
  expect(interestsForPlaceTypes(['vietnamese_restaurant'])).toEqual(['food_drink']);
  expect(interestsForPlaceTypes(['shinto_shrine'])).toEqual(['culture_history', 'architecture']);
});
