'use client';

import {
  CalendarDays,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Info,
  MapPinned,
  ReceiptText,
  Route,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import { PageState } from '@/components/page-state';
import { OfflineReadyStatus } from '@/components/offline-ready-status';
import { useTripModePreview } from '@/components/trip-mode-shell';
import { useOfflineDataRefreshKey } from '@/components/trip-sync-status';
import { Button } from '@/components/ui/button';
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import {
  fetchItinerary,
  fetchTripModeContext,
  type Itinerary,
  type TripModeContext,
} from '@/lib/itinerary/api';
import { fetchTripInfo, type TripInfoEntry } from '@/lib/trip-info/api';
import { fetchTrip, type Trip } from '@/lib/trips/api';

type LoadState =
  | { data: null; status: 'error' }
  | { data: null; status: 'loading' }
  | {
      data: { context: TripModeContext; itinerary: Itinerary; trip: Trip };
      status: 'ready';
    };

type Tool = {
  descriptionKey:
    | 'expensesDescription'
    | 'infoDescription'
    | 'itineraryDescription'
    | 'placesDescription'
    | 'reservationsDescription'
    | 'tasksDescription';
  href: string;
  icon: typeof CalendarDays;
  key: 'expenses' | 'info' | 'itinerary' | 'places' | 'reservations' | 'tasks';
};

function TripViewSkeleton({ label }: Readonly<{ label: string }>) {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-7" role="status">
      <span className="sr-only">{label}</span>
      <div className="space-y-3">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-5 w-72 max-w-full" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
      <Skeleton className="h-72 w-full rounded-[var(--radius-xl)]" />
    </div>
  );
}

export function TripModeTripView({ tripId }: Readonly<{ tripId: string }>) {
  const t = useTranslations('tripMode.views.trip');
  const locale = useLocale();
  const { contextOptions } = useTripModePreview();
  const offlineDataRefreshKey = useOfflineDataRefreshKey();
  const [state, setState] = useState<LoadState>({ data: null, status: 'loading' });
  const [pinnedInfo, setPinnedInfo] = useState<TripInfoEntry[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ data: null, status: 'loading' });
    setPinnedInfo([]);

    void Promise.all([
      fetchTripModeContext(tripId, contextOptions()),
      fetchItinerary(tripId),
      fetchTrip(tripId),
    ])
      .then(([context, itinerary, { trip }]) => {
        if (active) setState({ data: { context, itinerary, trip }, status: 'ready' });
      })
      .catch(() => {
        if (active) setState({ data: null, status: 'error' });
      });

    void fetchTripInfo(tripId)
      .then(({ entries }) => {
        if (active) setPinnedInfo(entries.filter((entry) => entry.isPinned).slice(0, 3));
      })
      .catch(() => {
        // Trip Info is a supporting destination. Its separate failure should not hide the trip.
      });

    return () => {
      active = false;
    };
  }, [contextOptions, offlineDataRefreshKey, reloadKey, tripId]);

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeZone: 'UTC',
      }),
    [locale],
  );

  if (state.status === 'loading') return <TripViewSkeleton label={t('loading')} />;

  if (state.status === 'error') {
    return (
      <PageState
        actions={
          <Button onClick={() => setReloadKey((current) => current + 1)}>{t('tryAgain')}</Button>
        }
        description={t('loadErrorDescription')}
        headingLevel={2}
        icon={<CircleAlert aria-hidden="true" />}
        kind="error"
        title={t('loadError')}
      />
    );
  }

  const { context, itinerary, trip } = state.data;
  const selectedDayIndex = itinerary.days.findIndex((day) => day.date >= context.selectedDate);
  const upcomingDays = selectedDayIndex >= 0 ? itinerary.days.slice(selectedDayIndex) : [];
  const visibleDays = upcomingDays.slice(0, 4);
  const remainingDayCount = upcomingDays.length - visibleDays.length;
  const tools: Tool[] = [
    {
      descriptionKey: 'itineraryDescription',
      href: `/trips/${tripId}/itinerary`,
      icon: CalendarDays,
      key: 'itinerary',
    },
    {
      descriptionKey: 'placesDescription',
      href: `/trips/${tripId}/places`,
      icon: MapPinned,
      key: 'places',
    },
    {
      descriptionKey: 'reservationsDescription',
      href: `/trips/${tripId}/reservations`,
      icon: ClipboardCheck,
      key: 'reservations',
    },
    {
      descriptionKey: 'tasksDescription',
      href: `/trips/${tripId}/tasks`,
      icon: Route,
      key: 'tasks',
    },
    {
      descriptionKey: 'expensesDescription',
      href: `/trips/${tripId}/expenses`,
      icon: ReceiptText,
      key: 'expenses',
    },
    {
      descriptionKey: 'infoDescription',
      href: `/trips/${tripId}/info`,
      icon: Info,
      key: 'info',
    },
  ];

  return (
    <div className="space-y-8 pb-2 sm:space-y-10">
      <header className="max-w-2xl">
        <h2 className="text-3xl font-semibold tracking-[-0.025em] text-foreground sm:text-4xl">
          {t('title')}
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('description')}</p>
      </header>

      <section aria-labelledby="trip-mode-summary-heading">
        <h3 className="sr-only" id="trip-mode-summary-heading">
          {t('summary')}
        </h3>
        <dl className="grid gap-x-6 gap-y-5 border-y border-border py-5 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              {t('dates')}
            </dt>
            <dd className="mt-1.5 text-sm font-medium text-foreground">
              {t('dateRange', {
                endDate: dateFormatter.format(new Date(`${trip.endDate}T00:00:00.000Z`)),
                startDate: dateFormatter.format(new Date(`${trip.startDate}T00:00:00.000Z`)),
              })}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              {t('destinations')}
            </dt>
            <dd className="mt-1.5 text-sm font-medium text-foreground">
              {trip.destinations.length
                ? trip.destinations.map((destination) => destination.name).join(', ')
                : t('destinationsOpen')}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              {t('travellers')}
            </dt>
            <dd className="mt-1.5 inline-flex items-center gap-2 text-sm font-medium text-foreground">
              <Users aria-hidden="true" className="size-4 text-brand" />
              {t('travellerCount', { count: trip.partySize })}
            </dd>
          </div>
        </dl>
      </section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <section aria-labelledby="trip-mode-upcoming-days-heading">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3
                className="text-xl font-semibold tracking-[-0.015em]"
                id="trip-mode-upcoming-days-heading"
              >
                {t('upcomingDays')}
              </h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {t('upcomingDaysDescription')}
              </p>
            </div>
            <Button
              nativeButton={false}
              render={<Link href={`/trips/${tripId}/itinerary`} />}
              size="sm"
              variant="ghost"
            >
              {t('openItinerary')}
            </Button>
          </div>

          {visibleDays.length ? (
            <>
              <ItemGroup className="mt-4" variant="list">
                {visibleDays.map((day, index) => (
                  <Item
                    key={day.id}
                    render={
                      <Link href={`/trips/${tripId}/itinerary?day=${encodeURIComponent(day.id)}`} />
                    }
                  >
                    <ItemMedia variant="icon">
                      <CalendarDays aria-hidden="true" className="text-brand" />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>
                        {dateFormatter.format(new Date(`${day.date}T00:00:00.000Z`))}
                      </ItemTitle>
                      <ItemDescription>
                        {t('daySummary', {
                          count: day.items.length,
                          number: selectedDayIndex + index + 1,
                        })}
                      </ItemDescription>
                    </ItemContent>
                    <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
                  </Item>
                ))}
              </ItemGroup>
              {remainingDayCount > 0 ? (
                <p className="mt-3 text-xs leading-5 text-text-subtle">
                  {t('moreDays', { count: remainingDayCount })}
                </p>
              ) : null}
            </>
          ) : (
            <div className="mt-5 border-y border-border py-6">
              <CalendarDays aria-hidden="true" className="size-5 text-brand" />
              <p className="mt-3 text-sm font-semibold text-foreground">{t('noUpcomingDays')}</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {t('noUpcomingDaysDescription')}
              </p>
            </div>
          )}
        </section>

        <div className="space-y-8">
          <OfflineReadyStatus tripId={tripId} />

          {pinnedInfo.length ? (
            <section aria-labelledby="trip-mode-pinned-info-heading">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold" id="trip-mode-pinned-info-heading">
                  {t('pinnedInfo')}
                </h3>
                <Button
                  nativeButton={false}
                  render={<Link href={`/trips/${tripId}/info`} />}
                  size="xs"
                  variant="ghost"
                >
                  {t('viewAllInfo')}
                </Button>
              </div>
              <dl className="mt-3 space-y-3 border-y border-border py-3">
                {pinnedInfo.map((entry) => (
                  <div key={entry.id}>
                    <dt className="text-xs font-medium text-muted-foreground">{entry.label}</dt>
                    <dd className="mt-0.5 break-words text-sm font-medium text-foreground">
                      {entry.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          <section aria-labelledby="trip-mode-tools-heading">
            <h3 className="text-base font-semibold" id="trip-mode-tools-heading">
              {t('tripTools')}
            </h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {t('tripToolsDescription')}
            </p>
            <ItemGroup className="mt-3" variant="list">
              {tools.map(({ descriptionKey, href, icon: Icon, key }) => (
                <Item key={key} render={<Link href={href} />} size="sm">
                  <ItemMedia variant="icon">
                    <Icon aria-hidden="true" className="text-brand" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{t(`tools.${key}`)}</ItemTitle>
                    <ItemDescription>
                      {t(`tools.${descriptionKey}`, { count: itinerary.tripPlaces.length })}
                    </ItemDescription>
                  </ItemContent>
                  <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
                </Item>
              ))}
            </ItemGroup>
          </section>
        </div>
      </div>
    </div>
  );
}
