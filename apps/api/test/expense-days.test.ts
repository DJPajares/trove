import { beforeEach, expect, test } from 'vitest';

import { installFakePrismaClient, resetStore, store } from './support/fake-prisma.js';

installFakePrismaClient();
const { expenseDayFor } = await import('../src/services/expenses-rules.js');
const { relinkExpensesToDays } = await import('../src/services/expenses.js');
const { getPrismaClient } = await import('@trove/db');

const days = [
  { date: '2026-11-20', id: 'd20' },
  { date: '2026-11-21', id: 'd21' },
];

test('a dated expense belongs to the trip day with its date, whatever it was linked to', () => {
  expect(expenseDayFor({ itineraryDayId: null, localDate: '2026-11-21' }, days)?.id).toBe('d21');
  // A link written before a date change is not trusted over the date.
  expect(expenseDayFor({ itineraryDayId: 'd20', localDate: '2026-11-21' }, days)?.id).toBe('d21');
  expect(expenseDayFor({ itineraryDayId: 'd20', localDate: '2026-12-01' }, days)).toBeNull();
});

test('an undated expense keeps its item day only while that day exists', () => {
  expect(expenseDayFor({ itineraryDayId: 'd20', localDate: null }, days)?.id).toBe('d20');
  expect(expenseDayFor({ itineraryDayId: 'gone', localDate: null }, days)).toBeNull();
  expect(expenseDayFor({ itineraryDayId: null, localDate: null }, days)).toBeNull();
});

beforeEach(() => {
  resetStore();
  store.itineraryDay.push(
    { date: new Date('2026-11-20'), id: 'd20', tripId: 'trip' },
    { date: new Date('2026-11-21'), id: 'd21', tripId: 'trip' },
  );
});

test('after the trip days change, expenses are re-filed on the days their dates fall on', async () => {
  store.expense.push(
    // Saved before Nov 21 was a trip day.
    { id: 'stranded', itineraryDayId: null, localDate: new Date('2026-11-21'), tripId: 'trip' },
    // Linked to a day that now carries another date.
    { id: 'moved', itineraryDayId: 'd21', localDate: new Date('2026-11-20'), tripId: 'trip' },
    { id: 'undated', itineraryDayId: null, localDate: null, tripId: 'trip' },
    { id: 'outside', itineraryDayId: 'd20', localDate: new Date('2026-12-01'), tripId: 'trip' },
  );

  await getPrismaClient().$transaction((transaction) => relinkExpensesToDays(transaction, 'trip'));

  const dayOf = (id: string) => store.expense.find((expense) => expense.id === id)?.itineraryDayId;
  expect(dayOf('stranded')).toBe('d21');
  expect(dayOf('moved')).toBe('d20');
  expect(dayOf('undated')).toBeNull();
  expect(dayOf('outside')).toBeNull();
});
