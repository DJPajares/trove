'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { PageHeader } from '@/components/page-header';
import { usePreferences } from '@/components/preferences-provider';
import { localToday } from '@/components/saved/saved-ready-for-trip';
import { useRateBoard } from '@/hooks/use-rate-board';
import { deriveRateFromBoard, isSavedRateStale } from '@/lib/currency/api';
import {
  currencyPairHref,
  readRecentCurrencyPairs,
  type CurrencyPair,
} from '@/lib/currency/recent-pairs';
import { queryKeys } from '@/lib/query/keys';
import { fetchTaskTemplates } from '@/lib/tasks/api';
import { nextTripForTools, tripLocalCurrency } from '@/lib/tools/shelf';
import { fetchTrips } from '@/lib/trips/api';
import * as Icons from '@/lib/icons';
import { cn } from '@/lib/utils';

/** The converter's own default when the traveller has no home currency set. */
const FALLBACK_SOURCE = 'USD';

/**
 * Tools as a compact utility shelf: one row per tool, grouped by when it is
 * reached for, each saying in one line what it holds right now. When a trip is
 * ahead, a strip above offers that trip's currency and a checklist, a tap each.
 * It glances at a tool's state but never embeds a tool (PRD 4.5): every row
 * and shortcut opens the tool on its own page.
 */
export function ToolsLauncher() {
  const t = useTranslations('tools');
  const currencyT = useTranslations('currency');
  const templatesT = useTranslations('taskTemplates');
  const locale = useLocale();
  const { preferredCurrency } = usePreferences();
  const home = preferredCurrency ?? FALLBACK_SOURCE;
  const { board } = useRateBoard();
  const trips = useQuery({ queryFn: fetchTrips, queryKey: queryKeys.trips() });
  const templates = useQuery({ queryFn: fetchTaskTemplates, queryKey: queryKeys.taskTemplates() });
  const [recentPairs, setRecentPairs] = useState<CurrencyPair[]>([]);
  useEffect(() => setRecentPairs(readRecentCurrencyPairs()), []);

  const trip = useMemo(() => nextTripForTools(trips.data?.trips ?? [], localToday()), [trips.data]);
  const tripCurrency = trip ? tripLocalCurrency(trip, home) : null;
  const templateList = templates.data?.templates ?? [];

  /** A reference conversion, with a warning only when rates may have changed. */
  const rateFor = (pair: CurrencyPair) => {
    const rate = board ? deriveRateFromBoard(board, pair.source, pair.target) : null;
    if (!rate) return null;
    // A board served from the half-day cache is normal; only one the device
    // could not refresh past that needs a caution before exchanging money.
    const saved = rate.source === 'cache' && isSavedRateStale(rate.fetchedAt);
    return {
      detail: saved ? currencyT('rateMayHaveChanged') : t('openToConvert'),
      saved,
      text: t('rateLine', {
        rate: rate.rate.toLocaleString(locale, { maximumSignificantDigits: 5 }),
        source: rate.base,
        target: rate.quote,
      }),
    };
  };

  const lastPair = recentPairs[0] ?? null;
  const lastRate = lastPair ? rateFor(lastPair) : null;
  const tripPair = tripCurrency ? { source: home, target: tripCurrency } : null;
  const tripRate = tripPair ? rateFor(tripPair) : null;
  const days = trip
    ? Math.round(
        (Date.parse(`${trip.startDate}T00:00:00`) - Date.parse(`${localToday()}T00:00:00`)) /
          86_400_000,
      )
    : 0;

  return (
    <section className="mx-auto w-full max-w-3xl space-y-7">
      <PageHeader
        description={t('description')}
        eyebrow={t('eyebrow')}
        title={t('title')}
        titleFont="journal"
      />

      {trip && (tripPair || templateList.length) ? (
        <section
          aria-labelledby="tools-next-trip"
          className="rounded-[var(--radius-2xl)] bg-score-media-background px-4 pt-4 pb-2 text-score-media-foreground sm:px-5"
        >
          <h2
            className="px-0.5 pb-2 text-[length:var(--text-metadata)] font-semibold tracking-[0.08em] text-score-media-brand uppercase"
            id="tools-next-trip"
          >
            {trip.name} ·{' '}
            {days > 0
              ? new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(days, 'day')
              : t('underway')}
          </h2>
          <ul className="divide-y divide-score-media-foreground/12 sm:grid sm:grid-cols-2 sm:gap-x-4 sm:divide-y-0">
            {tripPair ? (
              <li>
                <ShortcutRow
                  detail={tripRate?.detail ?? t('openToConvert')}
                  detailWarning={tripRate?.saved}
                  href={currencyPairHref(tripPair)}
                  icon={<Icons.Currency aria-hidden="true" className="size-5" />}
                  title={tripRate?.text ?? t('tripCurrency', { currency: tripPair.target })}
                />
              </li>
            ) : null}
            {templateList.length ? (
              <li>
                <ShortcutRow
                  detail={t('templatesReady', { count: templateList.length })}
                  href={`/tools/task-templates?${new URLSearchParams({ trip: trip.id })}`}
                  icon={<Icons.TaskTemplates aria-hidden="true" className="size-5" />}
                  title={t('addChecklist')}
                />
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 sm:grid-cols-2">
        <ShelfGroup label={t('groups.road')}>
          <ToolRow
            glance={
              lastPair
                ? lastRate
                  ? t('lastPairWithRate', {
                      pair: `${lastPair.source} → ${lastPair.target}`,
                      rate: lastRate.text,
                    })
                  : t('lastPair', { pair: `${lastPair.source} → ${lastPair.target}` })
                : t('currencyGlance')
            }
            href={lastPair ? currencyPairHref(lastPair) : '/tools/currency'}
            icon={<Icons.Currency aria-hidden="true" className="size-5" />}
            label={currencyT('title')}
            tone="olive"
          >
            {recentPairs.length > 1 ? (
              <div className="flex gap-2 overflow-x-auto pr-4 pb-3 pl-[4.5rem] [scrollbar-width:none]">
                {recentPairs.slice(1).map((pair) => (
                  <Link
                    className="inline-flex h-9 shrink-0 items-center rounded-full border border-border bg-background px-3 text-[0.8125rem] font-semibold outline-none hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40"
                    href={currencyPairHref(pair)}
                    key={`${pair.source}-${pair.target}`}
                  >
                    {pair.source} → {pair.target}
                  </Link>
                ))}
              </div>
            ) : null}
          </ToolRow>
        </ShelfGroup>

        <ShelfGroup label={t('groups.before')}>
          <ToolRow
            glance={
              templateList.length
                ? t('templatesGlance', {
                    count: templateList.length,
                    names: new Intl.ListFormat(locale, { style: 'narrow', type: 'unit' }).format(
                      templateList.slice(0, 3).map((template) => template.name),
                    ),
                  })
                : t('templatesEmptyGlance')
            }
            href="/tools/task-templates"
            icon={<Icons.TaskTemplates aria-hidden="true" className="size-5" />}
            label={templatesT('title')}
            tone="terracotta"
          />
        </ShelfGroup>
      </div>

      <p className="text-sm text-muted-foreground">{t('wayfinding')}</p>
    </section>
  );
}

function ShelfGroup({ children, label }: Readonly<{ children: ReactNode; label: string }>) {
  return (
    <section aria-label={label} className="space-y-2">
      <h2 className="px-1 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {label}
      </h2>
      <div className="overflow-hidden rounded-[var(--radius-xl)] border border-border-subtle bg-card shadow-[var(--shadow-surface)]">
        {children}
      </div>
    </section>
  );
}

/** One tool: what it is, and one line of what it holds right now. */
function ToolRow({
  children,
  glance,
  href,
  icon,
  label,
  tone,
}: Readonly<{
  children?: ReactNode;
  glance: string;
  href: string;
  icon: ReactNode;
  label: string;
  tone: 'olive' | 'terracotta';
}>) {
  return (
    <>
      <Link
        className="group flex min-h-[4.25rem] items-center gap-3.5 px-4 outline-none transition-colors duration-[var(--motion-standard)] hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:ring-inset"
        href={href}
      >
        <span
          className={cn(
            'grid size-11 shrink-0 place-items-center rounded-[var(--radius-md)]',
            tone === 'olive'
              ? 'bg-secondary text-secondary-foreground'
              : 'bg-accent/25 text-accent-strong',
          )}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{label}</span>
          <span className="block truncate text-sm text-muted-foreground">{glance}</span>
        </span>
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-[var(--motion-standard)] group-hover:translate-x-0.5 motion-reduce:transition-none"
        />
      </Link>
      {children}
    </>
  );
}

/** A trip shortcut on the dark strip: one tap into a tool, already pointed at the trip. */
function ShortcutRow({
  detail,
  detailWarning = false,
  href,
  icon,
  title,
}: Readonly<{
  detail: string;
  detailWarning?: boolean;
  href: string;
  icon: ReactNode;
  title: string;
}>) {
  return (
    <Link
      className="flex min-h-14 items-center gap-3 rounded-[var(--radius-md)] outline-none focus-visible:ring-3 focus-visible:ring-score-media-foreground/50"
      href={href}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-md)] bg-score-media-foreground/10 text-score-media-brand">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{title}</span>
        <span
          className={cn(
            'block truncate text-sm',
            detailWarning ? 'text-score-media-warning' : 'text-score-media-muted',
          )}
        >
          {detail}
        </span>
      </span>
      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-score-media-muted" />
    </Link>
  );
}
