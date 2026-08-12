import assert from 'node:assert/strict';
import test from 'node:test';

import {
  projectedCostTotals,
  resolveExpenseTimeZone,
  totalByCurrency,
} from '../src/services/expenses-rules.js';

const money = (amount: string) => ({ toFixed: () => amount });

test('keeps expense timezone resolution stable and contextual', () => {
  assert.deepEqual(
    resolveExpenseTimeZone({
      itineraryDayTimeZone: 'Asia/Singapore',
      itineraryItemTimeZone: 'Pacific/Auckland',
      tripPlaceTimeZone: 'Europe/London',
      tripTimeZone: 'UTC',
    }),
    { source: 'ITINERARY_ITEM', timeZone: 'Pacific/Auckland' },
  );
  assert.deepEqual(
    resolveExpenseTimeZone({
      itineraryDayTimeZone: 'Asia/Singapore',
      itineraryItemTimeZone: null,
      tripPlaceTimeZone: null,
      tripTimeZone: 'UTC',
    }),
    { source: 'ITINERARY_DAY', timeZone: 'Asia/Singapore' },
  );
});

test('groups actual spend by original currency without conversion', () => {
  assert.deepEqual(
    totalByCurrency([
      { amount: money('12.50'), currencyCode: 'sgd' },
      { amount: money('7.25'), currencyCode: 'SGD' },
      { amount: money('20.00'), currencyCode: 'USD' },
    ]),
    [
      { amount: '19.75', currencyCode: 'SGD' },
      { amount: '20.00', currencyCode: 'USD' },
    ],
  );
});

test('uses a linked reservation planned cost instead of its itinerary item cost', () => {
  assert.deepEqual(
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
    [{ amount: '145.00', currencyCode: 'USD' }],
  );
});

test('does not suppress an itinerary planned cost for a linked reservation without a cost', () => {
  assert.deepEqual(
    projectedCostTotals({
      itineraryItems: [
        { id: 'item-linked', plannedCostAmount: money('100.00'), plannedCostCurrencyCode: 'USD' },
      ],
      reservations: [
        { itineraryItemId: 'item-linked', plannedCostAmount: null, plannedCostCurrencyCode: null },
      ],
    }),
    [{ amount: '100.00', currencyCode: 'USD' }],
  );
});
