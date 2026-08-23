'use client';

import {
  BedDouble,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Info,
  MapPinned,
  ReceiptText,
  Route,
  StickyNote,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import { EditorialSection } from '@/components/editorial-section';
import { PageState } from '@/components/page-state';
import { OfflineReadyStatus } from '@/components/offline-ready-status';
import { TripNotificationControl } from '@/components/trip-notification-control';
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
import { fetchExpenses } from '@/lib/expenses/api';
import { fetchReservations } from '@/lib/reservations/api';
import { fetchTasks } from '@/lib/tasks/api';
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
    | 'notesDescription'
    | 'placesDescription'
    | 'reservationsDescription'
    | 'tasksDescription';
  href: string;
  icon: typeof CalendarDays;
  key: 'expenses' | 'info' | 'itinerary' | 'notes' | 'places' | 'reservations' | 'tasks';
};

type SupportingCounts = {
  expenses: number | null;
  reservations: number | null;
  tasks: number | null;
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
  const [supportingCounts, setSupportingCounts] = useState<SupportingCounts>({
    expenses: null,
    reservations: null,
    tasks: null,
  });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ data: null, status: 'loading' });
    setPinnedInfo([]);
    setSupportingCounts({ expenses: null, reservations: null, tasks: null });

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

    void Promise.allSettled([
      fetchReservations(tripId),
      fetchTasks(tripId),
      fetchExpenses(tripId),
    ]).then(([reservationsResult, tasksResult, expensesResult]) => {
      if (!active) return;
      setSupportingCounts({
        expenses:
          expensesResult.status === 'fulfilled' ? expensesResult.value.expenses.length : null,
        reservations:
          reservationsResult.status === 'fulfilled'
            ? reservationsResult.value.reservations.length
            : null,
        tasks:
          tasksResult.status === 'fulfilled'
            ? tasksResult.value.tasks.filter((task) => !task.completed).length
            : null,
      });
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
  const selectedDay = selectedDayIndex >= 0 ? itinerary.days[selectedDayIndex]! : null;
  const visibleDays = upcomingDays.slice(0, 4);
  const remainingDayCount = upcomingDays.length - visibleDays.length;
  const dailyBase = selectedDay?.dailyBaseTripPlaceId
    ? itinerary.tripPlaces.find((place) => place.id === selectedDay.dailyBaseTripPlaceId)
    : null;
  const notes = [
    ...(trip.notes ? [{ label: t('tripNote'), value: trip.notes }] : []),
    ...(selectedDay?.notes
      ? [
          {
            label: t('dayNote', {
              date: dateFormatter.format(new Date(`${selectedDay.date}T00:00:00.000Z`)),
            }),
            value: selectedDay.notes,
          },
        ]
      : []),
    ...(selectedDay?.items
      .filter((item) => item.notes)
      .map((item) => ({
        label: item.customLabel ?? item.tripPlace?.place.name ?? t('itemNote'),
        value: item.notes!,
      })) ?? []),
  ];
  const itineraryHref = selectedDay
    ? `/trips/${tripId}/itinerary?day=${encodeURIComponent(selectedDay.id)}`
    : `/trips/${tripId}/itinerary`;
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
      descriptionKey: 'notesDescription',
      href: itineraryHref,
      icon: StickyNote,
      key: 'notes',
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
      <header className="max-w-[var(--layout-reading)]">
        <h2 className="sr-only">{t('title')}</h2>
        <p className="text-sm leading-[1.55] text-pretty text-muted-foreground">
          {t('description')}
        </p>
      </header>

      <section aria-labelledby="trip-mode-summary-heading">
        <h3 className="sr-only" id="trip-mode-summary-heading">
          {t('summary')}
        </h3>
        <dl className="grid gap-x-6 gap-y-5 border-y border-border-subtle py-5 sm:grid-cols-3">
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
        <EditorialSection
          actions={
            <Button
              nativeButton={false}
              render={<Link href={`/trips/${tripId}/itinerary`} />}
              size="sm"
              variant="ghost"
            >
              {t('openItinerary')}
            </Button>
          }
          description={t('upcomingDaysDescription')}
          headingId="trip-mode-upcoming-days-heading"
          headingLevel={3}
          title={t('upcomingDays')}
        >
          {visibleDays.length ? (
            <>
              <ItemGroup variant="list">
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
            <div className="border-y border-border-subtle py-6">
              <CalendarDays aria-hidden="true" className="size-5 text-brand" />
              <p className="mt-3 text-sm font-semibold text-foreground">{t('noUpcomingDays')}</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {t('noUpcomingDaysDescription')}
              </p>
            </div>
          )}
        </EditorialSection>

        <div className="space-y-8">
          <OfflineReadyStatus tripId={tripId} />
          <TripNotificationControl tripId={tripId} />

          {dailyBase ? (
            <section aria-labelledby="trip-mode-base-heading">
              <div className="flex items-start gap-3 border-y border-border-subtle py-4">
                <BedDouble aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-foreground" id="trip-mode-base-heading">
                    {t('dailyBase')}
                  </h3>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {dailyBase.place.name ?? t('dailyBaseFallback')}
                  </p>
                </div>
                <Button
                  nativeButton={false}
                  render={<Link href={itineraryHref} />}
                  size="xs"
                  variant="ghost"
                >
                  {t('viewDay')}
                </Button>
              </div>
            </section>
          ) : null}

          {pinnedInfo.length ? (
            <EditorialSection
              actions={
                <Button
                  nativeButton={false}
                  render={<Link href={`/trips/${tripId}/info`} />}
                  size="xs"
                  variant="ghost"
                >
                  {t('viewAllInfo')}
                </Button>
              }
              density="compact"
              headingId="trip-mode-pinned-info-heading"
              headingLevel={3}
              title={t('pinnedInfo')}
            >
              <dl className="space-y-3 border-y border-border-subtle py-3">
                {pinnedInfo.map((entry) => (
                  <div key={entry.id}>
                    <dt className="text-xs font-medium text-muted-foreground">{entry.label}</dt>
                    <dd className="mt-0.5 break-words text-sm font-medium text-foreground">
                      {entry.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </EditorialSection>
          ) : null}

          {notes.length ? (
            <EditorialSection
              actions={
                <Button
                  nativeButton={false}
                  render={<Link href={itineraryHref} />}
                  size="xs"
                  variant="ghost"
                >
                  {t('viewNotes')}
                </Button>
              }
              density="compact"
              headingId="trip-mode-notes-heading"
              headingLevel={3}
              title={t('notes')}
            >
              <dl className="space-y-3 border-y border-border-subtle py-3">
                {notes.slice(0, 3).map((note) => (
                  <div key={`${note.label}-${note.value}`}>
                    <dt className="text-xs font-medium text-muted-foreground">{note.label}</dt>
                    <dd className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-sm text-foreground">
                      {note.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </EditorialSection>
          ) : null}

          <EditorialSection
            density="compact"
            description={t('tripToolsDescription')}
            headingId="trip-mode-tools-heading"
            headingLevel={3}
            title={t('tripTools')}
          >
            <ItemGroup variant="list">
              {tools.map(({ descriptionKey, href, icon: Icon, key }) => (
                <Item key={key} render={<Link href={href} />} size="sm">
                  <ItemMedia variant="icon">
                    <Icon aria-hidden="true" className="text-brand" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{t(`tools.${key}`)}</ItemTitle>
                    <ItemDescription>
                      {key === 'places'
                        ? t('tools.placesDescription', { count: itinerary.tripPlaces.length })
                        : key === 'reservations' && supportingCounts.reservations !== null
                          ? t('tools.reservationsCount', {
                              count: supportingCounts.reservations,
                            })
                          : key === 'tasks' && supportingCounts.tasks !== null
                            ? t('tools.tasksCount', { count: supportingCounts.tasks })
                            : key === 'expenses' && supportingCounts.expenses !== null
                              ? t('tools.expensesCount', { count: supportingCounts.expenses })
                              : key === 'notes'
                                ? t('tools.notesCount', { count: notes.length })
                                : t(`tools.${descriptionKey}`)}
                    </ItemDescription>
                  </ItemContent>
                  <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
                </Item>
              ))}
            </ItemGroup>
          </EditorialSection>
        </div>
      </div>
    </div>
  );
}
