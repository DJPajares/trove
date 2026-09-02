import { afterEach, expect, test } from 'vitest';

import { GooglePlacesProvider } from '../src/services/google-places.js';
import { GoogleRoutesProvider } from '../src/services/google-routes.js';
import { PlaceProviderError } from '../src/services/places.js';
import {
  AI_PLANNER_PROVIDER_CALL_LIMIT,
  ProviderCallBudget,
  resetProviderCallCounts,
  setProviderUsageSink,
  type ProviderUsageEvent,
} from '../src/services/provider-usage.js';
import { RouteProviderError } from '../src/services/routes.js';

afterEach(() => {
  resetProviderCallCounts();
  setProviderUsageSink(null);
});

test('the default planner budget admits exactly 50 concurrent outbound attempts', async () => {
  const budget = new ProviderCallBudget();
  let fetches = 0;
  const provider = new GooglePlacesProvider({
    apiKey: 'server-key',
    budget,
    fetcher: async () => {
      fetches += 1;
      await Promise.resolve();
      return Response.json({ places: [] });
    },
    source: 'ai-planner',
  });

  const results = await Promise.allSettled(
    Array.from({ length: AI_PLANNER_PROVIDER_CALL_LIMIT + 1 }, (_, index) =>
      provider.textSearch({ detail: 'location', textQuery: `Place ${index}` }),
    ),
  );

  expect(fetches).toBe(50);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(50);
  const rejection = results.find((result) => result.status === 'rejected');
  expect(rejection).toMatchObject({ reason: new PlaceProviderError('budget_exhausted') });
  expect(budget.snapshot()).toStrictEqual({ limit: 50, remaining: 0, used: 50 });
});

test('Places and Routes share one planner budget and emit safe AI usage metadata', async () => {
  const budget = new ProviderCallBudget(2);
  const events: ProviderUsageEvent[] = [];
  setProviderUsageSink((event) => events.push(event));
  const places = new GooglePlacesProvider({
    apiKey: 'server-key',
    budget,
    fetcher: async () => Response.json({ places: [] }),
    source: 'ai-planner',
  });
  const routes = new GoogleRoutesProvider({
    apiKey: 'server-key',
    budget,
    fetcher: async () => Response.json({ routes: [{ distanceMeters: 100, duration: '60s' }] }),
    source: 'ai-planner',
  });

  await places.textSearch({ detail: 'location', textQuery: 'secret traveller wording' });
  await routes.computeRoute({
    destination: { latitude: 1.31, longitude: 103.81 },
    mode: 'walk',
    origin: { latitude: 1.3, longitude: 103.8 },
  });
  await expect(
    places.getDetails({ detail: 'location', externalPlaceId: 'ChIJblocked' }),
  ).rejects.toThrow(new PlaceProviderError('budget_exhausted'));

  expect(events).toHaveLength(2);
  expect(events[0]).toMatchObject({
    endpoint: '/v1/places:searchText',
    expectedSku: 'places-text-search-pro',
    kind: 'outbound',
    operation: 'textSearch',
    source: 'ai-planner',
  });
  expect(JSON.stringify(events)).not.toContain('secret traveller wording');
});

test('failed outbound attempts count, while rejected local inputs do not', async () => {
  const budget = new ProviderCallBudget(1);
  let fetches = 0;
  const provider = new GooglePlacesProvider({
    apiKey: 'server-key',
    budget,
    fetcher: async () => {
      fetches += 1;
      throw new Error('network down');
    },
    source: 'ai-planner',
  });

  await expect(provider.textSearch({ detail: 'location', textQuery: '  ' })).rejects.toThrow(
    new PlaceProviderError('invalid_request'),
  );
  await expect(provider.textSearch({ detail: 'location', textQuery: 'Museum' })).rejects.toThrow(
    new PlaceProviderError('provider_unavailable'),
  );
  await expect(
    provider.textSearch({ detail: 'location', textQuery: 'Museum again' }),
  ).rejects.toThrow(new PlaceProviderError('budget_exhausted'));
  expect(fetches).toBe(1);
  expect(budget.snapshot().used).toBe(1);
});

test('Routes reports the same explicit budget exhaustion code', async () => {
  const provider = new GoogleRoutesProvider({
    apiKey: 'server-key',
    budget: new ProviderCallBudget(0),
    fetcher: async () => Response.json({ routes: [] }),
    source: 'ai-planner',
  });

  await expect(
    provider.computeRoute({
      destination: { latitude: 1, longitude: 1 },
      mode: 'drive',
      origin: { latitude: 0, longitude: 0 },
    }),
  ).rejects.toThrow(new RouteProviderError('budget_exhausted'));
});
