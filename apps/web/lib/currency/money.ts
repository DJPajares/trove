type NumberSeparators = {
  decimal: string;
  group: string;
};

function getNumberSeparators(locale: string): NumberSeparators {
  const parts = new Intl.NumberFormat(locale).formatToParts(12_345.6);
  return {
    decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
    group: parts.find((part) => part.type === 'group')?.value ?? ',',
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeMoneyInput(value: string, locale: string) {
  const { decimal, group } = getNumberSeparators(locale);
  let normalized = value.trim().replace(/[\s\u00a0\u202f]/g, '');

  if (!normalized) return '';
  if (group) normalized = normalized.replace(new RegExp(escapeRegExp(group), 'g'), '');
  if (decimal !== '.') normalized = normalized.replace(new RegExp(escapeRegExp(decimal), 'g'), '.');
  if (normalized.startsWith('.')) normalized = `0${normalized}`;

  return /^(?:0|[1-9]\d{0,9})(?:\.\d{0,2})?$/.test(normalized) ? normalized : null;
}

export function formatMoneyInput(value: string, locale: string, grouping = true) {
  if (!value) return '';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  const fraction = value.includes('.') ? (value.split('.')[1]?.length ?? 0) : 0;

  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
    minimumFractionDigits: Math.min(fraction, 2),
    useGrouping: grouping,
  }).format(parsed);
}

/**
 * A normalized amount as it should read mid-typing: grouped, but keeping what
 * the traveller has not finished yet - a trailing decimal separator, or a
 * fraction's trailing zero - which `formatMoneyInput` would round away.
 */
export function formatMoneyWhileTyping(normalized: string, locale: string) {
  if (!normalized) return '';
  const { decimal } = getNumberSeparators(locale);
  const [whole = '0', fraction] = normalized.split('.');
  const grouped = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Number(whole));
  return fraction === undefined ? grouped : `${grouped}${decimal}${fraction}`;
}

/**
 * Where the caret belongs after a reformat: past the same number of typed
 * characters (digits and the decimal separator) as before, so inserted or
 * removed group separators never make it jump.
 */
export function moneyCaretAfterFormat(
  raw: string,
  rawCaret: number,
  formatted: string,
  locale: string,
) {
  const typed = typedCharacters(raw.slice(0, rawCaret), locale).length;
  if (typed === 0) return 0;
  const { group } = getNumberSeparators(locale);
  let seen = 0;
  for (let index = 0; index < formatted.length; index += 1) {
    if (!isSeparator(formatted[index] ?? '', group)) seen += 1;
    if (seen === typed) return index + 1;
  }
  return formatted.length;
}

/**
 * Backspace or delete that only removed a group separator would be undone by
 * the next reformat, so the key would appear to do nothing. Treat it as
 * removing the digit beside the separator instead, the way native number
 * fields behave.
 */
export function removeDigitBesideSeparator(
  raw: string,
  caret: number,
  direction: 'backward' | 'forward',
) {
  // `raw` is the field after the browser removed the separator, and `caret`
  // sits where that separator was.
  const index = direction === 'backward' ? caret - 1 : caret;
  if (index < 0 || index >= raw.length) return null;
  return { caret: index, raw: raw.slice(0, index) + raw.slice(index + 1) };
}

function isSeparator(character: string, group: string) {
  return character === group || /[\s  ]/.test(character);
}

function typedCharacters(value: string, locale: string) {
  const { group } = getNumberSeparators(locale);
  return [...value].filter((character) => !isSeparator(character, group));
}

/** An amount as the API serialises it, paired with the currency it was paid in. */
export type CurrencyAmount = { amount: string; currencyCode: string };

/**
 * Money is counted in hundredths of the displayed unit, for every currency.
 *
 * This deliberately mirrors the server's `Decimal(12, 2)` and the cent
 * arithmetic in `apps/api/src/services/expenses-rules.ts`, rather than each
 * currency's own exponent. A yen amount is stored as `8400.00` and is therefore
 * 840,000 here; dividing by 100 hands `Intl` the displayed value and lets it
 * apply the currency's real fraction-digit rule. Re-scaling per currency is how
 * the client and the server come to disagree about the same expense.
 */
const MINOR_UNIT_SCALE = 100;

export function toMinorUnits(amount: string): bigint | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!match) return null;

  const [, sign, whole, fraction = ''] = match;
  return BigInt(`${sign}${whole}${fraction.padEnd(2, '0').slice(0, 2)}`);
}

export function fromMinorUnits(minorUnits: bigint | number): string {
  const value = typeof minorUnits === 'bigint' ? minorUnits : BigInt(Math.round(minorUnits));
  const sign = value < 0n ? '-' : '';
  const digits = (value < 0n ? -value : value).toString().padStart(3, '0');

  return `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/**
 * Totals grouped by the currency they were paid in, summed exactly.
 *
 * A behavioural mirror of `totalByCurrency` in
 * `apps/api/src/services/expenses-rules.ts`: same BigInt accumulation, same
 * trimmed-uppercase keys, same alphabetical order. The offline store recomputes
 * totals with this after a mutation the API never saw, so any drift between the
 * two implementations would surface as a screen that disagrees with itself the
 * moment the traveller loses signal.
 */
export function sumByCurrency(values: readonly CurrencyAmount[]): CurrencyAmount[] {
  const totals = new Map<string, bigint>();

  for (const value of values) {
    const currencyCode = value.currencyCode.trim().toUpperCase();
    const minorUnits = toMinorUnits(value.amount);
    if (!currencyCode || minorUnits === null) continue;
    totals.set(currencyCode, (totals.get(currencyCode) ?? 0n) + minorUnits);
  }

  return [...totals.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([currencyCode, minorUnits]) => ({ amount: fromMinorUnits(minorUnits), currencyCode }));
}

type CurrencyFormatOptions = { display?: 'code' | 'narrowSymbol' };

/**
 * One money formatter for the whole app.
 *
 * `currencyDisplay: 'code'` is the default because a trip spans currencies whose
 * symbols collide - S$, NZ$ and US$ all narrow to "$" - and a total the
 * traveller cannot attribute to a currency is worse than a longer one.
 *
 * An unknown three-letter code makes `Intl` throw, so the fallback is part of
 * the contract: one malformed row must never blank a screen.
 */
export function formatCurrencyAmount(
  locale: string,
  amount: number | string,
  currencyCode: string,
  options: CurrencyFormatOptions = {},
): string {
  const value = typeof amount === 'string' ? Number(amount) : amount;

  try {
    return new Intl.NumberFormat(locale, {
      currency: currencyCode,
      currencyDisplay: options.display ?? 'code',
      style: 'currency',
    }).format(value);
  } catch {
    return `${currencyCode} ${amount}`;
  }
}

/**
 * The same text as `formatCurrencyAmount`, in pieces, so a surface can set the
 * currency apart from the figure. The locale still decides the order - the code
 * leads in some and trails in others - so nothing is rebuilt by hand.
 */
export function formatCurrencyAmountParts(
  locale: string,
  amount: number | string,
  currencyCode: string,
): Array<{ currency: boolean; value: string }> {
  const value = typeof amount === 'string' ? Number(amount) : amount;
  try {
    return new Intl.NumberFormat(locale, {
      currency: currencyCode,
      currencyDisplay: 'code',
      style: 'currency',
    })
      .formatToParts(value)
      .map((part) => ({ currency: part.type === 'currency', value: part.value }));
  } catch {
    return [
      { currency: true, value: currencyCode },
      { currency: false, value: ` ${amount}` },
    ];
  }
}

export function formatMinorUnits(
  locale: string,
  minorUnits: number,
  currencyCode: string,
  options: CurrencyFormatOptions = {},
): string {
  return formatCurrencyAmount(locale, minorUnits / MINOR_UNIT_SCALE, currencyCode, options);
}
