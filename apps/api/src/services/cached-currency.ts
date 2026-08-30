import { getPrismaClient } from '@trove/db';

import { recordProviderCacheEvent, recordProviderCall } from './provider-usage.js';
import {
  CurrencyProviderError,
  FrankfurterCurrencyProvider,
  type CurrencyMetadata,
  type CurrencyProvider,
  type CurrencyRate,
  type CurrencyRateBoard,
  type CurrencyRateBoardEntry,
} from './currency.js';

/**
 * Frankfurter republishes once per working day, so a day-old answer is the same
 * answer. Anything shorter than this buys nothing and costs a request.
 */
const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1_000;

/**
 * EUR is the currency the upstream reference rates are actually quoted in, so
 * storing the board in that base keeps every derived pair one division away
 * from the published number rather than two.
 */
export const SNAPSHOT_BASE = 'EUR';

const PROVIDER = 'frankfurter';
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

export type CachedCurrencyRateBoard = CurrencyRateBoard & {
  fetchedAt: string;
  source: 'cache' | 'live';
};

type StoredCurrencies = {
  currencies: CurrencyMetadata[];
  fetchedAt: Date;
};

/**
 * The persistence half of the cache, kept behind an interface so the freshness
 * and fallback rules above can be tested without a database.
 *
 * Every method is expected to swallow its own failures: a cache that cannot be
 * reached is a slow path, never a failed request.
 */
export interface CurrencyStore {
  readBoard(): Promise<CachedCurrencyRateBoard | null>;
  readCurrencies(): Promise<StoredCurrencies | null>;
  writeBoard(board: CurrencyRateBoard, fetchedAt: Date): Promise<void>;
  writeCurrencies(currencies: CurrencyMetadata[], fetchedAt: Date): Promise<void>;
}

function normalizeCurrencyCode(value: string) {
  return value.trim().toUpperCase();
}

/** Prisma returns `Decimal`; the board is arithmetic, so it wants numbers. */
function toRateNumber(value: unknown) {
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

function utcDay(date: string) {
  return new Date(`${date}T00:00:00.000Z`);
}

export class PrismaCurrencyStore implements CurrencyStore {
  async readBoard(): Promise<CachedCurrencyRateBoard | null> {
    let snapshot;

    try {
      snapshot = await getPrismaClient().currencyRateSnapshot.findFirst({
        include: { rates: true },
        orderBy: { rateDate: 'desc' },
        where: { base: SNAPSHOT_BASE, provider: PROVIDER },
      });
    } catch {
      return null;
    }

    if (!snapshot?.rates.length) return null;

    const rates: Record<string, CurrencyRateBoardEntry> = {};

    for (const entry of snapshot.rates) {
      const rate = toRateNumber(entry.rate);
      if (rate === null) continue;
      rates[normalizeCurrencyCode(entry.code)] = {
        date: entry.rateDate.toISOString().slice(0, 10),
        rate,
      };
    }

    if (!Object.keys(rates).length) return null;

    return {
      base: SNAPSHOT_BASE,
      date: snapshot.rateDate.toISOString().slice(0, 10),
      fetchedAt: snapshot.fetchedAt.toISOString(),
      provider: PROVIDER,
      rates,
      source: 'cache',
    };
  }

  async writeBoard(board: CurrencyRateBoard, fetchedAt: Date) {
    const key = { base: board.base, provider: PROVIDER, rateDate: utcDay(board.date) };

    try {
      await getPrismaClient().$transaction(async (transaction) => {
        const snapshot = await transaction.currencyRateSnapshot.upsert({
          create: { ...key, fetchedAt },
          select: { id: true },
          update: { fetchedAt },
          where: { currency_rate_snapshot_day: key },
        });

        // The board is replaced wholesale so a currency the provider dropped
        // does not linger as a rate nothing will ever refresh.
        await transaction.currencyRateSnapshotRate.deleteMany({
          where: { snapshotId: snapshot.id },
        });
        await transaction.currencyRateSnapshotRate.createMany({
          data: Object.entries(board.rates).map(([code, entry]) => ({
            code,
            rate: entry.rate,
            rateDate: utcDay(entry.date),
            snapshotId: snapshot.id,
          })),
        });
      });
    } catch {
      // Failing to cache must never fail the request that produced the data.
    }
  }

  async readCurrencies(): Promise<StoredCurrencies | null> {
    let entries;

    try {
      entries = await getPrismaClient().currencyMetadataEntry.findMany({
        orderBy: { code: 'asc' },
      });
    } catch {
      return null;
    }

    const [first, ...rest] = entries;
    if (!first) return null;

    return {
      currencies: entries.map((entry) => ({
        code: normalizeCurrencyCode(entry.code),
        name: entry.name,
        symbol: entry.symbol,
      })),
      // The list is only as fresh as its oldest row, so a refresh that stopped
      // halfway re-asks rather than looking current.
      fetchedAt: rest.reduce(
        (oldest, entry) => (entry.fetchedAt < oldest ? entry.fetchedAt : oldest),
        first.fetchedAt,
      ),
    };
  }

  async writeCurrencies(currencies: CurrencyMetadata[], fetchedAt: Date) {
    const prisma = getPrismaClient();

    try {
      await prisma.$transaction(
        currencies.map((currency) =>
          prisma.currencyMetadataEntry.upsert({
            create: { ...currency, fetchedAt },
            update: { ...currency, fetchedAt },
            where: { code: currency.code },
          }),
        ),
      );
    } catch {
      // Failing to cache must never fail the request that produced the data.
    }
  }
}

/**
 * A shared daily snapshot of every exchange rate, so the converter costs one
 * provider call a day for the whole install rather than one per conversion.
 *
 * The cache is a fast path, never a dependency. A store that cannot answer
 * degrades into a provider call, and a provider that cannot be reached degrades
 * into the last snapshot on record — a stale reference rate is still useful,
 * and the client labels it as saved rather than current.
 */
export class CachedCurrencyService {
  private readonly provider: CurrencyProvider;
  private readonly store: CurrencyStore;
  private readonly now: () => Date;
  private inFlightBoard: Promise<CachedCurrencyRateBoard> | null = null;
  private inFlightCurrencies: Promise<CurrencyMetadata[]> | null = null;

  constructor(
    provider: CurrencyProvider = new FrankfurterCurrencyProvider(),
    store: CurrencyStore = new PrismaCurrencyStore(),
    clock: () => Date = () => new Date(),
  ) {
    this.provider = provider;
    this.store = store;
    this.now = clock;
  }

  /**
   * Concurrent misses share one refresh. Without this, the first request after
   * a snapshot expires becomes as many provider calls as there are visitors in
   * that instant.
   */
  async getRateBoard(): Promise<CachedCurrencyRateBoard> {
    this.inFlightBoard ??= this.refreshRateBoard().finally(() => {
      this.inFlightBoard = null;
    });

    return this.inFlightBoard;
  }

  async getRate(baseInput: string, quoteInput: string): Promise<CurrencyRate> {
    const base = normalizeCurrencyCode(baseInput);
    const quote = normalizeCurrencyCode(quoteInput);

    if (!CURRENCY_CODE_PATTERN.test(base) || !CURRENCY_CODE_PATTERN.test(quote)) {
      throw new CurrencyProviderError('invalid_request');
    }

    const board = await this.getRateBoard();
    const derived = deriveRateFromBoard(board, base, quote);

    if (derived === null) throw new CurrencyProviderError('invalid_request');

    return { base, date: derived.date, provider: PROVIDER, quote, rate: derived.rate };
  }

  async getCurrencies(): Promise<CurrencyMetadata[]> {
    this.inFlightCurrencies ??= this.refreshCurrencies().finally(() => {
      this.inFlightCurrencies = null;
    });

    return this.inFlightCurrencies;
  }

  private isFresh(fetchedAt: Date) {
    return this.now().getTime() - fetchedAt.getTime() <= SNAPSHOT_TTL_MS;
  }

  private recordCacheHit() {
    recordProviderCacheEvent({
      cache: 'currency',
      kind: 'cache_hit',
      operation: 'getRates',
      provider: PROVIDER,
      source: 'currency',
    });
  }

  private async refreshRateBoard(): Promise<CachedCurrencyRateBoard> {
    const stored = await this.store.readBoard();

    if (stored && this.isFresh(new Date(stored.fetchedAt))) {
      this.recordCacheHit();
      return stored;
    }

    try {
      recordProviderCall({
        cacheMissReason: stored ? 'stale_snapshot' : 'missing_snapshot',
        endpoint: '/v2/rates',
        expectedSku: 'currency-rates-free',
        operation: 'getRates',
        provider: PROVIDER,
        source: 'currency',
      });

      const board = await this.provider.getRateBoard(SNAPSHOT_BASE);
      const fetchedAt = this.now();
      await this.store.writeBoard(board, fetchedAt);

      return { ...board, fetchedAt: fetchedAt.toISOString(), source: 'live' };
    } catch (error) {
      // A reference rate from yesterday beats no converter at all.
      if (stored) return stored;
      throw error;
    }
  }

  private async refreshCurrencies(): Promise<CurrencyMetadata[]> {
    const stored = await this.store.readCurrencies();

    if (stored && this.isFresh(stored.fetchedAt)) {
      this.recordCacheHit();
      return stored.currencies;
    }

    try {
      const currencies = await this.provider.getCurrencies();
      await this.store.writeCurrencies(currencies, this.now());
      return currencies;
    } catch (error) {
      if (stored) return stored.currencies;
      throw error;
    }
  }
}

/**
 * Every pair is one division away from the stored board, which is why a single
 * daily call covers currencies nobody has asked for yet.
 *
 * The pair is only as current as its least recently published half, so the
 * older of the two dates is reported rather than the board's newest.
 */
export function deriveRateFromBoard(
  board: Pick<CurrencyRateBoard, 'base' | 'date' | 'rates'>,
  base: string,
  quote: string,
): CurrencyRateBoardEntry | null {
  // The board's own base has no row of its own; it is one by definition, and it
  // borrows the date of whichever currency it is being compared against.
  const entryFor = (code: string) =>
    code === board.base ? { date: null, rate: 1 } : (board.rates[code] ?? null);
  const baseEntry = entryFor(base);
  const quoteEntry = entryFor(quote);

  if (!baseEntry || !quoteEntry || baseEntry.rate <= 0) return null;

  const dates = [baseEntry.date, quoteEntry.date].filter((date): date is string => date !== null);

  return {
    date: dates.length
      ? dates.reduce((oldest, date) => (date < oldest ? date : oldest))
      : board.date,
    rate: quoteEntry.rate / baseEntry.rate,
  };
}
