import { deriveRateFromBoard, type CachedCurrencyRateBoard } from '@/lib/currency/api';
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
