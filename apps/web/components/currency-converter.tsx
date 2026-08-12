'use client';

import { Combobox } from '@base-ui/react/combobox';
import { ArrowLeftRight, Check, ChevronDown, CircleAlert, RefreshCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  convertCurrencyAmount,
  getCurrenciesWithCache,
  getCurrencyRate,
  type CachedCurrencyRate,
  type CurrencyMetadata,
} from '@/lib/currency/api';
import { fetchProfile } from '@/lib/profile/api';

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

type CurrencyPickerProps = {
  code: string;
  currencies: CurrencyMetadata[];
  description: string;
  descriptionId: string;
  id: string;
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder: string;
  searchUnavailable: string;
};

function CurrencyPicker({
  code,
  currencies,
  description,
  descriptionId,
  id,
  label,
  onChange,
  placeholder,
  searchPlaceholder,
  searchUnavailable,
}: Readonly<CurrencyPickerProps>) {
  const selected = currencies.find((currency) => currency.code === code) ?? null;

  if (!currencies.length) {
    return (
      <Field>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Input
          aria-describedby={descriptionId}
          autoCapitalize="characters"
          autoComplete="off"
          className="uppercase"
          id={id}
          maxLength={3}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          placeholder={placeholder}
          value={code}
        />
        <FieldDescription id={descriptionId}>{description}</FieldDescription>
      </Field>
    );
  }

  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Combobox.Root
        itemToStringLabel={(currency) => `${currency.code} ${currency.name}`}
        items={currencies}
        onValueChange={(value) => onChange(value?.code ?? '')}
        value={selected}
      >
        <Combobox.InputGroup className="relative flex w-full">
          <Combobox.Input
            aria-describedby={descriptionId}
            className="h-11 w-full min-w-0 rounded-[var(--radius-md)] border border-input bg-background px-3 py-2 pr-11 text-base shadow-[var(--shadow-control)] transition-[color,background-color,border-color,box-shadow] duration-[var(--motion-standard)] outline-none placeholder:text-muted-foreground hover:border-border-strong focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 md:text-sm dark:bg-input/20"
            id={id}
            placeholder={placeholder}
          />
          <Combobox.Trigger
            aria-label={label}
            className="absolute inset-y-1 right-1 flex size-9 items-center justify-center rounded-[var(--radius-sm)] text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            <ChevronDown aria-hidden="true" className="size-4" />
          </Combobox.Trigger>
        </Combobox.InputGroup>
        <Combobox.Portal>
          <Combobox.Positioner align="start" className="z-(--layer-overlay)" sideOffset={6}>
            <Combobox.Popup
              aria-label={label}
              className="w-(--anchor-width) min-w-64 overflow-hidden rounded-[var(--radius-md)] border border-border bg-popover p-1 text-popover-foreground shadow-[var(--shadow-overlay)] outline-none"
            >
              <Combobox.Input
                className="mb-1 h-10 w-full rounded-[var(--radius-sm)] border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
                placeholder={searchPlaceholder}
              />
              <Combobox.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
                {searchUnavailable}
              </Combobox.Empty>
              <Combobox.List className="max-h-64 overflow-y-auto">
                {(currency: CurrencyMetadata) => (
                  <Combobox.Item
                    className="relative flex min-h-10 w-full cursor-default items-center gap-3 rounded-[var(--radius-sm)] py-2 pr-9 pl-3 text-sm outline-none select-none data-highlighted:bg-secondary data-highlighted:text-secondary-foreground"
                    key={currency.code}
                    value={currency}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{currency.code}</span>
                      <span className="ml-2 text-muted-foreground data-highlighted:text-secondary-foreground/80">
                        {currency.name}
                      </span>
                    </span>
                    <Combobox.ItemIndicator className="absolute right-3 flex size-4 items-center justify-center">
                      <Check aria-hidden="true" className="size-4 text-primary" />
                    </Combobox.ItemIndicator>
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
      <FieldDescription id={descriptionId}>{description}</FieldDescription>
    </Field>
  );
}

export function CurrencyConverter() {
  const t = useTranslations('currency');
  const locale = useLocale();
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState('USD');
  const [target, setTarget] = useState('');
  const [currencies, setCurrencies] = useState<CurrencyMetadata[]>([]);
  const [currenciesFromCache, setCurrenciesFromCache] = useState(false);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);

  useEffect(() => {
    let active = true;

    void Promise.allSettled([fetchProfile(), getCurrenciesWithCache()]).then((results) => {
      if (!active) return;

      const profileResult = results[0];
      const currenciesResult = results[1];

      if (profileResult.status === 'fulfilled') {
        const homeCurrencyCode = profileResult.value.profile.homeCurrencyCode;
        setTarget((current) => current || homeCurrencyCode || 'EUR');
      } else {
        setTarget((current) => current || 'EUR');
      }

      if (currenciesResult.status === 'fulfilled') {
        setCurrencies(currenciesResult.value.currencies);
        setCurrenciesFromCache(currenciesResult.value.source === 'cache');
      }
    });

    return () => {
      active = false;
    };
  }, []);

  const currencyNames = useMemo(
    () => new Map(currencies.map((currency) => [currency.code, currency.name])),
    [currencies],
  );
  const sourceCode = normalizeCurrencyCode(source);
  const targetCode = normalizeCurrencyCode(target);
  const sourceDescription = currencyNames.get(sourceCode);
  const targetDescription = currencyNames.get(targetCode);

  function updateSource(value: string) {
    setSource(value.toUpperCase());
    setError(null);
    setResult(null);
  }

  function updateTarget(value: string) {
    setTarget(value.toUpperCase());
    setError(null);
    setResult(null);
  }

  function swapCurrencies() {
    setSource(targetCode);
    setTarget(sourceCode);
    setError(null);
    setResult(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validAmount(amount) || !/^[A-Z]{3}$/.test(sourceCode) || !/^[A-Z]{3}$/.test(targetCode)) {
      setError(t('invalidInput'));
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
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
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
              <Input
                autoComplete="off"
                id="currency-amount"
                inputMode="decimal"
                onChange={(event) => {
                  setAmount(event.target.value);
                  setError(null);
                  setResult(null);
                }}
                placeholder={t('amountPlaceholder')}
                value={amount}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-end">
              <CurrencyPicker
                code={sourceCode}
                currencies={currencies}
                description={sourceDescription ?? t('currencyCodeHint')}
                descriptionId="currency-source-description"
                id="currency-source"
                label={t('from')}
                onChange={updateSource}
                placeholder={t('currencyPlaceholder')}
                searchPlaceholder={t('searchPlaceholder')}
                searchUnavailable={t('searchUnavailable')}
              />
              <Button
                aria-label={t('swap')}
                className="sm:mb-[1.625rem]"
                disabled={!sourceCode || !targetCode}
                onClick={swapCurrencies}
                size="icon"
                type="button"
                variant="outline"
              >
                <ArrowLeftRight aria-hidden="true" />
              </Button>
              <CurrencyPicker
                code={targetCode}
                currencies={currencies}
                description={targetDescription ?? t('currencyCodeHint')}
                descriptionId="currency-target-description"
                id="currency-target"
                label={t('to')}
                onChange={updateTarget}
                placeholder={t('currencyPlaceholder')}
                searchPlaceholder={t('searchPlaceholder')}
                searchUnavailable={t('searchUnavailable')}
              />
            </div>
          </FieldGroup>
          {currenciesFromCache ? (
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
      </CardContent>
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
    </Card>
  );
}
