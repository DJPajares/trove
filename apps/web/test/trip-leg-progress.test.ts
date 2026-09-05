import { expect, test } from 'vitest';

import { legProgressFraction } from '../lib/itinerary/leg-progress.ts';
import { haversineMeters } from '../lib/maps/haversine.ts';

const OSAKA = { latitude: 34.6937, longitude: 135.5023 };
const KYOTO = { latitude: 35.0116, longitude: 135.7681 };

test('a known distance is measured to within a percent', () => {
  // Osaka to Kyoto is a little over 40 km as the crow flies.
  expect(haversineMeters(OSAKA, KYOTO)).toBeGreaterThan(40_000);
  expect(haversineMeters(OSAKA, KYOTO)).toBeLessThan(43_000);
});

test('distance is symmetric, and a point is no distance from itself', () => {
  expect(haversineMeters(OSAKA, KYOTO)).toBeCloseTo(haversineMeters(KYOTO, OSAKA));
  expect(haversineMeters(OSAKA, OSAKA)).toBe(0);
});

test('standing at either end reads as nought or done', () => {
  expect(legProgressFraction(OSAKA, KYOTO, OSAKA)).toBe(0);
  expect(legProgressFraction(OSAKA, KYOTO, KYOTO)).toBe(1);
});

test('the midpoint reads as roughly half way', () => {
  const midpoint = {
    latitude: (OSAKA.latitude + KYOTO.latitude) / 2,
    longitude: (OSAKA.longitude + KYOTO.longitude) / 2,
  };

  expect(legProgressFraction(OSAKA, KYOTO, midpoint)).toBeCloseTo(0.5, 2);
});

test('walking a little past the stop still reads as nearly arrived', () => {
  // A kilometre beyond Kyoto, on the far side from Osaka.
  const past = { latitude: 35.0206, longitude: 135.7757 };

  expect(legProgressFraction(OSAKA, KYOTO, past)).toBeGreaterThan(0.95);
  expect(legProgressFraction(OSAKA, KYOTO, past)).toBeLessThan(1);
});

test('being further from the stop than the leg is long clamps to the start', () => {
  const singapore = { latitude: 1.3521, longitude: 103.8198 };

  expect(legProgressFraction(OSAKA, KYOTO, singapore)).toBe(0);
});

test('a zero-length leg reads as arrived rather than dividing by zero', () => {
  const fraction = legProgressFraction(OSAKA, OSAKA, KYOTO);

  expect(fraction).toBe(1);
  expect(Number.isNaN(fraction)).toBe(false);
});
