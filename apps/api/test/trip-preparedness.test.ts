import { expect, test } from 'vitest';

import { calculateTripPreparedness } from '../src/services/trip-rules.js';

type DayInput = { date: Date | string; hasStay: boolean; scheduledItemCount: number };

function day(date: string, overrides: Partial<Omit<DayInput, 'date'>> = {}): DayInput {
  return { date, hasStay: false, scheduledItemCount: 0, ...overrides };
}

test('an empty plan scores zero', () => {
  const result = calculateTripPreparedness('2026-05-01', '2026-05-04', [
    day('2026-05-01'),
    day('2026-05-02'),
    day('2026-05-03'),
    day('2026-05-04'),
  ]);

  expect(result).toEqual({
    daysPlanned: 0,
    daysWithStay: 0,
    percentage: 0,
    stayApplicable: true,
    totalDays: 4,
  });
});

test('a plan with everything scheduled and every night covered scores 100', () => {
  const result = calculateTripPreparedness('2026-05-01', '2026-05-03', [
    day('2026-05-01', { hasStay: true, scheduledItemCount: 2 }),
    day('2026-05-02', { hasStay: true, scheduledItemCount: 1 }),
    day('2026-05-03', { hasStay: true, scheduledItemCount: 3 }),
  ]);

  expect(result.percentage).toBe(100);
  expect(result.daysPlanned).toBe(3);
  expect(result.daysWithStay).toBe(3);
});

test('the two components carry equal weight', () => {
  const everyDayPlanned = calculateTripPreparedness('2026-05-01', '2026-05-04', [
    day('2026-05-01', { scheduledItemCount: 1 }),
    day('2026-05-02', { scheduledItemCount: 1 }),
    day('2026-05-03', { scheduledItemCount: 1 }),
    day('2026-05-04', { scheduledItemCount: 1 }),
  ]);
  const everyNightCovered = calculateTripPreparedness('2026-05-01', '2026-05-04', [
    day('2026-05-01', { hasStay: true }),
    day('2026-05-02', { hasStay: true }),
    day('2026-05-03', { hasStay: true }),
    day('2026-05-04', { hasStay: true }),
  ]);

  expect(everyDayPlanned.percentage).toBe(50);
  expect(everyNightCovered.percentage).toBe(50);
});

test('a single-day trip drops the stay component rather than scoring it zero', () => {
  const planned = calculateTripPreparedness('2026-05-01', '2026-05-01', [
    day('2026-05-01', { scheduledItemCount: 1 }),
  ]);

  expect(planned.stayApplicable).toBe(false);
  expect(planned.percentage).toBe(100);

  const empty = calculateTripPreparedness('2026-05-01', '2026-05-01', [day('2026-05-01')]);

  expect(empty.percentage).toBe(0);
});

test('a stay on a single-day trip cannot lift the score past what is planned', () => {
  const result = calculateTripPreparedness('2026-05-01', '2026-05-01', [
    day('2026-05-01', { hasStay: true }),
  ]);

  expect(result.daysWithStay).toBe(1);
  expect(result.percentage).toBe(0);
});

test('days outside the trip range are ignored', () => {
  const result = calculateTripPreparedness('2026-05-02', '2026-05-03', [
    day('2026-05-01', { hasStay: true, scheduledItemCount: 5 }),
    day('2026-05-02', { hasStay: true, scheduledItemCount: 1 }),
    day('2026-05-03'),
    day('2026-05-04', { hasStay: true, scheduledItemCount: 5 }),
  ]);

  expect(result.totalDays).toBe(2);
  expect(result.daysPlanned).toBe(1);
  expect(result.daysWithStay).toBe(1);
  expect(result.percentage).toBe(50);
});

test('a Date carries the same weight as its date-only string', () => {
  const result = calculateTripPreparedness('2026-05-01', '2026-05-02', [
    { date: new Date('2026-05-01T00:00:00.000Z'), hasStay: true, scheduledItemCount: 1 },
    { date: new Date('2026-05-02T00:00:00.000Z'), hasStay: true, scheduledItemCount: 1 },
  ]);

  expect(result.percentage).toBe(100);
});

test('a duplicated day is counted once', () => {
  const result = calculateTripPreparedness('2026-05-01', '2026-05-02', [
    day('2026-05-01', { scheduledItemCount: 1 }),
    day('2026-05-01', { scheduledItemCount: 4 }),
  ]);

  expect(result.daysPlanned).toBe(1);
  expect(result.percentage).toBe(25);
});

test('the percentage rounds rather than truncates', () => {
  const result = calculateTripPreparedness('2026-05-01', '2026-05-03', [
    day('2026-05-01', { scheduledItemCount: 1 }),
  ]);

  // One mark of six available.
  expect(result.percentage).toBe(17);
});
