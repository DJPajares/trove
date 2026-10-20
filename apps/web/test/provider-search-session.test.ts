import { expect, test } from 'vitest';

import { providerSearchBody } from '@/lib/saved/api';
import { destinationLocationBias } from '@/lib/saved/provider-search-session';

test('the request carries the session token and bias only when there are some', () => {
  expect(JSON.parse(providerSearchBody('kyoto'))).toStrictEqual({ input: 'kyoto' });
  expect(
    JSON.parse(
      providerSearchBody('kyoto', {
        locationBias: { latitude: 35, longitude: 135, radiusMeters: 50_000 },
        sessionToken: 'abc',
      }),
    ),
  ).toStrictEqual({
    input: 'kyoto',
    locationBias: { latitude: 35, longitude: 135, radiusMeters: 50_000 },
    sessionToken: 'abc',
  });
});

test('results are preferred around the first destination Trove can place', () => {
  expect(destinationLocationBias([])).toBeNull();
  expect(destinationLocationBias([{ location: null }, {}])).toBeNull();
  expect(
    destinationLocationBias([
      { location: null },
      { location: { latitude: 35.01, longitude: 135.77 } },
      { location: { latitude: 1, longitude: 2 } },
    ]),
  ).toStrictEqual({ latitude: 35.01, longitude: 135.77, radiusMeters: 50_000 });
});
