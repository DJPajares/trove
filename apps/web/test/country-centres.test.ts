import { COUNTRY_CODES } from '@trove/types/countries';
import { expect, test } from 'vitest';

import { COUNTRY_CENTRES } from '@/lib/profile/country-centres';

test('every country Trove knows has a centre on the map', () => {
  const missing = COUNTRY_CODES.filter((code) => !COUNTRY_CENTRES[code]);
  expect(missing).toEqual([]);
});

test('every centre is a real latitude and longitude', () => {
  for (const [code, [latitude, longitude]] of Object.entries(COUNTRY_CENTRES)) {
    expect(Math.abs(latitude), code).toBeLessThanOrEqual(90);
    expect(Math.abs(longitude), code).toBeLessThanOrEqual(180);
  }
});
