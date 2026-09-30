import { expect, test } from 'vitest';

import { providerSearchBody, type ProviderSearchResult } from '@/lib/saved/api';
import {
  createProviderSearchSession,
  destinationLocationBias,
  MIN_PROVIDER_SEARCH_LENGTH,
  searchableProviderQuery,
} from '@/lib/saved/provider-search-session';

const ok: ProviderSearchResult = { sessionToken: 'server', status: 'ok', suggestions: [] };

test('a search is only worth asking for from three characters', () => {
  expect(MIN_PROVIDER_SEARCH_LENGTH).toBe(3);
  expect(searchableProviderQuery('ky')).toBeNull();
  expect(searchableProviderQuery('  ky  ')).toBeNull();
  expect(searchableProviderQuery('   ')).toBeNull();
  expect(searchableProviderQuery('  kyo ')).toBe('kyo');
});

test('every search in a session shares one token until a place is chosen', () => {
  let issued = 0;
  const session = createProviderSearchSession(() => `token-${(issued += 1)}`);

  expect(session.peekToken()).toBeUndefined();
  const first = session.token();
  expect(session.token()).toBe(first);
  expect(session.peekToken()).toBe(first);

  session.end();
  expect(session.peekToken()).toBeUndefined();
  expect(session.token()).not.toBe(first);
});

test('the default token satisfies the API schema', () => {
  const token = createProviderSearchSession().token();
  expect(token).toMatch(/^[A-Za-z0-9_-]{1,36}$/);
});

test('asking again for the same text is answered without a request', () => {
  const session = createProviderSearchSession();
  expect(session.cached('Kyoto Station')).toBeUndefined();

  session.remember('Kyoto Station', ok);
  expect(session.cached('  kyoto station ')).toBe(ok);
});

test('an outage is not remembered, so it is tried again', () => {
  const session = createProviderSearchSession();
  session.remember('kyoto', { sessionToken: 's', status: 'unavailable' });
  expect(session.cached('kyoto')).toBeUndefined();
});

test('ending the session forgets what it was told', () => {
  const session = createProviderSearchSession();
  session.remember('kyoto', ok);
  session.end();
  expect(session.cached('kyoto')).toBeUndefined();
});

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
