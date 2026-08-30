import { expect, test } from 'vitest';

import { deriveRateFromBoard, type CachedCurrencyRateBoard } from '../lib/currency/api';

const board: CachedCurrencyRateBoard = {
  base: 'EUR',
  date: '2026-08-28',
  fetchedAt: '2026-08-28T06:00:00.000Z',
  provider: 'frankfurter',
  rates: {
    GBP: { date: '2026-08-27', rate: 0.85 },
    JPY: { date: '2026-08-28', rate: 170 },
    SGD: { date: '2026-08-28', rate: 1.4 },
    USD: { date: '2026-08-28', rate: 1.16 },
  },
  source: 'cache',
};

test('derives a pair the device has never converted from the stored board', () => {
  expect(deriveRateFromBoard(board, 'sgd', 'jpy')).toStrictEqual({
    base: 'SGD',
    date: '2026-08-28',
    fetchedAt: '2026-08-28T06:00:00.000Z',
    provider: 'frankfurter',
    quote: 'JPY',
    rate: 170 / 1.4,
    source: 'cache',
  });
});

test('treats the board base as one and inverts cleanly', () => {
  expect(deriveRateFromBoard(board, 'EUR', 'USD')?.rate).toBe(1.16);
  expect(deriveRateFromBoard(board, 'USD', 'EUR')?.rate).toBe(1 / 1.16);

  const forward = deriveRateFromBoard(board, 'USD', 'JPY')?.rate;
  const back = deriveRateFromBoard(board, 'JPY', 'USD')?.rate;

  expect(forward).toBeDefined();
  expect(back).toBeDefined();
  expect(forward! * back!).toBeCloseTo(1, 12);
});

test('reports the older of the two publication dates in a pair', () => {
  expect(deriveRateFromBoard(board, 'GBP', 'USD')?.date).toBe('2026-08-27');
  expect(deriveRateFromBoard(board, 'SGD', 'USD')?.date).toBe('2026-08-28');
});

test('refuses a currency the board does not carry rather than guessing', () => {
  expect(deriveRateFromBoard(board, 'USD', 'ZZZ')).toBeNull();
  expect(deriveRateFromBoard(board, 'ZZZ', 'USD')).toBeNull();
});

test('keeps the freshness of the board it was derived from', () => {
  const live = deriveRateFromBoard({ ...board, source: 'live' }, 'USD', 'SGD');

  expect(live?.source).toBe('live');
  expect(deriveRateFromBoard(board, 'USD', 'SGD')?.source).toBe('cache');
});
