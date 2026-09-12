import { expect, test } from 'vitest';

import { cityFromTimeZone } from '../lib/home/here.ts';

test('a zone names the city it is named after', () => {
  expect(cityFromTimeZone('Pacific/Auckland')).toBe('Auckland');
  expect(cityFromTimeZone('Asia/Tokyo')).toBe('Tokyo');
});

test('underscores in a zone stand in for spaces', () => {
  expect(cityFromTimeZone('America/New_York')).toBe('New York');
  expect(cityFromTimeZone('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
});

/**
 * A zone with no region in front of it names no place - it is an offset, and
 * labelling the weather "UTC" would be worse than labelling it nothing.
 */
test('a zone with no city in it names none', () => {
  expect(cityFromTimeZone('UTC')).toBeNull();
  expect(cityFromTimeZone('GMT')).toBeNull();
  expect(cityFromTimeZone(undefined)).toBeNull();
  expect(cityFromTimeZone('')).toBeNull();
});
