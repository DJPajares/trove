import { expect, test } from 'vitest';

import type { ItineraryRouteSegment } from '../lib/itinerary/api.ts';
import { dayRouteDrawing, type DaySketchPlace } from '../lib/itinerary/day-sketch.ts';
import { decodePolyline } from '../lib/maps/polyline.ts';

const BOX = { height: 80, padding: 11, width: 128 };

function place(
  key: string,
  latitude: number,
  longitude: number,
  extra: Partial<DaySketchPlace> = {},
): DaySketchPlace {
  return { key, kind: 'stop', latitude, longitude, number: 1, previousKey: null, ...extra };
}

function leg(overrides: Partial<ItineraryRouteSegment> = {}): ItineraryRouteSegment {
  return {
    destination: { id: 'b', kind: 'itinerary_item', label: null },
    distanceMeters: 1200,
    durationSeconds: 600,
    encodedPolyline: null,
    id: 'leg',
    mode: 'drive',
    modeOwner: { id: 'a', kind: 'item_departure' },
    origin: { id: 'a', kind: 'itinerary_item', label: null },
    provider: 'google',
    reason: null,
    scope: 'local',
    status: 'ok',
    ...overrides,
  };
}

test('decodes an encoded polyline into the points it passes through', () => {
  expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
    { latitude: 38.5, longitude: -120.2 },
    { latitude: 40.7, longitude: -120.95 },
    { latitude: 43.252, longitude: -126.453 },
  ]);
  expect(decodePolyline('')).toEqual([]);
});

test('a day whose legs are not known is one smoothed line through its stops', () => {
  const drawing = dayRouteDrawing([place('a', 1.3, 103.8), place('b', 1.31, 103.85)], BOX);
  expect(drawing?.legs).toHaveLength(1);
  expect(drawing?.legs[0]?.key).toBe('shape');
});

test('each leg says how much is known about it', () => {
  const drawing = dayRouteDrawing(
    [
      place('stay-arrival', 1.29, 103.85, { incoming: null, kind: 'stay' }),
      // Measured, with the road already on hand.
      place('a', 1.3, 103.8, {
        incoming: leg({ encodedPolyline: '_ulGaxyxRoR?oR?' }),
        previousKey: 'stay-arrival',
      }),
      // Measured, without a road.
      place('b', 1.31, 103.85, { incoming: leg(), previousKey: 'a' }),
      // An unlocated stop came between: nothing measured this pair.
      place('c', 1.33, 103.9, { incoming: leg(), previousKey: 'unlocated' }),
      // Measured, but never routed.
      place('d', 1.35, 103.95, {
        incoming: leg({ status: 'unavailable' }),
        previousKey: 'c',
      }),
    ],
    BOX,
  );

  expect(drawing?.legs.map((entry) => [entry.style, entry.stay])).toEqual([
    ['road', true],
    ['straight', false],
    ['unknown', false],
    ['unknown', false],
  ]);
  expect(drawing?.points).toHaveLength(5);
});

test('one located place draws nothing to connect', () => {
  expect(dayRouteDrawing([place('a', 1.3, 103.8, { incoming: null })], BOX)).toBeNull();
});
