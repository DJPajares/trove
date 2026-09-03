import { expect, test } from 'vitest';

import type { CachedCurrencyRateBoard } from '../lib/currency/api.ts';
import { sumByCurrency } from '../lib/currency/money.ts';
import {
  budgetPerRemainingDay,
  buildSpendBreakdown,
  convertTotals,
  detectSpendOutlierDays,
  matchesSpendFilter,
  resolveBudgetPosition,
  resolveReferenceCurrency,
  resolveTripPace,
  spendPerDay,
} from '../lib/expenses/spend-insights.ts';

/** Base EUR, mirroring the shape the currency endpoint actually returns. */
function board(overrides: Partial<CachedCurrencyRateBoard> = {}): CachedCurrencyRateBoard {
  return {
    base: 'EUR',
    date: '2026-09-02',
    fetchedAt: '2026-09-02T06:00:00.000Z',
    provider: 'frankfurter',
    rates: {
      GBP: { date: '2026-09-02', rate: 0.85 },
      JPY: { date: '2026-08-29', rate: 160 },
      SGD: { date: '2026-09-02', rate: 1.5 },
      USD: { date: '2026-09-02', rate: 1.1 },
    },
    source: 'live',
    ...overrides,
  };
}

const canPriceAnything = () => true;

test('the client sums spending exactly as the server does', () => {
  // The same case as `groups actual spend by original currency` in
  // apps/api/test/expenses-rules.test.ts. These two must never drift.
  expect(
    sumByCurrency([
      { amount: '12.50', currencyCode: 'sgd' },
      { amount: '7.25', currencyCode: 'SGD' },
      { amount: '20.00', currencyCode: 'USD' },
    ]),
  ).toStrictEqual([
    { amount: '19.75', currencyCode: 'SGD' },
    { amount: '20.00', currencyCode: 'USD' },
  ]);
});

test('a currency is converted once, however many expenses were paid in it', () => {
  const total = convertTotals(
    [
      { amount: '10.00', currencyCode: 'EUR' },
      { amount: '5.55', currencyCode: 'EUR' },
      { amount: '1600.00', currencyCode: 'JPY' },
      { amount: '800.00', currencyCode: 'JPY' },
    ],
    'EUR',
    board(),
  );

  // 15.55 EUR, plus 2400 JPY at 160 to the euro, is 30.55 exactly.
  expect(total.minorUnits).toBe(3055);
  expect(total.isApproximate).toBe(true);
  expect(total.unconvertible).toStrictEqual([]);
});

test('a trip paid entirely in the reference currency is exact rather than approximate', () => {
  const total = convertTotals(
    [
      { amount: '10.00', currencyCode: 'EUR' },
      { amount: '0.05', currencyCode: 'EUR' },
    ],
    'EUR',
    board(),
  );

  expect(total).toStrictEqual({
    contributing: [],
    currencyCode: 'EUR',
    isApproximate: false,
    minorUnits: 1005,
    rateDate: null,
    rateSource: null,
    unconvertible: [],
  });
});

test('an amount the board cannot price is reported rather than folded in or dropped', () => {
  const total = convertTotals(
    [
      { amount: '10.00', currencyCode: 'EUR' },
      { amount: '500000.00', currencyCode: 'VND' },
    ],
    'EUR',
    board(),
  );

  expect(total.minorUnits).toBe(1000);
  expect(total.unconvertible).toStrictEqual([{ amount: '500000.00', currencyCode: 'VND' }]);
});

test('with no rate board at all the total is unknown and every amount is preserved', () => {
  const total = convertTotals(
    [
      { amount: '120.00', currencyCode: 'GBP' },
      { amount: '8400.00', currencyCode: 'JPY' },
    ],
    'EUR',
    null,
  );

  expect(total.minorUnits).toBeNull();
  expect(total.unconvertible).toStrictEqual([
    { amount: '120.00', currencyCode: 'GBP' },
    { amount: '8400.00', currencyCode: 'JPY' },
  ]);
});

test('a trip with nothing recorded has spent zero, not an unknown amount', () => {
  expect(convertTotals([], 'EUR', board()).minorUnits).toBe(0);
});

test('a total is only as current as its least recently published rate', () => {
  // JPY was published on the 29th, GBP on the 2nd. The older one governs.
  const total = convertTotals(
    [
      { amount: '10.00', currencyCode: 'GBP' },
      { amount: '1000.00', currencyCode: 'JPY' },
    ],
    'EUR',
    board(),
  );

  expect(total.rateDate).toBe('2026-08-29');
});

test('a cached rate anywhere in the total makes the whole total a cached one', () => {
  const total = convertTotals([{ amount: '10.00', currencyCode: 'GBP' }], 'EUR', {
    ...board(),
    source: 'cache',
  });

  expect(total.rateSource).toBe('cache');
});

test('the home currency is what the traveller sees their trip in', () => {
  expect(
    resolveReferenceCurrency({
      budgetCurrency: 'SGD',
      canPrice: canPriceAnything,
      homeCurrency: 'GBP',
      totals: [{ amount: '100.00', currencyCode: 'JPY' }],
    }),
  ).toStrictEqual({ code: 'GBP', origin: 'home' });
});

test('a home currency the board cannot price falls through to the budget', () => {
  expect(
    resolveReferenceCurrency({
      budgetCurrency: 'SGD',
      canPrice: (code) => code !== 'VND',
      homeCurrency: 'VND',
      totals: [{ amount: '100.00', currencyCode: 'JPY' }],
    }),
  ).toStrictEqual({ code: 'SGD', origin: 'budget' });
});

test('a traveller with no home currency and no budget still gets a total', () => {
  expect(
    resolveReferenceCurrency({
      budgetCurrency: null,
      canPrice: canPriceAnything,
      homeCurrency: null,
      totals: [
        { amount: '20.00', currencyCode: 'USD' },
        { amount: '500.00', currencyCode: 'JPY' },
      ],
    }),
  ).toStrictEqual({ code: 'JPY', origin: 'dominant' });
});

test('two currencies spent equally resolve the same way every time', () => {
  const totals = [
    { amount: '50.00', currencyCode: 'USD' },
    { amount: '50.00', currencyCode: 'GBP' },
  ];

  expect(
    resolveReferenceCurrency({
      budgetCurrency: null,
      canPrice: canPriceAnything,
      homeCurrency: null,
      totals,
    }),
  ).toStrictEqual({ code: 'GBP', origin: 'dominant' });
});

test('a trip with nothing at all to go on has no reference currency', () => {
  expect(
    resolveReferenceCurrency({
      budgetCurrency: null,
      canPrice: canPriceAnything,
      homeCurrency: null,
      totals: [],
    }),
  ).toBeNull();
});

const TOKYO_TRIP = {
  endDate: '2026-09-10',
  referenceTimeZone: 'Asia/Tokyo',
  startDate: '2026-09-01',
};

test('a trip that has not left yet has no days behind it', () => {
  expect(
    resolveTripPace({ ...TOKYO_TRIP, now: new Date('2026-08-20T00:00:00.000Z') }),
  ).toStrictEqual({
    elapsedDays: 0,
    phase: 'upcoming',
    remainingDays: 10,
    totalDays: 10,
  });
});

test('today counts as both a day travelled and a day still to spend in', () => {
  expect(
    resolveTripPace({ ...TOKYO_TRIP, now: new Date('2026-09-04T03:00:00.000Z') }),
  ).toStrictEqual({
    elapsedDays: 4,
    phase: 'underway',
    remainingDays: 7,
    totalDays: 10,
  });
});

test('a finished trip has all of its days behind it and none ahead', () => {
  expect(
    resolveTripPace({ ...TOKYO_TRIP, now: new Date('2026-09-20T00:00:00.000Z') }),
  ).toStrictEqual({
    elapsedDays: 10,
    phase: 'finished',
    remainingDays: 0,
    totalDays: 10,
  });
});

test('the trip decides what day it is, not the phone in the traveller pocket', () => {
  // 15:00 UTC on the 3rd is already the 4th in Tokyo, and still the 3rd in London.
  const now = new Date('2026-09-03T15:30:00.000Z');

  expect(resolveTripPace({ ...TOKYO_TRIP, now }).elapsedDays).toBe(4);
  expect(
    resolveTripPace({ ...TOKYO_TRIP, now, referenceTimeZone: 'Europe/London' }).elapsedDays,
  ).toBe(3);
});

test('a single day trip is one day long, not zero', () => {
  expect(
    resolveTripPace({
      endDate: '2026-09-01',
      now: new Date('2026-09-01T03:00:00.000Z'),
      referenceTimeZone: 'Asia/Tokyo',
      startDate: '2026-09-01',
    }),
  ).toStrictEqual({ elapsedDays: 1, phase: 'underway', remainingDays: 1, totalDays: 1 });
});

test('the first day of a trip is not enough to average', () => {
  expect(spendPerDay(30_000, 1)).toBeNull();
  expect(spendPerDay(30_000, 2)).toBe(15_000);
});

test('the last evening of a trip still has an allowance', () => {
  expect(budgetPerRemainingDay(4_000, 1)).toBe(4_000);
  expect(budgetPerRemainingDay(4_000, 0)).toBeNull();
});

test('an overspent budget leaves nothing per day rather than a negative allowance', () => {
  expect(budgetPerRemainingDay(-4_000, 2)).toBeNull();
});

const MIDPOINT: ReturnType<typeof resolveTripPace> = {
  elapsedDays: 5,
  phase: 'underway',
  remainingDays: 6,
  totalDays: 10,
};

function converted(minorUnits: number | null, currencyCode = 'EUR') {
  return {
    contributing: [],
    currencyCode,
    isApproximate: false,
    minorUnits,
    rateDate: null,
    rateSource: null,
    unconvertible: [],
  };
}

test('without a budget there is no verdict to give', () => {
  expect(
    resolveBudgetPosition({ actual: converted(50_000), budget: null, pace: MIDPOINT }).verdict,
  ).toBe('unknown');
});

test('a budget of zero is not something to be over', () => {
  const position = resolveBudgetPosition({
    actual: converted(50_000),
    budget: converted(0),
    pace: MIDPOINT,
  });

  expect(position.verdict).toBe('unknown');
  expect(Number.isFinite(position.spentRatio)).toBe(true);
  expect(position.spentRatio).toBe(0);
});

test('spending that could not be priced cannot be judged against a budget', () => {
  expect(
    resolveBudgetPosition({ actual: converted(null), budget: converted(100_000), pace: MIDPOINT })
      .verdict,
  ).toBe('unknown');
});

test('halfway through the trip and halfway through the budget is on track', () => {
  expect(
    resolveBudgetPosition({ actual: converted(50_000), budget: converted(100_000), pace: MIDPOINT })
      .verdict,
  ).toBe('onTrack');
});

test('exactly on the pace line is on track rather than a warning', () => {
  // Five days of ten elapsed, sixty percent spent: within the slack.
  expect(
    resolveBudgetPosition({ actual: converted(60_000), budget: converted(100_000), pace: MIDPOINT })
      .verdict,
  ).toBe('onTrack');
});

test('spending well ahead of the trip own progress is worth saying', () => {
  expect(
    resolveBudgetPosition({ actual: converted(75_000), budget: converted(100_000), pace: MIDPOINT })
      .verdict,
  ).toBe('ahead');
});

test('a plan that already exceeds the budget is over before departure', () => {
  const position = resolveBudgetPosition({
    actual: converted(120_000),
    budget: converted(100_000),
    pace: { elapsedDays: 0, phase: 'upcoming', remainingDays: 10, totalDays: 10 },
  });

  expect(position.verdict).toBe('over');
  expect(position.overByMinorUnits).toBe(20_000);
  expect(position.remainingMinorUnits).toBe(-20_000);
});

test('a trip that came in under budget is not warned about its pace', () => {
  expect(
    resolveBudgetPosition({
      actual: converted(90_000),
      budget: converted(100_000),
      pace: { elapsedDays: 10, phase: 'finished', remainingDays: 0, totalDays: 10 },
    }).verdict,
  ).toBe('onTrack');
});

const REFERENCE_BOARD = board();

function spent(
  amount: string,
  overrides: Partial<Parameters<typeof buildSpendBreakdown>[0]['expenses'][number]> = {},
) {
  return {
    amount,
    category: null,
    currencyCode: 'EUR',
    itineraryDay: null,
    tripPlace: null,
    ...overrides,
  };
}

const TRIP_DAYS = [
  { date: '2026-09-01', id: 'd1' },
  { date: '2026-09-02', id: 'd2' },
  { date: '2026-09-03', id: 'd3' },
];

function breakdown(
  expenses: Parameters<typeof buildSpendBreakdown>[0]['expenses'],
  today: string | null = null,
) {
  return buildSpendBreakdown({
    board: REFERENCE_BOARD,
    days: TRIP_DAYS,
    expenses,
    referenceCurrency: 'EUR',
    today,
  });
}

test('the day rows and the off-day bucket account for the whole trip', () => {
  const result = breakdown([
    spent('10.00', { itineraryDay: { id: 'd1' } }),
    spent('25.50', { itineraryDay: { id: 'd3' } }),
    spent('4.50'),
  ]);
  const counted =
    result.days.reduce((sum, day) => sum + (day.actual.minorUnits ?? 0), 0) +
    (result.offDay.total.minorUnits ?? 0);

  expect(result.total.minorUnits).toBe(4000);
  expect(counted).toBe(result.total.minorUnits);
});

test('a day the traveller spent nothing on is still part of the trip', () => {
  const result = breakdown([spent('10.00', { itineraryDay: { id: 'd1' } })]);

  expect(result.days).toHaveLength(3);
  expect(result.days[1]).toMatchObject({ id: 'd2', share: 0 });
  expect(result.days[1]?.actual.minorUnits).toBe(0);
});

test('an expense dated outside the trip is held aside rather than lost', () => {
  const result = breakdown([
    spent('10.00', { itineraryDay: { id: 'd1' } }),
    spent('90.00', { itineraryDay: { id: 'not-a-trip-day' } }),
  ]);

  expect(result.offDay.count).toBe(1);
  expect(result.offDay.total.minorUnits).toBe(9000);
  expect(result.days.every((day) => (day.actual.minorUnits ?? 0) <= 1000)).toBe(true);
});

test('an expense with no category is bucketed rather than dropped', () => {
  const result = breakdown([spent('10.00'), spent('5.00', { category: 'food' })]);

  expect(result.byCategory.map((bucket) => bucket.key)).toStrictEqual(['uncategorised', 'food']);
  expect(result.byCategory[0]?.total.minorUnits).toBe(1000);
});

test('shares describe the whole trip and never divide by nothing', () => {
  const result = breakdown([
    spent('75.00', { category: 'stay' }),
    spent('25.00', { category: 'food' }),
  ]);

  expect(result.byCategory.map((bucket) => bucket.share)).toStrictEqual([0.75, 0.25]);

  const empty = breakdown([]);
  expect(empty.byCategory).toStrictEqual([]);
  expect(empty.offDay.share).toBe(0);
  expect(empty.days.every((day) => Number.isFinite(day.share))).toBe(true);
});

test('what was paid in each currency keeps its own amount beside its worth', () => {
  const result = buildSpendBreakdown({
    board: REFERENCE_BOARD,
    days: TRIP_DAYS,
    expenses: [spent('10.00'), spent('1600.00', { currencyCode: 'JPY' })],
    referenceCurrency: 'EUR',
    today: null,
  });

  expect(result.byCurrency.map((row) => row.paid)).toStrictEqual([
    { amount: '10.00', currencyCode: 'EUR' },
    { amount: '1600.00', currencyCode: 'JPY' },
  ]);
  expect(result.byCurrency[1]?.worth.minorUnits).toBe(1000);
});

test('today is marked only when the trip says it is today', () => {
  const result = breakdown([spent('10.00', { itineraryDay: { id: 'd1' } })], '2026-09-02');

  expect(result.days.map((day) => day.isToday)).toStrictEqual([false, true, false]);
});

const flatDays = (count: number, minorUnits: number) =>
  Array.from({ length: count }, (_, index) => ({ id: `d${index}`, minorUnits }));

test('a handful of days is not enough to call any of them unusual', () => {
  expect(
    detectSpendOutlierDays([...flatDays(3, 1000), { id: 'big', minorUnits: 90_000 }]),
  ).toStrictEqual([]);
});

test('a trip that spent evenly has no unusual day to point at', () => {
  expect(detectSpendOutlierDays(flatDays(8, 5000))).toStrictEqual([]);
});

test('the night in a ryokan is the day worth pointing at', () => {
  expect(
    detectSpendOutlierDays([...flatDays(6, 2000), { id: 'ryokan', minorUnits: 60_000 }]),
  ).toStrictEqual(['ryokan']);
});

test('no more than two days are ever called out', () => {
  expect(
    detectSpendOutlierDays([
      ...flatDays(6, 1000),
      { id: 'a', minorUnits: 40_000 },
      { id: 'b', minorUnits: 30_000 },
      { id: 'c', minorUnits: 20_000 },
    ]),
  ).toStrictEqual(['a', 'b']);
});

test('twice a trivial median is still trivial', () => {
  // Nine euro against a four-euro median is twice typical and worth nobody's
  // attention, because it is a rounding error against the trip.
  expect(
    detectSpendOutlierDays([
      ...flatDays(6, 400),
      { id: 'lunch', minorUnits: 900 },
      { id: 'flight', minorUnits: 50_000 },
    ]),
  ).toStrictEqual(['flight']);
});

test('days that could not all be priced are compared to none of each other', () => {
  const result = buildSpendBreakdown({
    board: REFERENCE_BOARD,
    days: [...TRIP_DAYS, { date: '2026-09-04', id: 'd4' }, { date: '2026-09-05', id: 'd5' }],
    expenses: [
      spent('20.00', { itineraryDay: { id: 'd1' } }),
      spent('20.00', { itineraryDay: { id: 'd2' } }),
      spent('20.00', { itineraryDay: { id: 'd3' } }),
      spent('20.00', { itineraryDay: { id: 'd4' } }),
      // XTS is a reserved code the board carries no rate for.
      spent('900.00', { currencyCode: 'XTS', itineraryDay: { id: 'd5' } }),
    ],
    referenceCurrency: 'EUR',
    today: null,
  });

  expect(result.days.every((day) => !day.isOutlier)).toBe(true);
});

test('a filter of nothing keeps everything', () => {
  expect(matchesSpendFilter(spent('1.00'), null)).toBe(true);
});

test('each filter keeps only what it names', () => {
  const expense = spent('1.00', {
    category: 'food',
    currencyCode: 'jpy',
    itineraryDay: { id: 'd1' },
    tripPlace: { id: 'p1' },
  });

  expect(matchesSpendFilter(expense, { kind: 'category', value: 'food' })).toBe(true);
  expect(matchesSpendFilter(expense, { kind: 'category', value: 'stay' })).toBe(false);
  expect(matchesSpendFilter(expense, { kind: 'currency', value: 'JPY' })).toBe(true);
  expect(matchesSpendFilter(expense, { kind: 'day', value: 'd1' })).toBe(true);
  expect(matchesSpendFilter(expense, { kind: 'day', value: 'd2' })).toBe(false);
  expect(matchesSpendFilter(expense, { kind: 'place', value: 'p1' })).toBe(true);
});

test('an uncategorised expense is reachable by the bucket it was put in', () => {
  expect(matchesSpendFilter(spent('1.00'), { kind: 'category', value: 'uncategorised' })).toBe(
    true,
  );
});
