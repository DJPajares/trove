'use client';

import { ArrowLeftRight, CircleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { CurrencyCombobox, useCurrencyMetadata } from '@/components/currency-combobox';
import { MoneyInput } from '@/components/money-input';
import { PageHeader } from '@/components/page-header';
import { usePreferences } from '@/components/preferences-provider';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import {
  convertCurrencyAmount,
  deriveRateFromBoard,
  getRateBoardWithCache,
  type CachedCurrencyRateBoard,
} from '@/lib/currency/api';

type BoardState = {
  board: CachedCurrencyRateBoard | null;
  status: 'loading' | 'ready' | 'unavailable';
};

type CurrencyPair = { source: string; target: string };

/**
 * Shared the same way the currency list is, so a remount — or React's
 * development double-effect — reuses one request rather than issuing another.
 */
let boardPromise: ReturnType<typeof getRateBoardWithCache> | null = null;

function loadRateBoard() {
  boardPromise ??= getRateBoardWithCache().catch((error: unknown) => {
    boardPromise = null;
    throw error;
  });
  return boardPromise;
}

const recentPairsKey = 'trove:currency-recent-pairs:v1';
const maxRecentPairs = 4;

function normalizeCurrencyCode(value: string) {
  return value.trim().toUpperCase();
}

function isCurrencyCode(value: string) {
  return /^[A-Z]{3}$/.test(value);
}

function validAmount(value: string) {
  return /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value);
}

function formatAmount(locale: string, amount: string, currencyCode: string) {
  try {
    return new Intl.NumberFormat(locale, {
      currency: currencyCode,
      currencyDisplay: 'code',
      style: 'currency',
    }).format(Number(amount));
  } catch {
    return `${currencyCode} ${amount}`;
  }
}

function readRecentPairs(): CurrencyPair[] {
  if (typeof window === 'undefined') return [];

  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(recentPairsKey) ?? 'null');
    if (!Array.isArray(value)) return [];

    return value
      .filter(
        (pair): pair is CurrencyPair =>
          Boolean(pair) &&
          typeof pair === 'object' &&
          isCurrencyCode(String((pair as CurrencyPair).source)) &&
          isCurrencyCode(String((pair as CurrencyPair).target)),
      )
      .slice(0, maxRecentPairs);
  } catch {
    return [];
  }
}

function writeRecentPairs(pairs: CurrencyPair[]) {
  try {
    window.localStorage.setItem(recentPairsKey, JSON.stringify(pairs));
  } catch {
    // Private browsing or a full quota should not break the converter.
  }
}

export function CurrencyConverter() {
  const t = useTranslations('currency');
  const locale = useLocale();
  const { preferredCurrency, status: preferencesStatus } = usePreferences();
  const currencyMetadata = useCurrencyMetadata();
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState('USD');
  const [target, setTarget] = useState('');
  const [recentPairs, setRecentPairs] = useState<CurrencyPair[]>([]);
  const [{ board, status: boardStatus }, setBoardState] = useState<BoardState>({
    board: null,
    status: 'loading',
  });

  // The whole day's board arrives once, so every later change is arithmetic:
  // no request per keystroke, and the page keeps working offline.
  useEffect(() => {
    let active = true;
    void loadRateBoard()
      .then((next) => {
        if (active) setBoardState({ board: next, status: 'ready' });
      })
      .catch(() => {
        if (active) setBoardState({ board: null, status: 'unavailable' });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (preferencesStatus !== 'loading') {
      setTarget((current) => current || preferredCurrency || 'EUR');
    }
  }, [preferredCurrency, preferencesStatus]);

  useEffect(() => {
    setRecentPairs(readRecentPairs());
  }, []);

  const currencyNames = useMemo(
    () => new Map(currencyMetadata.currencies.map((currency) => [currency.code, currency.name])),
    [currencyMetadata.currencies],
  );
  const sourceCode = normalizeCurrencyCode(source);
  const targetCode = normalizeCurrencyCode(target);
  const samePair = sourceCode === targetCode && isCurrencyCode(sourceCode);
  const rate = useMemo(
    () =>
      board && isCurrencyCode(sourceCode) && isCurrencyCode(targetCode) && !samePair
        ? deriveRateFromBoard(board, sourceCode, targetCode)
        : null,
    [board, samePair, sourceCode, targetCode],
  );

  const rememberPair = useCallback((pair: CurrencyPair) => {
    setRecentPairs((current) => {
      const next = [
        pair,
        ...current.filter((entry) => entry.source !== pair.source || entry.target !== pair.target),
      ].slice(0, maxRecentPairs);
      writeRecentPairs(next);
      return next;
    });
  }, []);

  // A pair is only worth remembering once it has actually produced a value,
  // which keeps half-typed codes out of the quick picks.
  useEffect(() => {
    if (rate) rememberPair({ source: rate.base, target: rate.quote });
  }, [rate, rememberPair]);

  function swapCurrencies() {
    setSource(targetCode);
    setTarget(sourceCode);
  }

  function applyPair(pair: CurrencyPair) {
    setSource(pair.source);
    setTarget(pair.target);
  }

  const convertedAmount = validAmount(amount)
    ? samePair
      ? amount
      : rate && convertCurrencyAmount(amount, rate.rate)
    : null;
  const rateDate = rate
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
        new Date(`${rate.date}T00:00:00`),
      )
    : null;
  const refreshedAt = rate
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(
        new Date(rate.fetchedAt),
      )
    : null;
  const rateDetail =
    rate && rateDate && refreshedAt
      ? `${t('rateDetails', {
          date: rateDate,
          rate: rate.rate.toLocaleString(locale, { maximumSignificantDigits: 5 }),
          source: rate.base,
          target: rate.quote,
        })} · ${
          rate.source === 'cache'
            ? t('cachedRate', { refreshedAt })
            : t('liveRate', { refreshedAt })
        }`
      : null;
  const pairUnavailable =
    boardStatus === 'ready' &&
    !rate &&
    !samePair &&
    isCurrencyCode(sourceCode) &&
    isCurrencyCode(targetCode);

  const detail =
    boardStatus === 'loading'
      ? t('loadingRates')
      : pairUnavailable
        ? t('pairUnavailable')
        : samePair
          ? t('sameCurrency')
          : rateDetail;

  return (
    <section className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader description={t('description')} title={t('title')} />

      {boardStatus === 'unavailable' ? (
        <Alert role="alert" variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{t('conversionUnavailable')}</AlertDescription>
        </Alert>
      ) : null}

      <div className="overflow-hidden rounded-[var(--radius-xl)] border border-border-subtle bg-card shadow-[var(--shadow-surface)]">
        <div className="space-y-6 p-5 sm:p-6">
          <FieldGroup className="gap-6">
            <Field className="w-1/2">
              <FieldLabel htmlFor="currency-amount">{t('amount')}</FieldLabel>
              <MoneyInput
                autoComplete="off"
                id="currency-amount"
                onValueChange={setAmount}
                placeholder={t('amountPlaceholder')}
                value={amount}
              />
            </Field>

            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-3 sm:gap-4">
              <Field>
                <FieldLabel htmlFor="currency-source">{t('from')}</FieldLabel>
                <CurrencyCombobox
                  aria-describedby="currency-source-description"
                  aria-label={t('from')}
                  id="currency-source"
                  onValueChange={(value) => setSource(value.toUpperCase())}
                  placeholder={t('currencyPlaceholder')}
                  value={sourceCode}
                />
                <FieldDescription id="currency-source-description">
                  {currencyNames.get(sourceCode) ?? t('currencyCodeHint')}
                </FieldDescription>
              </Field>

              <Button
                aria-label={t('swap')}
                className="mt-7 w-11 shrink-0 rounded-full"
                disabled={!sourceCode && !targetCode}
                onClick={swapCurrencies}
                size="icon"
                type="button"
                variant="outline"
              >
                <ArrowLeftRight aria-hidden="true" />
              </Button>

              <Field>
                <FieldLabel htmlFor="currency-target">{t('to')}</FieldLabel>
                <CurrencyCombobox
                  aria-describedby="currency-target-description"
                  aria-label={t('to')}
                  id="currency-target"
                  onValueChange={(value) => setTarget(value.toUpperCase())}
                  placeholder={t('currencyPlaceholder')}
                  value={targetCode}
                />
                <FieldDescription id="currency-target-description">
                  {currencyNames.get(targetCode) ?? t('currencyCodeHint')}
                </FieldDescription>
              </Field>
            </div>
          </FieldGroup>

          {currencyMetadata.source === 'cache' ? (
            <p className="text-sm leading-5 text-muted-foreground">{t('currencyListCached')}</p>
          ) : null}
        </div>

        <div
          aria-live="polite"
          className="min-h-[7.5rem] border-t border-border-subtle bg-muted/35 px-5 py-5 sm:px-6"
        >
          <p className="text-sm font-medium text-muted-foreground">{t('result')}</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums text-foreground">
            {convertedAmount ? formatAmount(locale, convertedAmount, targetCode) : '—'}
          </p>
          {detail ? <p className="mt-2 text-sm leading-5 text-muted-foreground">{detail}</p> : null}
        </div>
      </div>

      {recentPairs.length > 1 ? (
        <div className="space-y-3">
          <p className="text-sm font-medium text-muted-foreground">{t('recentPairs')}</p>
          <div className="flex flex-wrap gap-2">
            {recentPairs.map((pair) => (
              <Button
                aria-label={t('usePair', { source: pair.source, target: pair.target })}
                className="rounded-full tabular-nums"
                key={`${pair.source}-${pair.target}`}
                onClick={() => applyPair(pair)}
                size="sm"
                type="button"
                variant="outline"
              >
                {pair.source} → {pair.target}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      <p className="text-sm text-muted-foreground">{t('referenceOnly')}</p>
    </section>
  );
}
