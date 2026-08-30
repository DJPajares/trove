import { createBrowserSupabaseClient } from '@/lib/supabase/client';

export type CurrencyMetadata = {
  code: string;
  name: string;
  symbol: string | null;
};

export type CurrencyRate = {
  base: string;
  date: string;
  provider: 'frankfurter';
  quote: string;
  rate: number;
};

export type CachedCurrencyRate = CurrencyRate & {
  fetchedAt: string;
  source: 'cache' | 'live';
};

/**
 * Every quote for one base, in a single answer.
 *
 * Each quote carries its own date because the upstream reference does not move
 * every currency on the same day. `date` is the newest of them.
 */
export type CurrencyRateBoard = {
  base: string;
  date: string;
  provider: 'frankfurter';
  rates: Record<string, { date: string; rate: number }>;
};

export type CachedCurrencyRateBoard = CurrencyRateBoard & {
  fetchedAt: string;
  source: 'cache' | 'live';
};

export class CurrencyApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

const apiUrl = process.env.NEXT_PUBLIC_TROVE_API_URL ?? 'http://localhost:3001';
const rateCachePrefix = 'trove:currency-rate:v1:';
const currenciesCacheKey = 'trove:currencies:v1';
const boardCacheKey = 'trove:currency-board:v1';

/**
 * The API already holds a snapshot for the day, so re-asking more often than
 * this only moves bytes. Half a day keeps a device that stays open across a
 * publication picking the new board up the same day.
 */
const BOARD_CACHE_TTL_MS = 12 * 60 * 60 * 1_000;

async function getAccessToken() {
  const supabase = createBrowserSupabaseClient();
  if (!supabase) throw new CurrencyApiError('supabase_not_configured', 500);
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new CurrencyApiError('not_authenticated', 401);
  return data.session.access_token;
}

async function currencyRequest<T>(path: string) {
  const accessToken = await getAccessToken();
  const response = await fetch(`${apiUrl}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { code?: string };
    throw new CurrencyApiError(
      body.code ?? `currency_request_failed_${response.status}`,
      response.status,
    );
  }
  return response.json() as Promise<T>;
}

function normalizeCurrencyCode(value: string) {
  return value.trim().toUpperCase();
}

function hasStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function rateCacheKey(base: string, quote: string) {
  return `${rateCachePrefix}${base}-${quote}`;
}

function readCache<T>(key: string): T | null {
  if (!hasStorage()) return null;

  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? 'null');
    return value && typeof value === 'object' ? (value as T) : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, value: unknown) {
  if (!hasStorage()) return;

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing or a full storage quota should not prevent conversion.
  }
}

function isCachedRate(value: unknown, base: string, quote: string): value is CachedCurrencyRate {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CachedCurrencyRate>;
  return (
    candidate.base === base &&
    candidate.quote === quote &&
    candidate.provider === 'frankfurter' &&
    typeof candidate.date === 'string' &&
    typeof candidate.fetchedAt === 'string' &&
    typeof candidate.rate === 'number' &&
    Number.isFinite(candidate.rate) &&
    candidate.rate > 0
  );
}

function cachedRate(base: string, quote: string) {
  const value = readCache<unknown>(rateCacheKey(base, quote));
  if (!isCachedRate(value, base, quote)) return null;
  return { ...value, source: 'cache' as const };
}

export async function fetchCurrencies() {
  const response = await currencyRequest<{ currencies: CurrencyMetadata[] }>(
    '/currency/currencies',
  );
  writeCache(currenciesCacheKey, response.currencies);
  return response.currencies;
}

export async function getCurrenciesWithCache() {
  const cached = readCache<CurrencyMetadata[]>(currenciesCacheKey);

  if (typeof navigator !== 'undefined' && !navigator.onLine && Array.isArray(cached)) {
    return { currencies: cached, source: 'cache' as const };
  }

  try {
    return { currencies: await fetchCurrencies(), source: 'live' as const };
  } catch (error) {
    if (Array.isArray(cached)) return { currencies: cached, source: 'cache' as const };
    throw error;
  }
}

function isCachedBoard(value: unknown): value is CachedCurrencyRateBoard {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CachedCurrencyRateBoard>;
  return (
    candidate.provider === 'frankfurter' &&
    typeof candidate.base === 'string' &&
    typeof candidate.date === 'string' &&
    typeof candidate.fetchedAt === 'string' &&
    Boolean(candidate.rates) &&
    typeof candidate.rates === 'object'
  );
}

export async function fetchRateBoard() {
  const board = await currencyRequest<CurrencyRateBoard>('/currency/rates');
  const cached: CachedCurrencyRateBoard = {
    ...board,
    fetchedAt: new Date().toISOString(),
    source: 'live',
  };
  writeCache(boardCacheKey, cached);
  return cached;
}

/**
 * The whole day's board, so a conversion is arithmetic rather than a request.
 * Holding it is what lets the converter answer as you type, and answer offline.
 */
export async function getRateBoardWithCache(): Promise<CachedCurrencyRateBoard> {
  const value = readCache<unknown>(boardCacheKey);
  const cached = isCachedBoard(value) ? { ...value, source: 'cache' as const } : null;
  const offline = typeof navigator !== 'undefined' && !navigator.onLine;
  const fresh = cached && Date.now() - new Date(cached.fetchedAt).getTime() <= BOARD_CACHE_TTL_MS;

  if (cached && (offline || fresh)) return cached;

  try {
    return await fetchRateBoard();
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
}

/**
 * Mirrors the server's derivation: a pair is one division away from the board,
 * so a currency the device has never converted still costs nothing.
 *
 * The pair is only as current as its least recently published half, so the
 * older of the two dates is reported rather than the board's newest.
 */
export function deriveRateFromBoard(
  board: CachedCurrencyRateBoard,
  baseInput: string,
  quoteInput: string,
): CachedCurrencyRate | null {
  const base = normalizeCurrencyCode(baseInput);
  const quote = normalizeCurrencyCode(quoteInput);
  // The board's own base has no row of its own; it is one by definition, and it
  // borrows the date of whichever currency it is being compared against.
  const entryFor = (code: string) =>
    code === board.base ? { date: null, rate: 1 } : (board.rates[code] ?? null);
  const baseEntry = entryFor(base);
  const quoteEntry = entryFor(quote);

  if (!baseEntry || !quoteEntry || baseEntry.rate <= 0) return null;

  const dates = [baseEntry.date, quoteEntry.date].filter((date): date is string => date !== null);

  return {
    base,
    date: dates.length
      ? dates.reduce((oldest, date) => (date < oldest ? date : oldest))
      : board.date,
    fetchedAt: board.fetchedAt,
    provider: 'frankfurter',
    quote,
    rate: quoteEntry.rate / baseEntry.rate,
    source: board.source,
  };
}

export async function getCurrencyRate(
  baseInput: string,
  quoteInput: string,
): Promise<CachedCurrencyRate> {
  const base = normalizeCurrencyCode(baseInput);
  const quote = normalizeCurrencyCode(quoteInput);

  if (!/^[A-Z]{3}$/.test(base) || !/^[A-Z]{3}$/.test(quote) || base === quote) {
    throw new CurrencyApiError('invalid_currency_pair', 400);
  }

  const cached = cachedRate(base, quote);
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    if (cached) return cached;
    throw new CurrencyApiError('currency_unavailable', 503);
  }

  try {
    const response = await currencyRequest<{ rate: CurrencyRate }>(
      `/currency/rate?base=${encodeURIComponent(base)}&quote=${encodeURIComponent(quote)}`,
    );
    const rate: CachedCurrencyRate = {
      ...response.rate,
      fetchedAt: new Date().toISOString(),
      source: 'live',
    };
    writeCache(rateCacheKey(base, quote), rate);
    return rate;
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
}

export function convertCurrencyAmount(amount: string | number, rate: number) {
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(value) || !Number.isFinite(rate)) return null;
  return (value * rate).toFixed(2);
}
