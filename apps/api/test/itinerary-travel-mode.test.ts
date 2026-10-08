import { expect, test } from 'vitest';

import { mapTravelMode } from '../src/services/itineraries.js';

test('every stored travel mode keeps its own name in the itinerary', () => {
  expect(mapTravelMode('DRIVE')).toBe('drive');
  expect(mapTravelMode('FLIGHT')).toBe('flight');
  expect(mapTravelMode('TRANSIT')).toBe('transit');
  expect(mapTravelMode('WALK')).toBe('walk');
});
