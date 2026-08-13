'use client';

import { Combobox } from '@base-ui/react/combobox';
import { Check, ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type ComponentProps } from 'react';

import { Input } from '@/components/ui/input';
import { getCurrenciesWithCache, type CurrencyMetadata } from '@/lib/currency/api';
import { cn } from '@/lib/utils';

type CurrencyMetadataState = {
  currencies: CurrencyMetadata[];
  source: 'cache' | 'live' | 'unavailable';
  status: 'loading' | 'ready';
};

let currenciesPromise: ReturnType<typeof getCurrenciesWithCache> | null = null;

function loadCurrencies() {
  currenciesPromise ??= getCurrenciesWithCache().catch((error) => {
    currenciesPromise = null;
    throw error;
  });
  return currenciesPromise;
}

export function useCurrencyMetadata(): CurrencyMetadataState {
  const [state, setState] = useState<CurrencyMetadataState>({
    currencies: [],
    source: 'unavailable',
    status: 'loading',
  });

  useEffect(() => {
    let active = true;
    void loadCurrencies()
      .then((result) => {
        if (active) setState({ ...result, status: 'ready' });
      })
      .catch(() => {
        if (active) setState({ currencies: [], source: 'unavailable', status: 'ready' });
      });
    return () => {
      active = false;
    };
  }, []);

  return state;
}

type CurrencyComboboxProps = {
  'aria-describedby'?: string;
  'aria-invalid'?: ComponentProps<'input'>['aria-invalid'];
  'aria-label': string;
  className?: string;
  disabled?: boolean;
  id: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  value: string;
};

export function CurrencyCombobox({
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  'aria-label': ariaLabel,
  className,
  disabled,
  id,
  onValueChange,
  placeholder,
  required,
  value,
}: Readonly<CurrencyComboboxProps>) {
  const t = useTranslations('travelInputs.currency');
  const { currencies, status } = useCurrencyMetadata();
  const code = value.trim().toUpperCase();
  const selected = useMemo(
    () => currencies.find((currency) => currency.code === code) ?? null,
    [code, currencies],
  );

  if (status === 'ready' && !currencies.length) {
    return (
      <Input
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid || (Boolean(code) && !/^[A-Z]{3}$/.test(code)) || undefined}
        aria-label={ariaLabel}
        autoCapitalize="characters"
        autoComplete="off"
        className={cn('uppercase', className)}
        disabled={disabled}
        id={id}
        maxLength={3}
        onChange={(event) => onValueChange(event.target.value.toUpperCase())}
        pattern="[A-Za-z]{3}"
        placeholder={placeholder}
        required={required}
        value={code}
      />
    );
  }

  return (
    <Combobox.Root
      disabled={disabled}
      itemToStringLabel={(currency) => `${currency.code} ${currency.name}`}
      items={currencies}
      onValueChange={(currency) => onValueChange(currency?.code ?? '')}
      value={selected}
    >
      <Combobox.InputGroup className={cn('relative flex w-full', className)}>
        <Combobox.Input
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          aria-label={ariaLabel}
          aria-required={required}
          className="h-11 w-full min-w-0 rounded-[var(--radius-md)] border border-input bg-background px-3 py-2 pr-11 text-base shadow-[var(--shadow-control)] transition-[color,background-color,border-color,box-shadow] duration-[var(--motion-standard)] outline-none placeholder:text-muted-foreground hover:border-border-strong focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/20"
          id={id}
          placeholder={status === 'loading' ? t('loading') : placeholder}
          required={required}
        />
        <Combobox.Trigger
          aria-label={t('open', { label: ariaLabel })}
          className="absolute inset-y-1 right-1 flex size-9 items-center justify-center rounded-[var(--radius-sm)] text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          <ChevronDown aria-hidden="true" className="size-4" />
        </Combobox.Trigger>
      </Combobox.InputGroup>
      <Combobox.Portal>
        <Combobox.Positioner align="start" className="z-(--layer-overlay)" sideOffset={6}>
          <Combobox.Popup
            aria-label={ariaLabel}
            className="w-(--anchor-width) min-w-64 overflow-hidden rounded-[var(--radius-md)] border border-border bg-popover p-1 text-popover-foreground shadow-[var(--shadow-overlay)] outline-none"
          >
            <Combobox.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t('empty')}
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
  );
}
