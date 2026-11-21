'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { ScrollShadow } from '@/components/ui/scroll-shadow';
import { queryKeys } from '@/lib/query/keys';
import { fetchSavedTrips } from '@/lib/saved/api';
import { namedCountryLine } from '@/lib/trips/countries';
import { calendarDayDistance } from '@/lib/trips/lifecycle';

/**
 * Other travellers' trips kept in Finds to read for ideas (PRD 8.4).
 *
 * Each opens the trip's shared page, where it is read and, if wanted, used as a
 * trip of the traveller's own. The list is read fresh rather than from the
 * persisted cache: a trip whose owner made it Private has to stop showing.
 * With nothing kept, the section stays out of the way entirely.
 */
export function SavedTripsSection() {
  const t = useTranslations('saved.trips');
  const locale = useLocale();
  const savedTrips = useQuery({
    queryFn: fetchSavedTrips,
    queryKey: queryKeys.savedTrips(),
    refetchOnMount: 'always',
  });
  const trips = savedTrips.data?.trips ?? [];
  if (!trips.length) return null;

  return (
    <section aria-labelledby="saved-trips" className="space-y-3">
      <h2 className="flex items-baseline gap-2 text-lg font-semibold" id="saved-trips">
        {t('title')}
        <span className="text-sm font-normal text-muted-foreground tabular-nums">
          {trips.length}
        </span>
      </h2>
      <ScrollShadow
        orientation="horizontal"
        render={<ul />}
        className="-mx-[var(--gutter-inline-start)] flex snap-x scroll-px-[var(--gutter-inline-start)] gap-3 px-[var(--gutter-inline-start)] pb-1 [scrollbar-width:none]"
      >
        {trips.map((trip) => {
          const countries = namedCountryLine(trip.countries, locale);
          const days = calendarDayDistance(trip.startDate, trip.endDate) + 1;
          return (
            <li className="w-60 shrink-0 snap-start" key={trip.id}>
              <Link
                className="flex h-full flex-col gap-1 rounded-[var(--radius-xl)] border border-border-subtle bg-card p-4 outline-none transition-[border-color,box-shadow] duration-[var(--motion-standard)] hover:border-border-strong focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none"
                href={`/shared/${trip.id}`}
              >
                <span className="font-journal text-[1.375rem] leading-[1.1] font-normal text-pretty">
                  {trip.name}
                </span>
                <span className="text-sm text-muted-foreground">
                  {trip.ownerName ? t('by', { name: trip.ownerName }) : t('byAnonymous')}
                </span>
                <span className="mt-auto pt-2 text-[length:var(--text-metadata)] text-muted-foreground tabular-nums">
                  {countries ? `${countries} · ` : null}
                  {t('days', { count: days })}
                </span>
              </Link>
            </li>
          );
        })}
      </ScrollShadow>
    </section>
  );
}
