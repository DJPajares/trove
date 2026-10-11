'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowDownUp, ChevronDown, CircleAlert, Clock, Plane } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { CurrencyBadge, CurrencyPickerSheet } from '@/components/currency/currency-picker-sheet';
import { useCurrencyMetadata } from '@/components/currency-combobox';
import { MoneyInput } from '@/components/money-input';
import { PageHeader } from '@/components/page-header';
import { usePreferences } from '@/components/preferences-provider';
import { localToday } from '@/components/saved/saved-ready-for-trip';
import { ToolsBackLink } from '@/components/tools/tools-back-link';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useRateBoard } from '@/hooks/use-rate-board';
import { deriveRateFromBoard, isSavedRateStale } from '@/lib/currency/api';
import { priceTagCurrency, priceTagSteps } from '@/lib/currency/price-tags';
import {
  isCurrencyCode,
  MAX_RECENT_CURRENCY_PAIRS,
  readRecentCurrencyPairs,
  writeRecentCurrencyPairs,
  type CurrencyPair,
} from '@/lib/currency/recent-pairs';
import { queryKeys } from '@/lib/query/keys';
import { nextTripForTools, tripCurrencySuggestions, tripLocalCurrency } from '@/lib/tools/shelf';
import { fetchTrips } from '@/lib/trips/api';
import { cn } from '@/lib/utils';

/** Used when the traveller has no home currency set. */
const FALLBACK_HOME = 'USD';
/** Shown (and converted, quietly) until the traveller types their own amount. */
const SAMPLE_AMOUNT = '100';

function validAmount(value: string) {
  return /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value);
}

/** The minor units a currency is written with: none for yen, two for euros. */
function currencyDigits(code: string) {
  try {
    return (
      new Intl.NumberFormat('en', { currency: code, style: 'currency' }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** A bare amount: the currency is named beside it, so no symbol competes. */
function formatAmount(locale: string, value: number, code: string) {
  const digits = currencyDigits(code);
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

/** A price tag: symbol and amount, whole where the amount is whole. */
function formatTag(locale: string, value: number, code: string, whole: boolean) {
  const digits = whole ? 0 : currencyDigits(code);
  try {
    return new Intl.NumberFormat(locale, {
      currency: code,
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
      style: 'currency',
    }).format(value);
  } catch {
    return `${code} ${value.toFixed(digits)}`;
  }
}

/**
 * The converter as a travel tool: the amount and its value are the page, and
 * everything else - the rate, its age, the disclaimer - steps back. Pairs come
 * to the traveller (the next trip's first, then recent ones), and a ladder of
 * round local amounts reads shelf prices without typing. Reference only: it
 * never records or rewrites anything (PRD 22.3).
 */
export function CurrencyConverter() {
  const t = useTranslations('currency');
  const locale = useLocale();
  const { preferredCurrency, status: preferencesStatus } = usePreferences();
  const home = preferredCurrency ?? FALLBACK_HOME;
  const currencyMetadata = useCurrencyMetadata();
  const trips = useQuery({ queryFn: fetchTrips, queryKey: queryKeys.trips() });
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [picking, setPicking] = useState<'source' | 'target' | null>(null);
  const [recentPairs, setRecentPairs] = useState<CurrencyPair[]>([]);
  // The whole day's board arrives once, so every later change is arithmetic:
  // no request per keystroke, and the page keeps working offline.
  const { board, status: boardStatus } = useRateBoard();

  const today = localToday();
  const tripList = useMemo(() => trips.data?.trips ?? [], [trips.data]);
  const nextTrip = useMemo(() => nextTripForTools(tripList, today), [today, tripList]);
  const nextTripCurrency = nextTrip ? tripLocalCurrency(nextTrip, home) : null;
  const tripPair = nextTripCurrency ? { source: home, target: nextTripCurrency } : null;

  // Start where the traveller most likely wants to be: the pair a link asked
  // for (`?from=EUR&to=JPY`), else the last pair they used, else home against
  // the next trip's currency. Decided once; after that the fields are theirs.
  const ready = preferencesStatus !== 'loading' && !(trips.isPending && trips.isFetching);
  useEffect(() => {
    if (!ready || source) return;
    const recent = readRecentCurrencyPairs();
    setRecentPairs(recent);
    const params = new URLSearchParams(window.location.search);
    const from = (params.get('from') ?? '').trim().toUpperCase();
    const to = (params.get('to') ?? '').trim().toUpperCase();
    const start =
      isCurrencyCode(from) && isCurrencyCode(to)
        ? { source: from, target: to }
        : (recent[0] ?? tripPair ?? { source: home, target: home === 'EUR' ? 'USD' : 'EUR' });
    setSource(start.source);
    setTarget(start.target);
  }, [home, ready, source, tripPair]);

  const names = useMemo(
    () => new Map(currencyMetadata.currencies.map((currency) => [currency.code, currency.name])),
    [currencyMetadata.currencies],
  );
  const nameOf = (code: string) => names.get(code) ?? code;
  const samePair = source === target && isCurrencyCode(source);
  const rate = useMemo(
    () =>
      board && isCurrencyCode(source) && isCurrencyCode(target) && source !== target
        ? deriveRateFromBoard(board, source, target)
        : null,
    [board, source, target],
  );

  const rememberPair = useCallback((pair: CurrencyPair) => {
    setRecentPairs((current) => {
      const next = [
        pair,
        ...current.filter((entry) => entry.source !== pair.source || entry.target !== pair.target),
      ].slice(0, MAX_RECENT_CURRENCY_PAIRS);
      writeRecentCurrencyPairs(next);
      return next;
    });
  }, []);

  // A pair is only worth remembering once it has actually produced a value.
  useEffect(() => {
    if (rate) rememberPair({ source: rate.base, target: rate.quote });
  }, [rate, rememberPair]);

  const shownAmount = amount || SAMPLE_AMOUNT;
  const converted = validAmount(shownAmount)
    ? samePair
      ? Number(shownAmount)
      : rate
        ? Number(shownAmount) * rate.rate
        : null
    : null;
  const result = converted === null ? '—' : formatAmount(locale, converted, target);
  const stale = rate ? rate.source === 'cache' && isSavedRateStale(rate.fetchedAt) : false;
  const shortDate = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
  const pairUnavailable =
    boardStatus === 'ready' &&
    !rate &&
    !samePair &&
    isCurrencyCode(source) &&
    isCurrencyCode(target);

  const tags = useMemo(() => {
    if (!rate) return null;
    const local = priceTagCurrency({ source, target }, home);
    const other = local === target ? source : target;
    const localPerOther = local === target ? rate.rate : 1 / rate.rate;
    const steps = priceTagSteps(localPerOther);
    if (!steps.length) return null;
    return {
      local,
      other,
      rows: steps.map((step) => ({
        local: formatTag(locale, step, local, Number.isInteger(step)),
        other: formatTag(locale, step / localPerOther, other, false),
        step,
      })),
    };
  }, [home, locale, rate, source, target]);

  const pairChips = [
    ...(tripPair && nextTrip ? [{ ...tripPair, trip: nextTrip.name }] : []),
    ...recentPairs
      .filter((pair) => pair.source !== tripPair?.source || pair.target !== tripPair?.target)
      .map((pair) => ({ ...pair, trip: null })),
  ].slice(0, MAX_RECENT_CURRENCY_PAIRS + 1);

  const tripSuggestions = tripCurrencySuggestions(tripList, home, today).map((entry) => ({
    code: entry.currency,
    meta: t('picker.tripMeta', {
      date: shortDate.format(new Date(`${entry.trip.startDate}T00:00:00`)),
      trip: entry.trip.name,
    }),
  }));
  const recentCodes = [...new Set(recentPairs.flatMap((pair) => [pair.target, pair.source]))];
  const large = (text: string) =>
    text.length > 10
      ? 'text-[2.5rem] sm:text-[3.25rem] md:text-[3.25rem]'
      : 'text-[3.5rem] sm:text-[4.5rem] md:text-[4.5rem]';

  return (
    <section className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <ToolsBackLink label={t('back')} />
        <PageHeader eyebrow={t('eyebrow')} title={t('title')} titleFont="journal" />
      </div>

      {boardStatus === 'unavailable' ? (
        <Alert role="alert" variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{t('conversionUnavailable')}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,1fr)] lg:items-start">
        <div className="overflow-hidden rounded-[var(--radius-2xl)] border border-border-subtle bg-card shadow-[var(--shadow-surface)]">
          <div className="px-5 pt-3 pb-5 sm:px-7 sm:pt-5 sm:pb-7">
            <CurrencyButton
              code={source}
              label={source ? t('changeFrom', { currency: nameOf(source) }) : t('chooseCurrency')}
              name={source ? nameOf(source) : t('chooseCurrency')}
              onClick={() => setPicking('source')}
              tone="soft"
            />
            <label className="sr-only" htmlFor="currency-amount">
              {t('amountIn', { currency: nameOf(source) })}
            </label>
            <MoneyInput
              autoComplete="off"
              className={cn(
                'mt-1 h-auto rounded-none border-0 bg-transparent px-0 py-1 font-journal leading-none tabular-nums shadow-none placeholder:text-text-subtle hover:border-0 focus-visible:shadow-[inset_0_-2px_0_var(--color-ring)] focus-visible:ring-0 dark:bg-transparent',
                large(amount),
              )}
              id="currency-amount"
              onValueChange={setAmount}
              placeholder={SAMPLE_AMOUNT}
              value={amount}
            />
          </div>

          <div className="relative h-px bg-border-subtle">
            <Button
              aria-label={t('swap')}
              className="absolute top-0 right-5 size-11 -translate-y-1/2 rounded-full bg-card text-brand sm:right-7"
              disabled={!source || !target}
              onClick={() => {
                setSource(target);
                setTarget(source);
              }}
              size="icon"
              type="button"
              variant="outline"
            >
              <ArrowDownUp aria-hidden="true" />
            </Button>
          </div>

          <div className="bg-surface-tint px-5 pt-4 pb-5 sm:px-7 sm:pt-5 sm:pb-6">
            <CurrencyButton
              code={target}
              label={target ? t('changeTo', { currency: nameOf(target) }) : t('chooseCurrency')}
              name={target ? nameOf(target) : t('chooseCurrency')}
              onClick={() => setPicking('target')}
              tone="dark"
            />
            <output
              aria-live="polite"
              className={cn(
                'mt-1 block truncate py-1 font-journal leading-none tabular-nums',
                large(result),
                amount ? 'text-foreground' : 'text-text-subtle',
              )}
              htmlFor="currency-amount"
            >
              <span className="sr-only">{t('convertedValue', { currency: nameOf(target) })}: </span>
              {result}
            </output>
            {boardStatus === 'loading' ? (
              <p className="mt-3 text-sm text-muted-foreground">{t('loadingRates')}</p>
            ) : samePair ? (
              <p className="mt-3 text-sm text-muted-foreground">{t('sameCurrency')}</p>
            ) : pairUnavailable ? (
              <p className="mt-3 text-sm text-muted-foreground">{t('pairUnavailable')}</p>
            ) : rate ? (
              <p
                className={cn(
                  'mt-3 flex items-center gap-2 text-sm',
                  stale
                    ? '-mx-1 rounded-[var(--radius-md)] bg-status-warning/12 px-2.5 py-2 text-status-warning'
                    : 'text-muted-foreground',
                )}
              >
                {stale ? (
                  <Clock aria-hidden="true" className="size-4 shrink-0" />
                ) : (
                  <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-brand" />
                )}
                <span className="min-w-0">
                  <span className={cn('font-semibold', !stale && 'text-foreground')}>
                    {t('rateLine', {
                      rate: rate.rate.toLocaleString(locale, { maximumSignificantDigits: 5 }),
                      source: rate.base,
                      target: rate.quote,
                    })}
                  </span>{' '}
                  ·{' '}
                  {stale
                    ? t('savedRate', { date: shortDate.format(new Date(rate.fetchedAt)) })
                    : t('referenceRate', {
                        date: shortDate.format(new Date(`${rate.date}T00:00:00`)),
                      })}
                </span>
              </p>
            ) : null}
          </div>
        </div>

        <div className="space-y-5">
          {pairChips.length ? (
            <section aria-labelledby="currency-pairs" className="space-y-2">
              <h2
                className="px-1 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase"
                id="currency-pairs"
              >
                {t('pairs')}
              </h2>
              <div className="flex flex-wrap gap-2">
                {pairChips.map((pair) => {
                  const active = pair.source === source && pair.target === target;
                  return (
                    <Button
                      aria-label={t('usePair', { source: pair.source, target: pair.target })}
                      aria-pressed={active}
                      className="h-10 max-w-full rounded-full px-3.5 tabular-nums"
                      key={`${pair.source}-${pair.target}`}
                      onClick={() => {
                        setSource(pair.source);
                        setTarget(pair.target);
                      }}
                      size="sm"
                      type="button"
                      variant={active ? 'default' : 'outline'}
                    >
                      {pair.trip ? <Plane aria-hidden="true" data-icon="inline-start" /> : null}
                      <span className="truncate">
                        {pair.trip
                          ? t('tripPair', { ...pair, trip: pair.trip })
                          : t('pair', { source: pair.source, target: pair.target })}
                      </span>
                    </Button>
                  );
                })}
              </div>
            </section>
          ) : null}

          {tags ? (
            <section
              aria-labelledby="currency-price-tags"
              className="rounded-[var(--radius-xl)] border border-border-subtle bg-card px-4 pt-3.5 pb-1.5 sm:px-5"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-semibold" id="currency-price-tags">
                  {t('priceTags', { currency: tags.local })}
                </h2>
                <span className="text-xs text-muted-foreground">
                  {t('priceTagsHint', { currency: tags.other })}
                </span>
              </div>
              <dl className="mt-1.5 grid grid-cols-3">
                {tags.rows.map((row, index) => (
                  <div
                    className={cn('py-2.5', index < 3 && 'border-b border-border-subtle')}
                    key={row.step}
                  >
                    <dt className="truncate font-semibold tabular-nums">{row.local}</dt>
                    <dd className="truncate text-sm text-muted-foreground tabular-nums">
                      {row.other}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          <p className="px-1 text-xs leading-5 text-muted-foreground">{t('referenceOnly')}</p>
        </div>
      </div>

      <CurrencyPickerSheet
        cached={currencyMetadata.source === 'cache'}
        currencies={currencyMetadata.currencies}
        homeCurrency={preferredCurrency}
        onOpenChange={(open) => !open && setPicking(null)}
        onSelect={(code) => (picking === 'source' ? setSource(code) : setTarget(code))}
        open={picking !== null}
        recent={recentCodes}
        selected={picking === 'source' ? source : target}
        title={picking === 'source' ? t('picker.fromTitle') : t('picker.toTitle')}
        tripSuggestions={tripSuggestions}
      />
    </section>
  );
}

function CurrencyButton({
  code,
  label,
  name,
  onClick,
  tone,
}: Readonly<{
  code: string;
  label: string;
  name: string;
  onClick: () => void;
  tone: 'dark' | 'soft';
}>) {
  return (
    <Button
      aria-label={label}
      className="-ml-1.5 h-auto min-h-11 max-w-full gap-2.5 rounded-[var(--radius-md)] py-1 pr-2.5 pl-1.5 text-base font-semibold"
      onClick={onClick}
      type="button"
      variant="ghost"
    >
      {code ? <CurrencyBadge className="size-9" code={code} tone={tone} /> : null}
      <span className="truncate">{name}</span>
      <ChevronDown aria-hidden="true" className="text-muted-foreground" />
    </Button>
  );
}
