import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { getProviderCallCounts, resetProviderCallCounts } from '../src/services/provider-usage.js';
import { resolvePlaceName } from '../src/services/reverse-geocode.js';

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

beforeEach(() => {
  resetProviderCallCounts();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

test('coordinates resolve to the settlement a traveller would name', async () => {
  // The bug this exists for: Whangarei sits in Pacific/Auckland, so every name
  // derived from the zone called it Auckland.
  globalThis.fetch = vi.fn(async () =>
    jsonResponse({ city: 'Whangarei', locality: 'Whangarei', principalSubdivision: 'Northland' }),
  ) as unknown as typeof fetch;

  await expect(resolvePlaceName(-35.7251, 174.3237)).resolves.toBe('Whangarei');
});

test('a nearby request reuses the answer rather than asking again', async () => {
  const fetcher = vi.fn(async () => jsonResponse({ locality: 'Auckland' }));
  globalThis.fetch = fetcher as unknown as typeof fetch;

  await resolvePlaceName(-36.8485, 174.7633);
  // Metres away, which is the same city and must not be a second request. The
  // provider bills nothing, but a per-render fan-out is the shape AGENTS.md
  // warns about whatever it costs.
  await resolvePlaceName(-36.8486, 174.7634);

  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(getProviderCallCounts()['big_data_cloud:search']).toBe(1);
});

test('a large city is named by its city, not by the borough inside it', async () => {
  // Checked against the provider: Auckland answers `locality: "Waitemata"`,
  // Boston `"Downtown Boston"`. Neither is what a traveller would say when
  // asked where they are.
  globalThis.fetch = vi.fn(async () =>
    jsonResponse({ city: 'Auckland', locality: 'Waitemata', principalSubdivision: 'Auckland' }),
  ) as unknown as typeof fetch;

  await expect(resolvePlaceName(-36.8485, 174.7633)).resolves.toBe('Auckland');
});

test('the settlement, then the region, stand in where there is no city', async () => {
  globalThis.fetch = vi.fn(async () =>
    jsonResponse({ city: '', locality: 'Hokitika', principalSubdivision: 'West Coast' }),
  ) as unknown as typeof fetch;
  await expect(resolvePlaceName(-42.7, 170.9)).resolves.toBe('Hokitika');

  globalThis.fetch = vi.fn(async () =>
    jsonResponse({ city: '', locality: '', principalSubdivision: 'Otago' }),
  ) as unknown as typeof fetch;
  await expect(resolvePlaceName(-45.1, 169.2)).resolves.toBe('Otago');
});

test('a name that does not arrive is no name, and is not remembered as one', async () => {
  const fetcher = vi.fn(async () => {
    throw new Error('offline');
  });
  globalThis.fetch = fetcher as unknown as typeof fetch;

  // Null rather than a guess: PRD 21.1 forbids fabricating a physical location.
  await expect(resolvePlaceName(51.5, -0.13)).resolves.toBeNull();
  // And a network blip must not be cached for the life of the process.
  await resolvePlaceName(51.5, -0.13);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
