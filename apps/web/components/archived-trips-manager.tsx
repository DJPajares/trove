'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations, useLocale } from 'next-intl';
import Link from 'next/link';
import { fetchTrips } from '@/lib/trips/api';
import { queryKeys } from '@/lib/query/keys';
import { TripArchiveControl } from '@/components/trip-archive-control';
import { PageHeader } from '@/components/page-header';
import { PageState } from '@/components/page-state';
import { Input } from '@/components/ui/input';
import { Button, buttonVariants } from '@/components/ui/button';

export function ArchivedTripsManager() {
  const t = useTranslations('trips.archive');
  const locale = useLocale();
  const [query, setQuery] = useState('');
  const result = useQuery({
    queryFn: () => fetchTrips('only'),
    queryKey: queryKeys.archivedTrips(),
  });
  const all = (result.data?.trips ?? [])
    .filter((trip) => trip.archivedAt)
    .toSorted((a, b) => b.archivedAt!.localeCompare(a.archivedAt!) || a.id.localeCompare(b.id));
  const shown = all.filter((trip) =>
    [trip.name, ...trip.destinations.map((place) => place.name)].some((text) =>
      text.toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale)),
    ),
  );
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(`${value}T00:00:00Z`),
    );
  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={t('view')}
        description={t('description')}
        actions={
          <Link className={buttonVariants({ variant: 'outline' })} href="/trips">
            {t('back')}
          </Link>
        }
      />
      <Input
        aria-label={t('search')}
        placeholder={t('search')}
        onChange={(event) => setQuery(event.target.value)}
        value={query}
      />
      {result.data ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {t('count', { count: shown.length, total: all.length })}
        </p>
      ) : null}
      {result.isPending ? (
        <PageState headingLevel={2} kind="loading" title={t('loading')} />
      ) : result.isError && !result.data ? (
        <PageState
          headingLevel={2}
          kind="error"
          title={t('error')}
          actions={<Button onClick={() => void result.refetch()}>{t('retry')}</Button>}
        />
      ) : !shown.length ? (
        <PageState
          headingLevel={2}
          kind="empty"
          title={t(all.length ? 'noMatches' : 'empty')}
          description={t('emptyDescription')}
        />
      ) : (
        <ul className="divide-y divide-border-subtle rounded-[var(--radius-xl)] border border-border-subtle bg-card">
          {shown.map((trip) => (
            <li className="flex flex-wrap items-center justify-between gap-4 p-5" key={trip.id}>
              <div className="min-w-0 flex-1">
                <Link
                  className="font-semibold underline-offset-4 hover:underline"
                  href={`/trips/${trip.id}`}
                >
                  {trip.name}
                </Link>
                <p className="text-sm text-muted-foreground">
                  {trip.destinations.map((place) => place.name).join(', ')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {date(trip.startDate)} – {date(trip.endDate)}
                </p>
              </div>
              <TripArchiveControl trip={trip} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
