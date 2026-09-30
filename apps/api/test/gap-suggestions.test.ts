import { expect, test } from 'vitest';

import { findDayGaps, type GapCandidate } from '../src/services/gap-suggestions-rules.js';
import type { PlanScoreDayItem } from '../src/services/plan-score-factors.js';

// One degree of longitude at the equator is ~111 km; walking ~5 km/h.
const at = (km: number) => ({ latitude: 0, longitude: km / 111.32 });
const minutes = (value: number) => ({ minutes: value, source: 'USER_OWNED' as const });

const item = (id: string, start: number, duration: number): PlanScoreDayItem => ({
  duration: minutes(duration),
  fixed: false,
  id,
  inboundTravel: null,
  openingHours: { status: 'UNKNOWN' },
  placeId: id,
  start: minutes(start),
  startWindow: null,
});

const stops = { morning: at(0), evening: at(1) };
const items = [item('morning', 9 * 60, 120), item('evening', 18 * 60, 90)];
const locate = (id: string | undefined) => (id ? (stops[id as keyof typeof stops] ?? null) : null);

const candidate = (
  id: string,
  km: number,
  overrides: Partial<GapCandidate> = {},
): GapCandidate => ({
  coordinates: at(km),
  hours: { status: 'UNKNOWN' },
  rating: null,
  tripPlaceId: id,
  types: ['museum'],
  ...overrides,
});

const gaps = (candidates: GapCandidate[], interests: string[] = []) =>
  findDayGaps({ calibration: {}, candidates, interests, items, locate, mode: 'walk' });

test('the afternoon between two stops is offered the nearest places that fit, three at most', () => {
  const result = gaps([
    candidate('on-the-way', 0.5),
    candidate('near', 1.5),
    candidate('further', 3),
    candidate('far', 5),
  ]);

  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ afterItemId: 'morning', beforeItemId: 'evening' });
  expect(result[0]!.suggestions.map((s) => s.tripPlaceId)).toStrictEqual([
    'on-the-way',
    'near',
    'further',
  ]);
  expect(result[0]!.suggestions[0]!.startMinute).toBeGreaterThanOrEqual(11 * 60);
});

test('a place closed for the whole stretch is never offered; unknown hours say so', () => {
  const closed = candidate('closed', 0.5, {
    hours: {
      intervals: [{ endMinute: 10 * 60, startMinute: 8 * 60 }],
      source: 'CACHED_PROVIDER',
      status: 'KNOWN',
    },
  });
  const openLater = candidate('opens-at-three', 0.6, {
    hours: {
      intervals: [{ endMinute: 20 * 60, startMinute: 15 * 60 }],
      source: 'CACHED_PROVIDER',
      status: 'KNOWN',
    },
  });
  const unknown = candidate('unknown', 0.7);

  const [gap] = gaps([closed, openLater, unknown]);
  const byId = new Map(gap!.suggestions.map((s) => [s.tripPlaceId, s]));

  expect(byId.has('closed')).toBe(false);
  expect(byId.get('opens-at-three')).toMatchObject({ hoursUnknown: false, startMinute: 15 * 60 });
  expect(byId.get('opens-at-three')!.reasons).toContain('OPEN_THEN');
  expect(byId.get('unknown')!.hoursUnknown).toBe(true);
});

test('a place that suits the time of day or the trip’s interests says why', () => {
  const [gap] = gaps([candidate('museum', 0.5)], ['culture']);
  expect(gap!.suggestions[0]!.reasons).toContain('NEAR_ROUTE');
});

test('no stretch long enough, or a stop without a location, offers nothing', () => {
  const tight = [item('morning', 9 * 60, 120), item('evening', 11 * 60 + 30, 90)];
  expect(
    findDayGaps({
      calibration: {},
      candidates: [candidate('p', 0.5)],
      interests: [],
      items: tight,
      locate,
      mode: 'walk',
    }),
  ).toStrictEqual([]);
  expect(
    findDayGaps({
      calibration: {},
      candidates: [candidate('p', 0.5)],
      interests: [],
      items,
      locate: () => null,
      mode: 'walk',
    }),
  ).toStrictEqual([]);
});
