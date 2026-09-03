import { deriveRateFromBoard, type CachedCurrencyRateBoard } from '@/lib/currency/api';
import type { ExpenseCategory } from '@/lib/expenses/api';
import type { SpendCategoryKey } from '@/lib/expenses/categories';
import {
  fromMinorUnits,
  sumByCurrency,
  toMinorUnits,
  type CurrencyAmount,
} from '@/lib/currency/money';
import { calendarDayDistance, getLocalDate } from '@/lib/trips/lifecycle';

/**
 * A trip's spending expressed in one currency, together with everything that
 * could not honestly be folded into it.
 *
 * `unconvertible` exists because no board prices every currency, and the set it
 * does price can shrink - a provider outage leaves yesterday's board, and a
 * cached one can be narrower than the live answer. Dropping those amounts would
 * quietly understate the trip; folding them in at a guessed rate would quietly
 * misstate it. They are carried instead, so the screen can say what it does not
 * know.
 */
export type ConvertedTotal = {
  /** Parts that needed a rate and got one, in the currency they were paid in. */
  contributing: CurrencyAmount[];
  currencyCode: string;
  /** False when nothing needed a rate, so the figure is exact rather than near. */
  isApproximate: boolean;
  /** Null only when there was spending and none of it could be priced. */
  minorUnits: number | null;
  /** The oldest publication date across every pair used, or null when none was. */
  rateDate: string | null;
  rateSource: 'cache' | 'live' | null;
  unconvertible: CurrencyAmount[];
};

export type ReferenceCurrency = { code: string; origin: 'budget' | 'dominant' | 'home' };

/**
 * The currency the trip's figures are expressed in.
 *
 * `canPrice` is a parameter rather than a board lookup so the rungs can be
 * skipped individually: a traveller whose home currency the board cannot price
 * should fall through to the currency they set their budget in, not lose the
 * total altogether.
 */
export function resolveReferenceCurrency(input: {
  budgetCurrency: string | null;
  canPrice: (currencyCode: string) => boolean;
  homeCurrency: string | null;
  totals: readonly CurrencyAmount[];
}): ReferenceCurrency | null {
  const normalize = (value: string | null) => value?.trim().toUpperCase() || null;
  const candidates: ReferenceCurrency[] = [];
  const home = normalize(input.homeCurrency);
  const budget = normalize(input.budgetCurrency);

  if (home) candidates.push({ code: home, origin: 'home' });
  if (budget) candidates.push({ code: budget, origin: 'budget' });

  // Ties break alphabetically so the same trip always resolves the same way,
  // rather than following whichever expense happened to be summed first.
  const dominant = sumByCurrency(input.totals).toSorted((left, right) => {
    const difference = (toMinorUnits(right.amount) ?? 0n) - (toMinorUnits(left.amount) ?? 0n);
    if (difference > 0n) return 1;
    if (difference < 0n) return -1;
    return left.currencyCode.localeCompare(right.currencyCode);
  })[0];
  if (dominant) candidates.push({ code: dominant.currencyCode, origin: 'dominant' });

  return candidates.find((candidate) => input.canPrice(candidate.code)) ?? null;
}

/**
 * Sums exactly in each currency first, then applies one rate per currency.
 *
 * Converting per expense would multiply a float sixty times over a long trip;
 * converting per currency does it once. It is also the only ordering that keeps
 * a single-currency trip bit-exact, because those amounts never meet a rate.
 */
export function convertTotals(
  totals: readonly CurrencyAmount[],
  referenceCurrency: string,
  board: CachedCurrencyRateBoard | null,
): ConvertedTotal {
  const reference = referenceCurrency.trim().toUpperCase();
  const entries = sumByCurrency(totals);
  const contributing: CurrencyAmount[] = [];
  const unconvertible: CurrencyAmount[] = [];
  const rateDates: string[] = [];
  let converted = 0n;
  let pricedCount = 0;
  let usedARate = false;
  let usedCache = false;

  for (const entry of entries) {
    const minorUnits = toMinorUnits(entry.amount);
    if (minorUnits === null) continue;

    if (entry.currencyCode === reference) {
      converted += minorUnits;
      pricedCount += 1;
      continue;
    }

    const rate = board ? deriveRateFromBoard(board, entry.currencyCode, reference) : null;
    if (!rate) {
      unconvertible.push(entry);
      continue;
    }

    converted += BigInt(Math.round(Number(minorUnits) * rate.rate));
    contributing.push(entry);
    pricedCount += 1;
    rateDates.push(rate.date);
    usedARate = true;
    if (rate.source === 'cache') usedCache = true;
  }

  // Amounts already in the reference currency are priced without a rate, so
  // they count here even though they never reach `contributing`.
  const pricedNothing = entries.length > 0 && pricedCount === 0;

  return {
    contributing,
    currencyCode: reference,
    isApproximate: usedARate,
    minorUnits: pricedNothing ? null : Number(converted),
    // A pair is only as current as its least recently published half, and a
    // total is only as current as its oldest pair.
    rateDate: rateDates.length ? rateDates.reduce((a, b) => (b < a ? b : a)) : null,
    rateSource: usedARate ? (usedCache ? 'cache' : 'live') : null,
    unconvertible,
  };
}

export type TripPhase = 'finished' | 'underway' | 'upcoming';

export type TripPace = {
  elapsedDays: number;
  phase: TripPhase;
  remainingDays: number;
  totalDays: number;
};

/**
 * Where the traveller stands in the trip, counted in the trip's own timezone.
 *
 * Today is counted in both `elapsedDays` and `remainingDays` on purpose, so
 * `elapsedDays + remainingDays === totalDays + 1` while the trip is under way.
 * That is not an off-by-one: day one has to divide by one rather than zero, and
 * on the last day the remaining allowance still has a day to be spent in.
 */
export function resolveTripPace(input: {
  endDate: string;
  now: Date;
  referenceTimeZone: string;
  startDate: string;
}): TripPace {
  const today = getLocalDate(input.now, input.referenceTimeZone);
  const totalDays = calendarDayDistance(input.startDate, input.endDate) + 1;

  if (today < input.startDate) {
    return { elapsedDays: 0, phase: 'upcoming', remainingDays: totalDays, totalDays };
  }
  if (today > input.endDate) {
    return { elapsedDays: totalDays, phase: 'finished', remainingDays: 0, totalDays };
  }

  return {
    elapsedDays: calendarDayDistance(input.startDate, today) + 1,
    phase: 'underway',
    remainingDays: calendarDayDistance(today, input.endDate) + 1,
    totalDays,
  };
}

/**
 * What the trip has averaged per day so far.
 *
 * Withheld on the first day, where the "average" is just the first thing the
 * traveller bought: one airport taxi would read as three hundred a day for the
 * rest of the week. A figure that appears on every trip informs none of them.
 */
export function spendPerDay(spentMinorUnits: number | null, elapsedDays: number): number | null {
  if (spentMinorUnits === null || elapsedDays < 2) return null;
  return Math.round(spentMinorUnits / elapsedDays);
}

/**
 * What is left to spend, per day still to come.
 *
 * Unlike the backward-looking average this is honest on a single day - "forty
 * left for today" is exactly the question a traveller asks on their last
 * evening - so it only guards against dividing by nothing.
 */
export function budgetPerRemainingDay(
  remainingMinorUnits: number | null,
  remainingDays: number,
): number | null {
  if (remainingMinorUnits === null || remainingMinorUnits < 0 || remainingDays < 1) return null;
  return Math.round(remainingMinorUnits / remainingDays);
}

export type BudgetVerdict = 'ahead' | 'onTrack' | 'over' | 'unknown';

export type BudgetPosition = {
  budgetMinorUnits: number | null;
  overByMinorUnits: number;
  remainingMinorUnits: number | null;
  spentMinorUnits: number | null;
  spentRatio: number;
  verdict: BudgetVerdict;
};

/**
 * How far ahead of the budget a traveller may run before it is worth saying so.
 *
 * Without slack, anyone a hair above the straight line between departure and
 * return is warned every single day of the trip - and a warning that fires
 * daily is decoration, not a signal. Ten points of the whole budget is the
 * smallest band that survives one ordinary expensive lunch.
 */
const PACE_SLACK = 0.1;

export function resolveBudgetPosition(input: {
  actual: ConvertedTotal;
  budget: ConvertedTotal | null;
  pace: TripPace;
}): BudgetPosition {
  const spentMinorUnits = input.actual.minorUnits;
  const budgetMinorUnits = input.budget?.minorUnits ?? null;
  const unknown: BudgetPosition = {
    budgetMinorUnits,
    overByMinorUnits: 0,
    remainingMinorUnits: null,
    spentMinorUnits,
    spentRatio: 0,
    verdict: 'unknown',
  };

  // Zero is a budget a traveller can genuinely save, and dividing by it yields
  // an Infinity that renders as an empty bar rather than as an error.
  if (spentMinorUnits === null || budgetMinorUnits === null || budgetMinorUnits <= 0) {
    return unknown;
  }

  const spentRatio = Math.max(0, spentMinorUnits / budgetMinorUnits);
  const elapsedRatio = input.pace.totalDays > 0 ? input.pace.elapsedDays / input.pace.totalDays : 0;
  const position = {
    budgetMinorUnits,
    overByMinorUnits: Math.max(0, spentMinorUnits - budgetMinorUnits),
    remainingMinorUnits: budgetMinorUnits - spentMinorUnits,
    spentMinorUnits,
    spentRatio,
  };

  if (spentRatio > 1) return { ...position, verdict: 'over' };
  // Before departure and after the return there is no pace to be ahead of;
  // only the total itself can carry a verdict, and it already has above.
  if (input.pace.phase !== 'underway') return { ...position, verdict: 'onTrack' };

  return {
    ...position,
    verdict: spentRatio > elapsedRatio + PACE_SLACK ? 'ahead' : 'onTrack',
  };
}

/** Re-exported so callers converting for display need only this module. */
export { fromMinorUnits };

/**
 * What a breakdown needs of an expense, and no more.
 *
 * Typed structurally rather than as the full `Expense` so a test can describe a
 * case in five fields, and so this module never reaches the API client's
 * runtime chain.
 */
export type SpendExpense = {
  amount: string;
  category: ExpenseCategory | null;
  currencyCode: string;
  itineraryDay: { id: string } | null;
  tripPlace: { id: string } | null;
};

export type SpendBucket<Key> = {
  count: number;
  key: Key;
  /** 0-1 of the trip's converted spending; 0 when that total is zero or unknown. */
  share: number;
  total: ConvertedTotal;
};

export type DayRollup = {
  actual: ConvertedTotal;
  date: string;
  id: string;
  /** 1-based, so a row can be called "Day 4" without the caller counting. */
  index: number;
  isOutlier: boolean;
  isToday: boolean;
  share: number;
};

export type CurrencyRollup = {
  paid: CurrencyAmount;
  share: number;
  worth: ConvertedTotal;
};

export type SpendBreakdown = {
  byCategory: SpendBucket<SpendCategoryKey>[];
  byCurrency: CurrencyRollup[];
  byPlace: SpendBucket<string>[];
  days: DayRollup[];
  /** Expenses on no trip day: undated ones, and ones dated outside the trip. */
  offDay: { count: number; share: number; total: ConvertedTotal };
  total: ConvertedTotal;
};

/**
 * How far above a typical day counts as a day worth pointing at.
 *
 * Twice the median is legible in a sentence and survives the ordinary lumpiness
 * of travel, where one hotel night dwarfs a week of lunches.
 */
const OUTLIER_MEDIAN_MULTIPLE = 2;

/**
 * The share of a trip a day has to carry before being called expensive.
 *
 * Without it, a trip whose typical day is a four-euro coffee flags a nine-euro
 * lunch - twice the median, and worth nobody's attention.
 */
const OUTLIER_MINIMUM_SHARE = 0.05;

/** Below this many spending days a median is describing noise. */
const OUTLIER_MINIMUM_DAYS = 5;

/** More than this and the callout stops being a callout. */
const OUTLIER_LIMIT = 2;

export function detectSpendOutlierDays(
  days: ReadonlyArray<{ id: string; minorUnits: number }>,
): string[] {
  // Days with no spending would drag the median down and make an ordinary day
  // look extreme, so the population is the days money was actually spent on.
  const spending = days.filter((day) => day.minorUnits > 0);
  if (spending.length < OUTLIER_MINIMUM_DAYS) return [];

  const sorted = spending.map((day) => day.minorUnits).toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  const median = sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + upper) / 2 : upper;
  const total = sorted.reduce((sum, value) => sum + value, 0);
  if (median <= 0 || total <= 0) return [];

  return spending
    .filter(
      (day) =>
        day.minorUnits >= OUTLIER_MEDIAN_MULTIPLE * median &&
        day.minorUnits >= OUTLIER_MINIMUM_SHARE * total,
    )
    .toSorted((left, right) => right.minorUnits - left.minorUnits)
    .slice(0, OUTLIER_LIMIT)
    .map((day) => day.id);
}

function shareOf(part: ConvertedTotal, whole: ConvertedTotal) {
  if (part.minorUnits === null || !whole.minorUnits || whole.minorUnits <= 0) return 0;
  return Math.max(0, part.minorUnits / whole.minorUnits);
}

function bucketBy<Key>(
  expenses: readonly SpendExpense[],
  keyOf: (expense: SpendExpense) => Key | null,
  referenceCurrency: string,
  board: CachedCurrencyRateBoard | null,
  total: ConvertedTotal,
): SpendBucket<Key>[] {
  const grouped = new Map<Key, SpendExpense[]>();

  for (const expense of expenses) {
    const key = keyOf(expense);
    if (key === null) continue;
    const values = grouped.get(key) ?? [];
    values.push(expense);
    grouped.set(key, values);
  }

  return [...grouped.entries()]
    .map(([key, values]) => {
      const converted = convertTotals(values, referenceCurrency, board);
      return {
        count: values.length,
        key,
        share: shareOf(converted, total),
        total: converted,
      };
    })
    .toSorted((left, right) => (right.total.minorUnits ?? 0) - (left.total.minorUnits ?? 0));
}

/**
 * Every way of asking where a trip's money went, from one pass over the ledger.
 *
 * Every expense lands in exactly one day row or in `offDay`, so nothing a
 * traveller recorded can go missing between the total at the top of the screen
 * and the rows underneath it. That is the property worth protecting.
 *
 * Their converted sums can still differ from the headline by a cent, because
 * each total is converted and rounded once rather than sharing one rounding.
 * Reconciling that would mean spreading a rounding residue across rows, which is
 * bookkeeping - and every figure here already says it is approximate.
 */
export function buildSpendBreakdown(input: {
  board: CachedCurrencyRateBoard | null;
  days: ReadonlyArray<{ date: string; id: string }>;
  expenses: readonly SpendExpense[];
  referenceCurrency: string;
  /** Today in the trip's own timezone, or null when it is not the trip's concern. */
  today: string | null;
}): SpendBreakdown {
  const { board, days, expenses, referenceCurrency, today } = input;
  const total = convertTotals(expenses, referenceCurrency, board);
  const byDayId = new Map<string, SpendExpense[]>();
  const offDayExpenses: SpendExpense[] = [];
  const tripDayIds = new Set(days.map((day) => day.id));

  for (const expense of expenses) {
    // The server resolves an expense's day through its own timezone rules, and
    // the client has neither the item nor the place zone to reproduce them. So
    // the day it already decided is the only day this trusts - but only if the
    // trip still has that day. An expense left pointing at a day a later date
    // edit removed would otherwise land in a bucket nothing reads, and vanish
    // from both halves of the screen rather than showing up in one.
    const dayId = expense.itineraryDay?.id;
    if (!dayId || !tripDayIds.has(dayId)) {
      offDayExpenses.push(expense);
      continue;
    }
    const values = byDayId.get(dayId) ?? [];
    values.push(expense);
    byDayId.set(dayId, values);
  }

  const dayTotals = days.map((day, index) => ({
    ...day,
    actual: convertTotals(byDayId.get(day.id) ?? [], referenceCurrency, board),
    index: index + 1,
  }));

  // A yen day must not out-rank a euro day because 8400 is more than 120, so a
  // trip that is only partly priceable gets no outliers rather than wrong ones.
  const fullyConvertible = dayTotals.every(
    (day) => day.actual.minorUnits !== null && day.actual.unconvertible.length === 0,
  );
  const outliers = new Set(
    fullyConvertible
      ? detectSpendOutlierDays(
          dayTotals.map((day) => ({ id: day.id, minorUnits: day.actual.minorUnits ?? 0 })),
        )
      : [],
  );

  const offDayTotal = convertTotals(offDayExpenses, referenceCurrency, board);
  const paidByCurrency = sumByCurrency(expenses);

  return {
    byCategory: bucketBy<SpendCategoryKey>(
      expenses,
      (expense) => expense.category ?? 'uncategorised',
      referenceCurrency,
      board,
      total,
    ),
    byCurrency: paidByCurrency
      .map((paid) => {
        const worth = convertTotals([paid], referenceCurrency, board);
        return { paid, share: shareOf(worth, total), worth };
      })
      .toSorted((left, right) => (right.worth.minorUnits ?? 0) - (left.worth.minorUnits ?? 0)),
    byPlace: bucketBy(
      expenses,
      (expense) => expense.tripPlace?.id ?? null,
      referenceCurrency,
      board,
      total,
    ),
    // Every trip day is here, including the ones nothing was spent on: a quiet
    // day is part of the shape of a trip, and hiding it makes the rest lie.
    days: dayTotals.map((day) => ({
      actual: day.actual,
      date: day.date,
      id: day.id,
      index: day.index,
      isOutlier: outliers.has(day.id),
      isToday: today !== null && day.date === today,
      share: shareOf(day.actual, total),
    })),
    offDay: {
      count: offDayExpenses.length,
      share: shareOf(offDayTotal, total),
      total: offDayTotal,
    },
    total,
  };
}

export type SpendFilter = {
  kind: 'category' | 'currency' | 'day' | 'place';
  value: string;
};

export function matchesSpendFilter(expense: SpendExpense, filter: SpendFilter | null): boolean {
  if (!filter) return true;

  switch (filter.kind) {
    case 'category':
      return (expense.category ?? 'uncategorised') === filter.value;
    case 'currency':
      return expense.currencyCode.trim().toUpperCase() === filter.value;
    case 'day':
      return expense.itineraryDay?.id === filter.value;
    case 'place':
      return expense.tripPlace?.id === filter.value;
  }
}
