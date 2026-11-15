'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { HomeSheet } from '@/components/home/home-front-door';
import { FINDS_COVER_FRAME } from '@/components/saved/finds-cover';
import { KitCover, type KitShortcut } from '@/components/tools/kit-cover';
import { usePreferences } from '@/components/preferences-provider';
import { localToday } from '@/components/saved/saved-ready-for-trip';
import { Skeleton } from '@/components/ui/skeleton';
import { useEditorialImages } from '@/hooks/use-editorial-images';
import { useRateBoard } from '@/hooks/use-rate-board';
import { deriveRateFromBoard, isSavedRateStale } from '@/lib/currency/api';
import {
  currencyPairHref,
  readRecentCurrencyPairs,
  type CurrencyPair,
} from '@/lib/currency/recent-pairs';
import { defaultExpensesTrip } from '@/lib/expenses/default-trip';
import { editorialCoverImage, editorialSubjectKey } from '@/lib/media/editorial-images';
import { resolveTripMediaSource } from '@/lib/media/trip-media';
import { useEntrance, type EntranceClock } from '@/lib/page-entrance';
import { queryKeys } from '@/lib/query/keys';
import { fetchTaskTemplates } from '@/lib/tasks/api';
import { nextTripForTools, tripLocalCurrency } from '@/lib/tools/shelf';
import { fetchTrips } from '@/lib/trips/api';
import { tripDestinationSummary, tripEditorialSubject } from '@/lib/trips/summary';
import * as Icons from '@/lib/icons';
import { cn } from '@/lib/utils';
import { ScrollShadow } from '@/components/ui/scroll-shadow';

/** Kit's entrance, kept for the tab's life and replayed on each visit. */
const kitEntrance: EntranceClock = { startedAt: null };

/** The converter's own default when the traveller has no home currency set. */
const FALLBACK_SOURCE = 'USD';

/**
 * Kit, the traveller's travel kit: a compact shelf of tools, one row per tool,
 * grouped by when it is reached for, each saying in one line what it holds
 * right now. It opens on the cover Home, Trips and Finds share: with a trip
 * ahead, that trip's photograph and countdown, with its currency and a
 * checklist set on it, a tap each.
 * It glances at a tool's state but never embeds a tool (PRD 4.5): every row
 * and shortcut opens the tool on its own page.
 */
export function ToolsLauncher() {
  const t = useTranslations('tools');
  const currencyT = useTranslations('currency');
  const templatesT = useTranslations('taskTemplates');
  const expensesT = useTranslations('expensesPage');
  const locale = useLocale();
  const { preferredCurrency } = usePreferences();
  const home = preferredCurrency ?? FALLBACK_SOURCE;
  const { board } = useRateBoard();
  const trips = useQuery({ queryFn: () => fetchTrips(), queryKey: queryKeys.trips() });
  const templates = useQuery({ queryFn: fetchTaskTemplates, queryKey: queryKeys.taskTemplates() });
  const [recentPairs, setRecentPairs] = useState<CurrencyPair[]>([]);
  useEffect(() => setRecentPairs(readRecentCurrencyPairs()), []);

  const trip = useMemo(() => nextTripForTools(trips.data?.trips ?? [], localToday()), [trips.data]);
  const tripCurrency = trip ? tripLocalCurrency(trip, home) : null;
  const expensesTrip = useMemo(
    () => defaultExpensesTrip(trips.data?.trips ?? [], localToday()),
    [trips.data],
  );
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

  // The next trip's photograph: its own cover, else the editorial photograph
  // the Trips library shows for it, from the same one request.
  const tripSubject = trip ? tripEditorialSubject(trip) : null;
  const tripImages = useEditorialImages(tripSubject ? [tripSubject] : []);
  const tripEditorial =
    trip && tripSubject
      ? editorialCoverImage(tripImages.get(editorialSubjectKey(tripSubject)), trip.id)
      : null;
  const entrance = useEntrance(kitEntrance, { ready: !trips.isPending, replay: true });

  const shortcuts: KitShortcut[] = [
    ...(trip && tripPair
      ? [
          {
            detail: tripRate?.detail ?? t('openToConvert'),
            detailWarning: tripRate?.saved,
            href: currencyPairHref(tripPair),
            icon: <Icons.Currency aria-hidden="true" className="size-5" />,
            title: tripRate?.text ?? t('tripCurrency', { currency: tripPair.target }),
          },
        ]
      : []),
    ...(trip && templateList.length
      ? [
          {
            detail: t('templatesReady', { count: templateList.length }),
            href: `/tools/task-templates?${new URLSearchParams({ trip: trip.id })}`,
            icon: <Icons.TaskTemplates aria-hidden="true" className="size-5" />,
            title: t('addChecklist'),
          },
        ]
      : []),
  ];

  return (
    <section className="mx-auto w-full max-w-5xl" style={entrance.style}>
      {trips.isPending ? (
        <Skeleton aria-hidden="true" className={cn('rounded-none', FINDS_COVER_FRAME)} />
      ) : (
        <KitCover
          description={t('description')}
          destination={trip ? (tripDestinationSummary(trip) ?? trip.name) : null}
          enter={entrance.enter}
          lead={
            trip ? (days > 0 ? t('cover.daysUntil', { count: days }) : t('cover.underway')) : null
          }
          media={
            trip
              ? resolveTripMediaSource({ coverUrl: trip.coverPhotoUrl, editorial: tripEditorial })
              : null
          }
          shortcuts={shortcuts}
          title={t('title')}
        />
      )}

      <HomeSheet>
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
                <ScrollShadow
                  orientation="horizontal"
                  className="flex gap-2 pr-4 pb-3 pl-[4.5rem] [scrollbar-width:none]"
                >
                  {recentPairs.slice(1).map((pair) => (
                    <Link
                      className="inline-flex h-9 shrink-0 items-center rounded-full border border-border bg-background px-3 text-[0.8125rem] font-semibold outline-none hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40"
                      href={currencyPairHref(pair)}
                      key={`${pair.source}-${pair.target}`}
                    >
                      {pair.source} → {pair.target}
                    </Link>
                  ))}
                </ScrollShadow>
              ) : null}
            </ToolRow>
            <ToolRow
              glance={
                expensesTrip
                  ? t('expensesGlance', { trip: expensesTrip.name })
                  : t('expensesEmptyGlance')
              }
              href={
                expensesTrip
                  ? `/expenses?${new URLSearchParams({ trip: expensesTrip.id })}`
                  : '/expenses'
              }
              icon={<Icons.Expenses aria-hidden="true" className="size-5" />}
              label={expensesT('title')}
              tone="olive"
            />
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
      </HomeSheet>
    </section>
  );
}

function ShelfGroup({ children, label }: Readonly<{ children: ReactNode; label: string }>) {
  return (
    <section aria-label={label} className="space-y-2">
      <h2 className="px-1 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">
        {label}
      </h2>
      <div className="divide-y divide-border-subtle overflow-hidden rounded-[var(--radius-xl)] border border-border-subtle bg-card shadow-[var(--shadow-surface)]">
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
    <div>
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
    </div>
  );
}
