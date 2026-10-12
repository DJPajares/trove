'use client';

import { Check, Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, type ReactNode } from 'react';

import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeading } from '@/components/ui/sheet';
import type { CurrencyMetadata } from '@/lib/currency/api';
import { countriesUsingCurrency } from '@/lib/currency/country-currency';
import { isCurrencyCode } from '@/lib/currency/recent-pairs';
import { cn } from '@/lib/utils';

export type TripCurrencySuggestion = { code: string; meta: string };

type CurrencyPickerSheetProps = {
  cached: boolean;
  currencies: readonly CurrencyMetadata[];
  homeCurrency: string | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (code: string) => void;
  open: boolean;
  recent: readonly string[];
  selected: string;
  title: string;
  tripSuggestions: readonly TripCurrencySuggestion[];
};

/**
 * Choosing a currency: the trips ahead first, then home and recent ones, then
 * everything. Search matches a code, a name or a country that spends it, so
 * "Japan" finds the yen. Offline with no saved list, any three-letter code
 * still works.
 */
export function CurrencyPickerSheet({
  cached,
  currencies,
  homeCurrency,
  onOpenChange,
  onSelect,
  open,
  recent,
  selected,
  title,
  tripSuggestions,
}: Readonly<CurrencyPickerSheetProps>) {
  const t = useTranslations('currency.picker');
  const locale = useLocale();
  const [query, setQuery] = useState('');
  const names = useMemo(
    () => new Map(currencies.map((currency) => [currency.code, currency.name])),
    [currencies],
  );
  // Country names are only worth building once someone searches.
  const countryNames = useMemo(() => {
    if (!query.trim()) return null;
    let regions: Intl.DisplayNames | null = null;
    try {
      regions = new Intl.DisplayNames(locale, { type: 'region' });
    } catch {
      return null;
    }
    return new Map(
      currencies.map((currency) => [
        currency.code,
        countriesUsingCurrency(currency.code)
          .map((country) => regions?.of(country) ?? '')
          .join(' ')
          .toLocaleLowerCase(locale),
      ]),
    );
  }, [currencies, locale, query]);

  const choose = (code: string) => {
    onSelect(code);
    onOpenChange(false);
    setQuery('');
  };
  const row = (code: string, meta?: string, tone: 'dark' | 'soft' | 'plain' = 'plain') => (
    <CurrencyRow
      code={code}
      key={code}
      meta={meta}
      name={names.get(code) ?? code}
      onSelect={choose}
      selected={code === selected}
      tone={tone}
    />
  );

  const needle = query.trim().toLocaleLowerCase(locale);
  const matches = needle
    ? currencies.filter(
        (currency) =>
          currency.code.toLowerCase().includes(needle) ||
          currency.name.toLocaleLowerCase(locale).includes(needle) ||
          Boolean(countryNames?.get(currency.code)?.includes(needle)),
      )
    : [];
  const typedCode = query.trim().toUpperCase();
  const tripCodes = new Set(tripSuggestions.map((entry) => entry.code));
  const homeAndRecent = [...new Set([...(homeCurrency ? [homeCurrency] : []), ...recent])].filter(
    (code) => !tripCodes.has(code),
  );

  return (
    <Sheet
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setQuery('');
      }}
      open={open}
    >
      <SheetContent className="h-[min(44rem,90dvh)] w-full gap-0 md:h-full" closeLabel={t('close')}>
        <SheetHeading title={title} />
        <label className="relative mx-5 mt-4 mb-1 block">
          <span className="sr-only">{t('searchLabel')}</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            autoComplete="off"
            className="h-12 rounded-[var(--radius-lg)] bg-surface-sunken pl-10 text-base md:text-base [&::-webkit-search-cancel-button]:hidden"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchPlaceholder')}
            type="search"
            value={query}
          />
        </label>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
          {needle ? (
            <PickerGroup label={t('results')}>
              {matches.map((currency) => row(currency.code))}
              {!matches.length ? (
                isCurrencyCode(typedCode) ? (
                  row(typedCode, t('useCode', { code: typedCode }))
                ) : (
                  <p className="px-3 py-4 text-sm text-muted-foreground">
                    {t('noMatches', { query: query.trim() })}
                  </p>
                )
              ) : null}
            </PickerGroup>
          ) : (
            <>
              {tripSuggestions.length ? (
                <PickerGroup label={t('trips')}>
                  {tripSuggestions.map((entry) => row(entry.code, entry.meta, 'dark'))}
                </PickerGroup>
              ) : null}
              {homeAndRecent.length ? (
                <PickerGroup label={t('homeAndRecent')}>
                  {homeAndRecent.map((code) =>
                    row(code, code === homeCurrency ? t('home') : undefined, 'soft'),
                  )}
                </PickerGroup>
              ) : null}
              {currencies.length ? (
                <PickerGroup label={t('all')}>
                  {currencies.map((currency) => row(currency.code))}
                </PickerGroup>
              ) : null}
              {cached ? (
                <p className="px-3 pt-4 text-xs text-muted-foreground">{t('listCached')}</p>
              ) : null}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PickerGroup({ children, label }: Readonly<{ children: ReactNode; label: string }>) {
  return (
    <section aria-label={label} className="pt-3">
      <h3 className="px-3 pb-1 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {label}
      </h3>
      <ul className="space-y-0.5">{children}</ul>
    </section>
  );
}

function CurrencyRow({
  code,
  meta,
  name,
  onSelect,
  selected,
  tone,
}: Readonly<{
  code: string;
  meta?: string;
  name: string;
  onSelect: (code: string) => void;
  selected: boolean;
  tone: 'dark' | 'soft' | 'plain';
}>) {
  return (
    <li>
      <button
        aria-pressed={selected}
        className={cn(
          'flex min-h-14 w-full items-center gap-3 rounded-[var(--radius-lg)] px-3 py-2 text-left outline-none transition-colors duration-[var(--motion-standard)] hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40',
          selected && 'bg-surface-tint',
        )}
        onClick={() => onSelect(code)}
        type="button"
      >
        <CurrencyBadge code={code} tone={tone} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{name}</span>
          {meta ? (
            <span className="block truncate text-sm text-muted-foreground">{meta}</span>
          ) : null}
        </span>
        {selected ? <Check aria-hidden="true" className="size-5 shrink-0 text-brand" /> : null}
      </button>
    </li>
  );
}

/** The three letters, set as a small tile: the shape the converter's buttons share. */
export function CurrencyBadge({
  className,
  code,
  tone = 'plain',
}: Readonly<{ className?: string; code: string; tone?: 'dark' | 'soft' | 'plain' }>) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-10 shrink-0 place-items-center rounded-[var(--radius-md)] text-xs font-bold tracking-[0.02em]',
        tone === 'dark' && 'bg-score-media-background text-score-media-brand',
        tone === 'soft' && 'bg-secondary text-secondary-foreground',
        tone === 'plain' && 'border border-border text-foreground',
        className,
      )}
    >
      {code}
    </span>
  );
}
