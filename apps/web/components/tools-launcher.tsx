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
import { nextTripForTools, tripLocalCurrency } from '@/lib/tools/shelf';
import { fetchTrips } from '@/lib/trips/api';
import { tripDestinationSummary, tripEditorialSubject } from '@/lib/trips/summary';
import * as Icons from '@/lib/icons';
import { cn } from '@/lib/utils';

/** Kit's entrance, kept for the tab's life and replayed on each visit. */
const kitEntrance: EntranceClock = { startedAt: null };

/** The converter's own default when the traveller has no home currency set. */
const FALLBACK_SOURCE = 'USD';

/**
 * Kit, the traveller's travel kit: a shelf of tool tiles, each naming the tool
 * and saying in one sentence what it is for. It opens on the cover Home, Trips
 * and Finds share: with a trip ahead, that trip's photograph and countdown,
 * with one shortcut set on it - the trip currency's rate.
 * It never embeds a tool (PRD 4.5): every tile and the shortcut open the tool
 * on its own page.
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
  const [recentPairs, setRecentPairs] = useState<CurrencyPair[]>([]);
  useEffect(() => setRecentPairs(readRecentCurrencyPairs()), []);

  const trip = useMemo(() => nextTripForTools(trips.data?.trips ?? [], localToday()), [trips.data]);
  const tripCurrency = trip ? tripLocalCurrency(trip, home) : null;
  const expensesTrip = useMemo(
    () => defaultExpensesTrip(trips.data?.trips ?? [], localToday()),
    [trips.data],
  );

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

  const shortcuts: KitShortcut[] =
    trip && tripPair
      ? [
          {
            detail: tripRate?.detail ?? t('openToConvert'),
            detailWarning: tripRate?.saved,
            href: currencyPairHref(tripPair),
            icon: <Icons.Currency aria-hidden="true" className="size-5" />,
            title: tripRate?.text ?? t('tripCurrency', { currency: tripPair.target }),
          },
        ]
      : [];

  // The tools themselves, the same on every visit. Each still opens where the
  // traveller left off - the last pair, the trip spending is gathering for -
  // without saying so on the shelf.
  const tiles: ToolTileProps[] = [
    {
      href: lastPair ? currencyPairHref(lastPair) : '/tools/currency',
      icon: <Icons.Currency aria-hidden="true" className="size-6 sm:size-7" />,
      label: currencyT('title'),
      purpose: t('purpose.currency'),
      tone: 'olive',
    },
    {
      href: expensesTrip
        ? `/expenses?${new URLSearchParams({ trip: expensesTrip.id })}`
        : '/expenses',
      icon: <Icons.Expenses aria-hidden="true" className="size-6 sm:size-7" />,
      label: expensesT('title'),
      purpose: t('purpose.expenses'),
      tone: 'olive',
    },
    {
      href: '/tools/task-templates',
      icon: <Icons.TaskTemplates aria-hidden="true" className="size-6 sm:size-7" />,
      label: templatesT('title'),
      purpose: t('purpose.checklists'),
      tone: 'terracotta',
    },
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
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {tiles.map((tile, index) => (
            <li
              className={cn(index === tiles.length - 1 && 'col-span-2 sm:col-span-1')}
              key={tile.label}
            >
              <ToolTile {...tile} square={index !== tiles.length - 1} />
            </li>
          ))}
        </ul>

        <p className="text-sm text-muted-foreground">{t('wayfinding')}</p>
      </HomeSheet>
    </section>
  );
}

type ToolTileProps = {
  href: string;
  icon: ReactNode;
  label: string;
  purpose: string;
  tone: 'olive' | 'terracotta';
};

/**
 * One tool: its icon, its name and what it is for. It never shows the tool's
 * state, so the shelf reads the same on every visit (PRD 4.5).
 */
function ToolTile({
  href,
  icon,
  label,
  purpose,
  square,
  tone,
}: Readonly<ToolTileProps & { square: boolean }>) {
  return (
    <Link
      className={cn(
        'group flex h-full flex-col gap-3 rounded-[var(--radius-xl)] border border-border-subtle bg-card p-4 shadow-[var(--shadow-surface)] outline-none transition-colors duration-[var(--motion-standard)] hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none',
        square && 'min-h-44',
        'sm:aspect-[4/3] sm:min-h-0',
      )}
      href={href}
    >
      <span
        className={cn(
          'grid size-12 shrink-0 place-items-center rounded-[var(--radius-lg)] sm:size-14',
          tone === 'olive'
            ? 'bg-secondary text-secondary-foreground'
            : 'bg-accent/25 text-accent-strong',
        )}
      >
        {icon}
      </span>
      <span className="mt-auto min-w-0">
        <span className="flex items-center gap-1 font-semibold">
          {label}
          <ChevronRight
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground transition-transform duration-[var(--motion-standard)] group-hover:translate-x-0.5 motion-reduce:transition-none"
          />
        </span>
        <span className="mt-1 block text-sm leading-snug text-pretty text-muted-foreground">
          {purpose}
        </span>
      </span>
    </Link>
  );
}
