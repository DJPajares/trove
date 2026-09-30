import { expect, test } from 'vitest';

import {
  ALTERNATIVES_PER_STOP,
  indoorAlternativesFor,
  isIndoorVisit,
  MAX_ALTERNATIVE_KM,
  type IndoorCandidate,
} from '../src/services/rain-alternatives-rules.js';

const at = (km: number) => ({ latitude: 0, longitude: km / 111.32 });
const candidate = (
  id: string,
  km: number,
  overrides: Partial<IndoorCandidate> = {},
): IndoorCandidate => ({
  closedThatDay: false,
  coordinates: at(km),
  hoursUnknown: false,
  rating: null,
  tripPlaceId: id,
  types: ['museum'],
  ...overrides,
});

test('museums count as indoor visits; parks, unknown kinds and transport do not', () => {
  expect(isIndoorVisit(['museum'])).toBe(true);
  expect(isIndoorVisit(['park'])).toBe(false);
  expect(isIndoorVisit(['hiking_area'])).toBe(false);
  expect(isIndoorVisit(['something_unheard_of'])).toBe(false);
  expect(isIndoorVisit(['airport'])).toBe(false);
});

test('the nearest indoor places come first, three at most', () => {
  const result = indoorAlternativesFor(at(0), [
    candidate('far', 4),
    candidate('near', 0.5),
    candidate('middle', 2),
    candidate('mid-two', 3),
  ]);
  expect(result.map((entry) => entry.tripPlaceId)).toStrictEqual(['near', 'middle', 'mid-two']);
  expect(result).toHaveLength(ALTERNATIVES_PER_STOP);
});

test('closed, outdoor, too far, or unlocated places are never offered', () => {
  const result = indoorAlternativesFor(at(0), [
    candidate('closed', 0.5, { closedThatDay: true }),
    candidate('park', 0.5, { types: ['park'] }),
    candidate('too-far', MAX_ALTERNATIVE_KM + 1),
    candidate('nowhere', 0, { coordinates: null }),
    candidate('ok', 1),
  ]);
  expect(result.map((entry) => entry.tripPlaceId)).toStrictEqual(['ok']);
});

test('unknown hours say so and rank slightly behind known ones at the same distance', () => {
  const result = indoorAlternativesFor(at(0), [
    candidate('unknown', 1, { hoursUnknown: true }),
    candidate('known', 1),
  ]);
  expect(result.map((entry) => entry.tripPlaceId)).toStrictEqual(['known', 'unknown']);
  expect(result[1]!.hoursUnknown).toBe(true);
});

test('a stop with nowhere known gets nothing', () => {
  expect(indoorAlternativesFor(null, [candidate('p', 1)])).toStrictEqual([]);
});
