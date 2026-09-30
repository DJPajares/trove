import { expect, test } from 'vitest';

import {
  evaluateRouteEfficiency,
  type PlanScoreDayItem,
} from '../src/services/plan-score-factors.js';
import { estimatedRouteComparison } from '../src/services/plan-score-route-comparison.js';

/** Stops along the equator, `km` east of the stay, so distances are easy to read. */
const at = (km: number) => ({ latitude: 0, longitude: km / 111.195 });
const places: Record<string, ReturnType<typeof at>> = {
  stay: at(0),
  near: at(2),
  mid: at(10),
  far: at(12),
};

type Point = { id: string; kind: 'daily_base' | 'itinerary_item' | 'starting_location' };
const stay: Point = { id: 'stay', kind: 'daily_base' };
const item = (id: string): Point => ({ id, kind: 'itinerary_item' });

/** A planned chain of local legs, each taking two minutes per kilometre. */
function chain(points: Point[], scope: 'local' | 'long_distance' = 'local') {
  return points.slice(1).map((destination, index) => {
    const origin = points[index]!;
    const km =
      Math.abs((places[origin.id]?.longitude ?? 0) - (places[destination.id]?.longitude ?? 0)) *
      111.195;
    return {
      id: `leg-${index}`,
      origin: { ...origin, label: null },
      destination: { ...destination, label: null },
      durationSeconds: km * 120,
      scope,
    };
  }) as never;
}

function flexible(id: string, overrides: Partial<PlanScoreDayItem> = {}): PlanScoreDayItem {
  return {
    duration: null,
    fixed: false,
    id,
    inboundTravel: null,
    openingHours: { status: 'UNKNOWN' },
    start: null,
    startWindow: null,
    ...overrides,
  };
}
const locate = (point: Point) => places[point.id] ?? null;

function compare(points: Point[], items: PlanScoreDayItem[], scope?: 'local' | 'long_distance') {
  const comparison = estimatedRouteComparison({ segments: chain(points, scope), items, locate });
  return comparison ? evaluateRouteEfficiency(comparison) : undefined;
}

const stops = ['mid', 'near', 'far'];
const allFlexible = stops.map((id) => flexible(id));

test('a zig-zag day from the stay and back is flagged against the order that avoids it', () => {
  // Stay → 10 km → back to 2 km → out to 12 km → stay: 40 km where 24 km would do.
  const result = compare([stay, ...stops.map(item), stay], allFlexible);
  expect(result?.plannedMinutes).toBeCloseTo(80);
  expect(result?.bestMinutes).toBeCloseTo(48);
  expect(result?.factor).toMatchObject({ state: 'EVALUATED', score: 40 });
  expect(result?.factor.state === 'EVALUATED' && result.factor.evidence[0]?.source).toBe(
    'ESTIMATED',
  );
});

test('a day already in its best order is not flagged', () => {
  const result = compare([stay, item('near'), item('mid'), item('far'), stay], allFlexible);
  expect(result?.plannedMinutes).toBeCloseTo(result?.bestMinutes ?? 0);
  expect(result?.factor).toMatchObject({ state: 'EVALUATED', score: 100 });
});

test('booked stops and stops at a chosen time keep their place', () => {
  const anchored = [
    flexible('mid', { fixed: true }),
    flexible('near', { start: { minutes: 600, source: 'USER_OWNED' } }),
    flexible('far'),
  ];
  // Only one stop may move, so there is no other order to compare with.
  expect(compare([stay, ...stops.map(item), stay], anchored)?.factor.state).toBe('UNKNOWN');
  // An estimated time moves with its stop.
  const estimated = [
    flexible('mid', { start: { minutes: 600, source: 'ESTIMATED' } }),
    flexible('near'),
    flexible('far'),
  ];
  expect(compare([stay, ...stops.map(item), stay], estimated)?.factor).toMatchObject({
    score: 40,
  });
});

test('without a stay the first and last stops hold the ends', () => {
  const result = compare(
    ['far', 'near', 'mid', 'stay'].map((id) => item(id)),
    [...allFlexible, flexible('stay')],
  );
  expect(result?.factor.state).toBe('EVALUATED');
});

test('an unknown location, a gap or a long-distance leg makes no comparison at all', () => {
  const unknown = { id: 'nowhere', kind: 'itinerary_item' } as const;
  expect(
    estimatedRouteComparison({
      segments: chain([stay, item('near'), unknown, item('far'), stay]),
      items: [...allFlexible, flexible('nowhere')],
      locate,
    }),
  ).toBeUndefined();
  expect(
    estimatedRouteComparison({
      segments: chain([stay, ...stops.map(item), stay], 'long_distance'),
      items: allFlexible,
      locate,
    }),
  ).toBeUndefined();
  const gap = chain([stay, ...stops.map(item), stay]) as unknown as Array<{
    origin: { id: string };
  }>;
  gap[2]!.origin.id = 'somewhere-else';
  expect(
    estimatedRouteComparison({ segments: gap as never, items: allFlexible, locate }),
  ).toBeUndefined();
});

test('a day-one starting location Trove cannot locate is trimmed, not fatal', () => {
  const start: Point = { id: 'home', kind: 'starting_location' };
  const comparison = estimatedRouteComparison({
    segments: chain([start, ...stops.map(item), stay]),
    items: allFlexible,
    locate,
  });
  expect(comparison?.stops).toHaveLength(4);
});
