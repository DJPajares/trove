const DEFAULT_BASE_URL = 'https://api.frankfurter.dev';
const DEFAULT_TIMEOUT_MS = 8_000;
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

type FrankfurterRateResponse = {
  base?: string;
  date?: string;
  quote?: string;
  rate?: number;
};

type FrankfurterRatesResponse = Array<{
  base?: string;
  date?: string;
  quote?: string;
  rate?: number;
}>;

type FrankfurterCurrencyResponse = Array<{
  iso_code?: string;
  name?: string;
  symbol?: string | null;
}>;

export type CurrencyRate = {
  base: string;
  date: string;
  provider: 'frankfurter';
  quote: string;
  rate: number;
};

/**
 * Every quote for one base, in a single answer.
 *
 * Each quote carries its own date because the upstream reference does not move
 * every currency on the same day. `date` is the newest of them — what the board
 * as a whole represents — while a conversion reports the dates of the two
 * currencies it actually used.
 */
export type CurrencyRateBoard = {
  base: string;
  date: string;
  provider: 'frankfurter';
  rates: Record<string, CurrencyRateBoardEntry>;
};

export type CurrencyRateBoardEntry = {
  date: string;
  rate: number;
};

export type CurrencyMetadata = {
  code: string;
  name: string;
  symbol: string | null;
};

export type CurrencyProviderErrorCode =
  'invalid_request' | 'invalid_response' | 'provider_unavailable';

export class CurrencyProviderError extends Error {
  constructor(
    public readonly code: CurrencyProviderErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'CurrencyProviderError';
  }
}

export interface CurrencyProvider {
  getCurrencies(): Promise<CurrencyMetadata[]>;
  getRate(base: string, quote: string): Promise<CurrencyRate>;
  getRateBoard(base: string): Promise<CurrencyRateBoard>;
}

type FrankfurterCurrencyProviderOptions = {
  baseUrl?: string;
  fetcher?: Fetcher;
  requestTimeoutMs?: number;
};

function isDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeCurrencyCode(value: string) {
  return value.trim().toUpperCase();
}

export class FrankfurterCurrencyProvider implements CurrencyProvider {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly requestTimeoutMs: number;

  constructor(options: FrankfurterCurrencyProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.fetcher = options.fetcher ?? globalThis.fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async requestJson<T>(path: string): Promise<T> {
    let response: Response;

    try {
      response = await this.fetcher(new URL(path, this.baseUrl), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (error) {
      throw new CurrencyProviderError('provider_unavailable', { cause: error });
    }

    if (!response.ok) {
      throw new CurrencyProviderError(
        response.status === 400 || response.status === 404 || response.status === 422
          ? 'invalid_request'
          : 'provider_unavailable',
      );
    }

    try {
      return (await response.json()) as T;
    } catch (error) {
      throw new CurrencyProviderError('invalid_response', { cause: error });
    }
  }

  async getCurrencies(): Promise<CurrencyMetadata[]> {
    const response = await this.requestJson<FrankfurterCurrencyResponse>('/v2/currencies');
    const currencies = response
      .map((currency) => {
        const code =
          typeof currency.iso_code === 'string' ? normalizeCurrencyCode(currency.iso_code) : '';
        const name = typeof currency.name === 'string' ? currency.name.trim() : '';

        if (!CURRENCY_CODE_PATTERN.test(code) || !name) return null;

        return {
          code,
          name,
          symbol:
            typeof currency.symbol === 'string' && currency.symbol.trim() ? currency.symbol : null,
        };
      })
      .filter((currency): currency is CurrencyMetadata => currency !== null)
      .sort((left, right) => left.code.localeCompare(right.code));

    if (!currencies.length) {
      throw new CurrencyProviderError('invalid_response');
    }

    return currencies;
  }

  /**
   * One request returns every quote for `base`, which is what makes a daily
   * snapshot cheaper than a per-pair cache: an unseen pair becomes arithmetic
   * rather than another call.
   */
  async getRateBoard(base: string): Promise<CurrencyRateBoard> {
    const normalizedBase = normalizeCurrencyCode(base);

    if (!CURRENCY_CODE_PATTERN.test(normalizedBase)) {
      throw new CurrencyProviderError('invalid_request');
    }

    const response = await this.requestJson<FrankfurterRatesResponse>(
      `/v2/rates?base=${encodeURIComponent(normalizedBase)}`,
    );

    if (!Array.isArray(response)) {
      throw new CurrencyProviderError('invalid_response');
    }

    const rates: Record<string, CurrencyRateBoardEntry> = {};
    let latestDate = '';

    for (const row of response) {
      const rowBase = typeof row.base === 'string' ? normalizeCurrencyCode(row.base) : '';
      const quote = typeof row.quote === 'string' ? normalizeCurrencyCode(row.quote) : '';

      // A single malformed row should not discard the whole board; the quotes
      // that parsed are still every pair those currencies can form.
      if (
        rowBase !== normalizedBase ||
        !CURRENCY_CODE_PATTERN.test(quote) ||
        !isDate(row.date) ||
        typeof row.rate !== 'number' ||
        !Number.isFinite(row.rate) ||
        row.rate <= 0
      ) {
        continue;
      }

      rates[quote] = { date: row.date, rate: row.rate };
      if (row.date > latestDate) latestDate = row.date;
    }

    if (!latestDate) {
      throw new CurrencyProviderError('invalid_response');
    }

    return { base: normalizedBase, date: latestDate, provider: 'frankfurter', rates };
  }

  async getRate(base: string, quote: string): Promise<CurrencyRate> {
    const normalizedBase = normalizeCurrencyCode(base);
    const normalizedQuote = normalizeCurrencyCode(quote);

    if (
      !CURRENCY_CODE_PATTERN.test(normalizedBase) ||
      !CURRENCY_CODE_PATTERN.test(normalizedQuote)
    ) {
      throw new CurrencyProviderError('invalid_response');
    }

    const response = await this.requestJson<FrankfurterRateResponse>(
      `/v2/rate/${encodeURIComponent(normalizedBase)}/${encodeURIComponent(normalizedQuote)}`,
    );
    const responseBase =
      typeof response.base === 'string' ? normalizeCurrencyCode(response.base) : '';
    const responseQuote =
      typeof response.quote === 'string' ? normalizeCurrencyCode(response.quote) : '';

    if (
      responseBase !== normalizedBase ||
      responseQuote !== normalizedQuote ||
      !isDate(response.date) ||
      typeof response.rate !== 'number' ||
      !Number.isFinite(response.rate) ||
      response.rate <= 0
    ) {
      throw new CurrencyProviderError('invalid_response');
    }

    return {
      base: normalizedBase,
      date: response.date,
      provider: 'frankfurter',
      quote: normalizedQuote,
      rate: response.rate,
    };
  }
}

export class CurrencyService {
  constructor(private readonly provider: CurrencyProvider = new FrankfurterCurrencyProvider()) {}

  getCurrencies() {
    return this.provider.getCurrencies();
  }

  getRate(base: string, quote: string) {
    return this.provider.getRate(base, quote);
  }

  getRateBoard(base: string) {
    return this.provider.getRateBoard(base);
  }
}
