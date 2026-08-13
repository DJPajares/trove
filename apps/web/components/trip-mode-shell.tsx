'use client';

import { ArrowLeft, CalendarDays, Clock3, Compass, Map, MapPinned } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import { PageState } from '@/components/page-state';
import { Button } from '@/components/ui/button';
import { fetchTrip, type Trip } from '@/lib/trips/api';
import { cn } from '@/lib/utils';

type TripModeShellProps = {
  children: ReactNode;
  tripId: string;
};

type LoadState =
  | { status: 'error'; trip: null }
  | { status: 'idle'; trip: Trip }
  | { status: 'loading'; trip: null };

const tripModeViews = [
  { icon: Clock3, key: 'now', path: '' },
  { icon: CalendarDays, key: 'today', path: '/today' },
  { icon: Map, key: 'map', path: '/map' },
  { icon: MapPinned, key: 'trip', path: '/trip' },
] as const;

export function TripModeShell({ children, tripId }: Readonly<TripModeShellProps>) {
  const t = useTranslations('tripMode');
  const locale = useLocale();
  const pathname = usePathname();
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<LoadState>({ status: 'loading', trip: null });

  useEffect(() => {
    let active = true;
    setState({ status: 'loading', trip: null });

    void fetchTrip(tripId)
      .then(({ trip }) => {
        if (active) setState({ status: 'idle', trip });
      })
      .catch(() => {
        if (active) setState({ status: 'error', trip: null });
      });

    return () => {
      active = false;
    };
  }, [reloadKey, tripId]);

  if (state.status === 'loading') {
    return (
      <section className="mx-auto w-full max-w-6xl">
        <PageState kind="loading" title={t('loading')} />
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section className="mx-auto w-full max-w-6xl">
        <PageState
          actions={
            <>
              <Button onClick={() => setReloadKey((value) => value + 1)}>{t('tryAgain')}</Button>
              <Button nativeButton={false} render={<Link href="/trips" />} variant="outline">
                {t('backToTrips')}
              </Button>
            </>
          }
          description={t('loadErrorDescription')}
          icon={<Compass aria-hidden="true" />}
          kind="error"
          title={t('loadError')}
        />
      </section>
    );
  }

  const { trip } = state;
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  });
  const formatDate = (date: string) => dateFormatter.format(new Date(`${date}T00:00:00.000Z`));

  if (trip.lifecycle !== 'active') {
    return (
      <section className="mx-auto w-full max-w-6xl">
        <PageState
          actions={
            <>
              <Button nativeButton={false} render={<Link href="/trips" />}>
                {t('backToTrips')}
              </Button>
              <Button
                nativeButton={false}
                render={<Link href={`/trips/${trip.id}/itinerary`} />}
                variant="outline"
              >
                {t('openPlanning')}
              </Button>
            </>
          }
          description={t('unavailableDescription', {
            endDate: formatDate(trip.endDate),
            startDate: formatDate(trip.startDate),
            timeZone: trip.referenceTimeZone,
          })}
          icon={<CalendarDays aria-hidden="true" />}
          kind="empty"
          title={t('unavailableTitle')}
        />
      </section>
    );
  }

  const basePath = `/trips/${trip.id}/mode`;

  return (
    <section className="mx-auto w-full max-w-6xl space-y-6" data-slot="trip-mode-shell">
      <header className="space-y-5">
        <Button
          className="-ml-2 text-muted-foreground hover:text-foreground"
          nativeButton={false}
          render={<Link href="/trips" />}
          size="sm"
          variant="ghost"
        >
          <ArrowLeft aria-hidden="true" data-icon="inline-start" />
          {t('exit')}
        </Button>

        <div className="flex items-start gap-4 sm:items-center">
          <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-lg)] bg-secondary text-secondary-foreground shadow-[var(--shadow-control)] sm:size-16">
            {trip.coverPhotoUrl ? (
              <Image
                alt=""
                className="size-full object-cover"
                height={64}
                src={trip.coverPhotoUrl}
                unoptimized
                width={64}
              />
            ) : (
              <MapPinned aria-hidden="true" className="size-6" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-brand">{t('label')}</p>
            <h1 className="mt-1 break-words text-2xl leading-tight font-semibold tracking-[-0.02em] text-foreground sm:text-3xl">
              {trip.name}
            </h1>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {t('dateRange', {
                endDate: formatDate(trip.endDate),
                startDate: formatDate(trip.startDate),
              })}
            </p>
          </div>
          <Button
            className="hidden sm:inline-flex"
            nativeButton={false}
            render={<Link href={`/trips/${trip.id}/itinerary`} />}
            variant="outline"
          >
            {t('openPlanning')}
          </Button>
        </div>
      </header>

      <nav
        aria-label={t('navigation')}
        className="sticky top-[4.75rem] z-[calc(var(--layer-sticky)-1)] -mx-1 rounded-[var(--radius-lg)] border border-border bg-background/95 p-1 shadow-[var(--shadow-control)] backdrop-blur supports-[backdrop-filter]:bg-background/88"
        data-translucent-surface
      >
        <ul className="grid grid-cols-4 gap-1">
          {tripModeViews.map(({ icon: Icon, key, path }) => {
            const href = `${basePath}${path}`;
            const active = pathname === href;

            return (
              <li key={key}>
                <Link
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-12 items-center justify-center gap-1.5 rounded-[var(--radius-md)] px-2 py-2 text-xs font-medium outline-none transition-colors duration-[var(--motion-standard)] focus-visible:ring-3 focus-visible:ring-ring/40 sm:text-sm',
                    active
                      ? 'bg-secondary text-secondary-foreground'
                      : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
                  )}
                  href={href}
                >
                  <Icon aria-hidden="true" className="size-4" />
                  <span>{t(`views.${key}.label`)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="min-h-[min(32rem,55dvh)] border-t border-border pt-8">{children}</div>
    </section>
  );
}
