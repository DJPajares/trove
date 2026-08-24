'use client';

import { ArrowLeftRight, CircleAlert, RefreshCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { CurrencyCombobox, useCurrencyMetadata } from '@/components/currency-combobox';
import { EditorialSection } from '@/components/editorial-section';
import { MoneyInput } from '@/components/money-input';
import { usePreferences } from '@/components/preferences-provider';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import {
  convertCurrencyAmount,
  getCurrencyRate,
  type CachedCurrencyRate,
} from '@/lib/currency/api';

type ConversionResult = {
  amount: string;
  rate: CachedCurrencyRate | null;
  source: string;
  target: string;
};

function normalizeCurrencyCode(value: string) {
  return value.trim().toUpperCase();
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

export function CurrencyConverter() {
  const t = useTranslations('currency');
  const locale = useLocale();
  const { preferredCurrency, status: preferencesStatus } = usePreferences();
  const currencyMetadata = useCurrencyMetadata();
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState('USD');
  const [target, setTarget] = useState('');
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);

  useEffect(() => {
    if (preferencesStatus !== 'loading') {
      setTarget((current) => current || preferredCurrency || 'EUR');
    }
  }, [preferredCurrency, preferencesStatus]);

  const currencyNames = useMemo(
    () => new Map(currencyMetadata.currencies.map((currency) => [currency.code, currency.name])),
    [currencyMetadata.currencies],
  );
  const sourceCode = normalizeCurrencyCode(source);
  const targetCode = normalizeCurrencyCode(target);

  function resetResult() {
    setError(null);
    setResult(null);
  }

  function updateAmount(value: string) {
    setAmount(value);
    resetResult();
  }

  function updateSource(value: string) {
    setSource(value.toUpperCase());
    resetResult();
  }

  function updateTarget(value: string) {
    setTarget(value.toUpperCase());
    resetResult();
  }

  function swapCurrencies() {
    setSource(targetCode);
    setTarget(sourceCode);
    resetResult();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validAmount(amount) || !/^[A-Z]{3}$/.test(sourceCode) || !/^[A-Z]{3}$/.test(targetCode)) {
      setError(t('invalidInput'));
      setResult(null);
      return;
    }

    setConverting(true);
    setError(null);
    try {
      if (sourceCode === targetCode) {
        setResult({ amount, rate: null, source: sourceCode, target: targetCode });
        return;
      }

      const rate = await getCurrencyRate(sourceCode, targetCode);
      const convertedAmount = convertCurrencyAmount(amount, rate.rate);
      if (!convertedAmount) throw new Error('invalid_conversion');
      setResult({ amount: convertedAmount, rate, source: sourceCode, target: targetCode });
    } catch {
      setResult(null);
      setError(t('conversionUnavailable'));
    } finally {
      setConverting(false);
    }
  }

  const rateDate = result?.rate
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
        new Date(`${result.rate.date}T00:00:00`),
      )
    : null;
  const refreshedAt = result?.rate
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(
        new Date(result.rate.fetchedAt),
      )
    : null;

  return (
    <EditorialSection description={t('description')} headingLevel={2} title={t('title')}>
      <form className="space-y-5" onSubmit={handleSubmit}>
        {error ? (
          <Alert role="alert" variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <FieldGroup className="gap-5">
          <Field className="max-w-xs">
            <FieldLabel htmlFor="currency-amount">{t('amount')}</FieldLabel>
            <MoneyInput
              autoComplete="off"
              id="currency-amount"
              onValueChange={updateAmount}
              placeholder={t('amountPlaceholder')}
              required
              value={amount}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-end">
            <Field>
              <FieldLabel htmlFor="currency-source">{t('from')}</FieldLabel>
              <CurrencyCombobox
                aria-describedby="currency-source-description"
                aria-label={t('from')}
                id="currency-source"
                onValueChange={updateSource}
                placeholder={t('currencyPlaceholder')}
                required
                value={sourceCode}
              />
              <FieldDescription id="currency-source-description">
                {currencyNames.get(sourceCode) ?? t('currencyCodeHint')}
              </FieldDescription>
            </Field>
            <Button
              className="w-full sm:mb-[1.625rem] sm:w-auto"
              disabled={!sourceCode || !targetCode}
              onClick={swapCurrencies}
              type="button"
              variant="outline"
            >
              <ArrowLeftRight aria-hidden="true" data-icon="inline-start" />
              {t('swap')}
            </Button>
            <Field>
              <FieldLabel htmlFor="currency-target">{t('to')}</FieldLabel>
              <CurrencyCombobox
                aria-describedby="currency-target-description"
                aria-label={t('to')}
                id="currency-target"
                onValueChange={updateTarget}
                placeholder={t('currencyPlaceholder')}
                required
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
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={converting} type="submit">
            <RefreshCw aria-hidden="true" data-icon="inline-start" />
            {converting ? t('converting') : t('convert')}
          </Button>
          <p className="text-sm text-muted-foreground">{t('referenceOnly')}</p>
        </div>
      </form>
      {result ? (
        <div aria-live="polite" className="border-t border-border bg-muted/35 px-5 py-4 sm:px-6">
          <p className="text-sm font-medium text-muted-foreground">{t('result')}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
            {formatAmount(locale, result.amount, result.target)}
          </p>
          {result.rate && rateDate && refreshedAt ? (
            <p className="mt-2 text-sm leading-5 text-muted-foreground">
              {t('rateDetails', {
                date: rateDate,
                rate: result.rate.rate.toLocaleString(locale, { maximumFractionDigits: 6 }),
                source: result.source,
                target: result.target,
              })}{' '}
              {result.rate.source === 'cache'
                ? t('cachedRate', { refreshedAt })
                : t('liveRate', { refreshedAt })}
            </p>
          ) : (
            <p className="mt-2 text-sm leading-5 text-muted-foreground">{t('sameCurrency')}</p>
          )}
        </div>
      ) : null}
    </EditorialSection>
  );
}
