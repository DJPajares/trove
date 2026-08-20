import { expect, test } from 'vitest';

import { CurrencyProviderError, FrankfurterCurrencyProvider } from '../src/services/currency.js';

test('uses the Frankfurter v2 pair response without inventing a conversion endpoint', async () => {
  const provider = new FrankfurterCurrencyProvider({
    baseUrl: 'https://example.test',
    fetcher: async () =>
      Response.json({ base: 'NZD', date: '2026-08-12', quote: 'SGD', rate: 0.7482 }),
  });

  expect(await provider.getRate('nzd', 'sgd')).toStrictEqual({
    base: 'NZD',
    date: '2026-08-12',
    provider: 'frankfurter',
    quote: 'SGD',
    rate: 0.7482,
  });
});

test('keeps only valid provider currency metadata', async () => {
  const provider = new FrankfurterCurrencyProvider({
    baseUrl: 'https://example.test',
    fetcher: async () =>
      Response.json([
        { iso_code: 'nzd', name: 'New Zealand Dollar', symbol: '$' },
        { iso_code: 'broken', name: 'Broken currency' },
        { iso_code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
      ]),
  });

  expect(await provider.getCurrencies()).toStrictEqual([
    { code: 'NZD', name: 'New Zealand Dollar', symbol: '$' },
    { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
  ]);
});

test('surfaces provider failures without returning a made-up rate', async () => {
  const provider = new FrankfurterCurrencyProvider({
    baseUrl: 'https://example.test',
    fetcher: async () => new Response(null, { status: 503 }),
  });

  await expect(provider.getRate('NZD', 'SGD')).rejects.toSatisfy(
    (error: unknown) =>
      error instanceof CurrencyProviderError && error.code === 'provider_unavailable',
  );
});
