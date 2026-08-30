import { expect, test } from 'vitest';

import {
  CachedCurrencyService,
  deriveRateFromBoard,
  type CachedCurrencyRateBoard,
  type CurrencyStore,
} from '../src/services/cached-currency.js';
import { CurrencyProviderError, type CurrencyProvider } from '../src/services/currency.js';

const BOARD = {
  GBP: { date: '2026-08-27', rate: 0.85 },
  JPY: { date: '2026-08-28', rate: 170 },
  SGD: { date: '2026-08-28', rate: 1.4 },
  USD: { date: '2026-08-28', rate: 1.16 },
};

function createProvider(overrides: Partial<CurrencyProvider> = {}) {
  const calls = { getCurrencies: 0, getRateBoard: 0 };

  const provider: CurrencyProvider = {
    async getCurrencies() {
      calls.getCurrencies += 1;
      return [{ code: 'USD', name: 'United States Dollar', symbol: '$' }];
    },
    async getRate() {
      throw new Error('the cached service must not use the per-pair endpoint');
    },
    async getRateBoard(base: string) {
      calls.getRateBoard += 1;
      return { base, date: '2026-08-28', provider: 'frankfurter' as const, rates: BOARD };
    },
    ...overrides,
  };

  return { calls, provider };
}

/** An in-memory stand-in for the Prisma store, with the same swallow-failures contract. */
function createStore(seed: Partial<Record<'board', CachedCurrencyRateBoard>> = {}) {
  const state: { board: CachedCurrencyRateBoard | null; writes: number } = {
    board: seed.board ?? null,
    writes: 0,
  };

  const store: CurrencyStore = {
    async readBoard() {
      return state.board;
    },
    async readCurrencies() {
      return null;
    },
    async writeBoard(board, fetchedAt) {
      state.writes += 1;
      state.board = { ...board, fetchedAt: fetchedAt.toISOString(), source: 'cache' };
    },
    async writeCurrencies() {},
  };

  return { state, store };
}

function storedBoard(fetchedAt: string): CachedCurrencyRateBoard {
  return {
    base: 'EUR',
    date: '2026-08-27',
    fetchedAt,
    provider: 'frankfurter',
    rates: BOARD,
    source: 'cache',
  };
}

test('a cold board costs one provider call and is stored for everyone after it', async () => {
  const { calls, provider } = createProvider();
  const { state, store } = createStore();
  const service = new CachedCurrencyService(
    provider,
    store,
    () => new Date('2026-08-28T09:00:00Z'),
  );

  const board = await service.getRateBoard();

  expect(calls.getRateBoard).toBe(1);
  expect(state.writes).toBe(1);
  expect(board.base).toBe('EUR');
  expect(board.source).toBe('live');
});

test('a snapshot from earlier the same day costs nothing', async () => {
  const { calls, provider } = createProvider();
  const { store } = createStore({ board: storedBoard('2026-08-28T06:00:00.000Z') });
  const service = new CachedCurrencyService(
    provider,
    store,
    () => new Date('2026-08-28T23:00:00Z'),
  );

  const board = await service.getRateBoard();

  expect(calls.getRateBoard).toBe(0);
  expect(board.source).toBe('cache');
});

test('a snapshot older than a day is refetched', async () => {
  const { calls, provider } = createProvider();
  const { store } = createStore({ board: storedBoard('2026-08-26T06:00:00.000Z') });
  const service = new CachedCurrencyService(
    provider,
    store,
    () => new Date('2026-08-28T09:00:00Z'),
  );

  expect((await service.getRateBoard()).source).toBe('live');
  expect(calls.getRateBoard).toBe(1);
});

test('concurrent misses collapse into a single provider call', async () => {
  const { calls, provider } = createProvider();
  const { store } = createStore();
  const service = new CachedCurrencyService(
    provider,
    store,
    () => new Date('2026-08-28T09:00:00Z'),
  );

  await Promise.all(Array.from({ length: 8 }, () => service.getRateBoard()));

  expect(calls.getRateBoard).toBe(1);
});

test('a provider outage serves the last snapshot rather than failing', async () => {
  const { provider } = createProvider({
    getRateBoard: async () => {
      throw new CurrencyProviderError('provider_unavailable');
    },
  });
  const { store } = createStore({ board: storedBoard('2026-08-20T06:00:00.000Z') });
  const service = new CachedCurrencyService(
    provider,
    store,
    () => new Date('2026-08-28T09:00:00Z'),
  );

  const board = await service.getRateBoard();

  expect(board.source).toBe('cache');
  expect(board.date).toBe('2026-08-27');
});

test('a provider outage with nothing stored surfaces the failure', async () => {
  const { provider } = createProvider({
    getRateBoard: async () => {
      throw new CurrencyProviderError('provider_unavailable');
    },
  });
  const { store } = createStore();
  const service = new CachedCurrencyService(
    provider,
    store,
    () => new Date('2026-08-28T09:00:00Z'),
  );

  await expect(service.getRateBoard()).rejects.toBeInstanceOf(CurrencyProviderError);
});

test('a store that cannot answer degrades to a provider call instead of erroring', async () => {
  const { calls, provider } = createProvider();
  const store: CurrencyStore = {
    async readBoard() {
      return null;
    },
    async readCurrencies() {
      return null;
    },
    async writeBoard() {},
    async writeCurrencies() {},
  };
  const service = new CachedCurrencyService(
    provider,
    store,
    () => new Date('2026-08-28T09:00:00Z'),
  );

  expect((await service.getRateBoard()).source).toBe('live');
  expect(calls.getRateBoard).toBe(1);
});

test('a pair the provider was never asked for is derived from the board', async () => {
  const { calls, provider } = createProvider();
  const { store } = createStore();
  const service = new CachedCurrencyService(
    provider,
    store,
    () => new Date('2026-08-28T09:00:00Z'),
  );

  const rate = await service.getRate('sgd', 'jpy');

  expect(rate).toStrictEqual({
    base: 'SGD',
    date: '2026-08-28',
    provider: 'frankfurter',
    quote: 'JPY',
    rate: 170 / 1.4,
  });
  expect(calls.getRateBoard).toBe(1);
});

test('an unknown currency is rejected rather than converted at a guessed rate', async () => {
  const { provider } = createProvider();
  const { store } = createStore();
  const service = new CachedCurrencyService(
    provider,
    store,
    () => new Date('2026-08-28T09:00:00Z'),
  );

  await expect(service.getRate('USD', 'ZZZ')).rejects.toBeInstanceOf(CurrencyProviderError);
  await expect(service.getRate('US', 'SGD')).rejects.toBeInstanceOf(CurrencyProviderError);
});

test('cross rates invert cleanly and treat the board base as one', () => {
  const board = { base: 'EUR', date: '2026-08-28', rates: BOARD };

  expect(deriveRateFromBoard(board, 'EUR', 'USD')?.rate).toBe(1.16);
  expect(deriveRateFromBoard(board, 'USD', 'EUR')?.rate).toBe(1 / 1.16);
  expect(deriveRateFromBoard(board, 'USD', 'USD')?.rate).toBe(1);

  const forward = deriveRateFromBoard(board, 'SGD', 'JPY')?.rate;
  const back = deriveRateFromBoard(board, 'JPY', 'SGD')?.rate;

  expect(forward).toBeDefined();
  expect(back).toBeDefined();
  expect(forward! * back!).toBeCloseTo(1, 12);
  expect(deriveRateFromBoard(board, 'SGD', 'ZZZ')).toBeNull();
});

test('a pair reports the older of its two publication dates', () => {
  const board = { base: 'EUR', date: '2026-08-28', rates: BOARD };

  // GBP was last published a day before the rest of the board, so a pair that
  // depends on it must not claim to be as current as the board.
  expect(deriveRateFromBoard(board, 'GBP', 'USD')?.date).toBe('2026-08-27');
  expect(deriveRateFromBoard(board, 'EUR', 'GBP')?.date).toBe('2026-08-27');
  expect(deriveRateFromBoard(board, 'SGD', 'USD')?.date).toBe('2026-08-28');
});
