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

test('reads the whole daily board from one rates request', async () => {
  const requested: string[] = [];
  const provider = new FrankfurterCurrencyProvider({
    baseUrl: 'https://example.test',
    fetcher: async (input) => {
      requested.push(String(input));
      return Response.json([
        { base: 'EUR', date: '2026-08-27', quote: 'GBP', rate: 0.85 },
        { base: 'EUR', date: '2026-08-28', quote: 'SGD', rate: 1.4 },
        { base: 'EUR', date: '2026-08-28', quote: 'broken', rate: 2 },
        { base: 'EUR', date: '2026-08-28', quote: 'USD', rate: 'not a rate' },
        { base: 'EUR', date: '2026-08-28', quote: 'ZAR', rate: -1 },
        { base: 'USD', date: '2026-08-28', quote: 'CHF', rate: 0.8 },
      ]);
    },
  });

  expect(await provider.getRateBoard('eur')).toStrictEqual({
    base: 'EUR',
    date: '2026-08-28',
    provider: 'frankfurter',
    rates: {
      GBP: { date: '2026-08-27', rate: 0.85 },
      SGD: { date: '2026-08-28', rate: 1.4 },
    },
  });
  expect(requested).toStrictEqual(['https://example.test/v2/rates?base=EUR']);
});

test('refuses a board whose base is not the one that was asked for', async () => {
  const provider = new FrankfurterCurrencyProvider({
    baseUrl: 'https://example.test',
    fetcher: async () =>
      Response.json([{ base: 'USD', date: '2026-08-28', quote: 'SGD', rate: 1.4 }]),
  });

  await expect(provider.getRateBoard('EUR')).rejects.toSatisfy(
    (error: unknown) => error instanceof CurrencyProviderError && error.code === 'invalid_response',
  );
});

test('refuses a board with no usable rates rather than caching an empty day', async () => {
  const provider = new FrankfurterCurrencyProvider({
    baseUrl: 'https://example.test',
    fetcher: async () =>
      Response.json([{ base: 'EUR', date: '2026-08-28', quote: 'USD', rate: 0 }]),
  });

  await expect(provider.getRateBoard('EUR')).rejects.toSatisfy(
    (error: unknown) => error instanceof CurrencyProviderError && error.code === 'invalid_response',
  );
});
