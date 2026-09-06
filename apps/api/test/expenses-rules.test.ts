import { expect, test } from 'vitest';

import {
  preferExplicitLocalDate,
  projectedCostTotals,
  resolveExpenseTimeZone,
  totalByCurrency,
} from '../src/services/expenses-rules.js';

const money = (amount: string) => ({ toFixed: () => amount });

test('keeps expense timezone resolution stable and contextual', () => {
  expect(
    resolveExpenseTimeZone({
      itineraryDayTimeZone: 'Asia/Singapore',
      itineraryItemTimeZone: 'Pacific/Auckland',
      tripPlaceTimeZone: 'Europe/London',
      tripTimeZone: 'UTC',
    }),
  ).toStrictEqual({ source: 'ITINERARY_ITEM', timeZone: 'Pacific/Auckland' });
  expect(
    resolveExpenseTimeZone({
      itineraryDayTimeZone: 'Asia/Singapore',
      itineraryItemTimeZone: null,
      tripPlaceTimeZone: null,
      tripTimeZone: 'UTC',
    }),
  ).toStrictEqual({ source: 'ITINERARY_DAY', timeZone: 'Asia/Singapore' });
});

test("an explicit expense date always wins over a linked item's own day", () => {
  expect(preferExplicitLocalDate('2026-09-10', '2026-09-05')).toBe('2026-09-10');
});

test("a scheduled item's day carries over when the expense named no date of its own", () => {
  expect(preferExplicitLocalDate(null, '2026-09-05')).toBe('2026-09-05');
});

test('an expense with neither an explicit date nor a scheduled item stays dateless', () => {
  expect(preferExplicitLocalDate(null, null)).toBeNull();
});

test('groups actual spend by original currency without conversion', () => {
  expect(
    totalByCurrency([
      { amount: money('12.50'), currencyCode: 'sgd' },
      { amount: money('7.25'), currencyCode: 'SGD' },
      { amount: money('20.00'), currencyCode: 'USD' },
    ]),
  ).toStrictEqual([
    { amount: '19.75', currencyCode: 'SGD' },
    { amount: '20.00', currencyCode: 'USD' },
  ]);
});

test('uses a linked reservation planned cost instead of its itinerary item cost', () => {
  expect(
    projectedCostTotals({
      itineraryItems: [
        { id: 'item-linked', plannedCostAmount: money('100.00'), plannedCostCurrencyCode: 'USD' },
        { id: 'item-unlinked', plannedCostAmount: money('25.00'), plannedCostCurrencyCode: 'USD' },
      ],
      reservations: [
        {
          itineraryItemId: 'item-linked',
          plannedCostAmount: money('120.00'),
          plannedCostCurrencyCode: 'USD',
        },
      ],
    }),
  ).toStrictEqual([{ amount: '145.00', currencyCode: 'USD' }]);
});

test('does not suppress an itinerary planned cost for a linked reservation without a cost', () => {
  expect(
    projectedCostTotals({
      itineraryItems: [
        { id: 'item-linked', plannedCostAmount: money('100.00'), plannedCostCurrencyCode: 'USD' },
      ],
      reservations: [
        { itineraryItemId: 'item-linked', plannedCostAmount: null, plannedCostCurrencyCode: null },
      ],
    }),
  ).toStrictEqual([{ amount: '100.00', currencyCode: 'USD' }]);
});
