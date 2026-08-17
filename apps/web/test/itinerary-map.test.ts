import assert from 'node:assert/strict';
import { test } from 'vitest';

import { type ItineraryMapPoint, viewportPoints } from '../lib/maps/itinerary-map.ts';

function point(id: string, kind: ItineraryMapPoint['kind']): ItineraryMapPoint {
  return {
    id,
    itemId: null,
    kind,
    latitude: 35.7,
    longitude: 139.8,
    name: id,
    order: null,
    tripPlaceId: id,
  };
}

test('a considered Place far from the day never stretches the frame', () => {
  const points = [
    point('senso-ji', 'scheduled'),
    point('shinjuku', 'scheduled'),
    point('rotorua', 'considered'),
  ];

  assert.deepEqual(
    viewportPoints(points).map((entry) => entry.id),
    ['senso-ji', 'shinjuku'],
  );
});

test('the day base frames the day alongside its scheduled stops', () => {
  const points = [
    point('ryokan', 'base'),
    point('museum', 'scheduled'),
    point('far', 'considered'),
  ];

  assert.deepEqual(
    viewportPoints(points).map((entry) => entry.id),
    ['ryokan', 'museum'],
  );
});

test('a day with nothing located falls back to every point rather than framing nothing', () => {
  const points = [point('one', 'considered'), point('two', 'considered')];

  assert.deepEqual(
    viewportPoints(points).map((entry) => entry.id),
    ['one', 'two'],
  );
});

test('an empty map has nothing to frame', () => {
  assert.deepEqual(viewportPoints([]), []);
});
