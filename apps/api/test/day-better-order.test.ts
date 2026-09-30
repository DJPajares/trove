import { expect, test } from 'vitest';

import { reorderedRecord } from '../src/services/day-better-order.js';

const segment = (
  from: string,
  to: string,
  fromKind = 'itinerary_item',
  toKind = 'itinerary_item',
) => ({
  destination: { id: to, kind: toKind, label: null },
  distanceMeters: 1000,
  durationSeconds: 600,
  encodedPolyline: null,
  id: `${from}>${to}`,
  mode: 'walk',
  modeOwner: { id: from, kind: 'item_departure' },
  origin: { id: from, kind: fromKind, label: null },
  provider: 'google',
  reason: null,
  scope: 'local',
  status: 'ok',
});

const day = {
  id: 'day',
  items: [{ id: 'c' }, { id: 'a' }, { id: 'b' }],
} as never;

const record = {
  routes: new Map([
    [
      'day',
      {
        segments: [
          segment('base', 'c', 'daily_base'),
          segment('c', 'a'),
          segment('a', 'b'),
          segment('b', 'base', 'itinerary_item', 'daily_base'),
        ],
      },
    ],
  ]),
} as never;

test('the reordered day keeps its base at both ends and re-chains its legs', () => {
  const next = reorderedRecord(day, record, ['a', 'b', 'c']);
  const segments = (
    next.record as unknown as { routes: Map<string, { segments: ReturnType<typeof segment>[] }> }
  ).routes.get('day')!.segments;

  expect(
    (next.day as unknown as { items: { id: string }[] }).items.map((item) => item.id),
  ).toStrictEqual(['a', 'b', 'c']);
  expect(segments.map((leg) => `${leg.origin.id}>${leg.destination.id}`)).toStrictEqual([
    'base>a',
    'a>b',
    'b>c',
    'c>base',
  ]);
  // A leg that was already measured keeps its measurement; a new one is left
  // unmeasured for Plan Score's own estimate, never bought.
  expect(segments[1]!.durationSeconds).toBe(600);
  expect(segments[0]!.durationSeconds).toBeNull();
  expect(segments[0]!.provider).toBeNull();
});
