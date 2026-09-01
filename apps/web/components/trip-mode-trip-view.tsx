'use client';

import {
  BedDouble,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Info,
  MapPinned,
  ReceiptText,
  StickyNote,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { EditorialSection } from '@/components/editorial-section';
import { PageState } from '@/components/page-state';
import { OfflineReadyStatus } from '@/components/offline-ready-status';
import { TripNotificationControl } from '@/components/trip-notification-control';
import { useTripModeData } from '@/components/trip-mode-data';
import {
  ManageTasksLink,
  TripModeTaskList,
  TripModeTasksNotice,
  useTripModeTasks,
} from '@/components/trip-mode-tasks';
import { useTripContext } from '@/components/trip-provider';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchExpenses } from '@/lib/expenses/api';
import { queryKeys } from '@/lib/query/keys';
import { useTripResource } from '@/lib/query/use-trip-resource';
import type { Task, TasksResponse } from '@/lib/tasks/api';
import { groupTasksByContext } from '@/lib/tasks/grouping';
import { tripTasks } from '@/lib/tasks/trip-mode';
import { fetchTripInfo } from '@/lib/trip-info/api';
import { cn } from '@/lib/utils';

type Tool = {
  descriptionKey:
    | 'expensesDescription'
    | 'infoDescription'
    | 'itineraryDescription'
    | 'notesDescription'
    | 'placesDescription'
    | 'reservationsDescription';
  href: string;
  icon: typeof CalendarDays;
  key: 'expenses' | 'info' | 'itinerary' | 'notes' | 'places' | 'reservations';
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

function TaskGroup({ label, tasks }: Readonly<{ label: string; tasks: readonly Task[] }>) {
  if (!tasks.length) return null;
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <p className="mb-1.5 text-xs font-semibold text-foreground">{label}</p>
      <TripModeTaskList tasks={tasks} />
    </div>
  );
}

function ContextualTaskGroups({ data }: Readonly<{ data: TasksResponse }>) {
  const t = useTranslations('tripMode.tasks');
  const locale = useLocale();
  const formatDate = (date: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(`${date}T00:00:00.000Z`),
    );
  const { days: dayGroups, unscheduled: unscheduledItems } = groupTasksByContext(
    data.tasks,
    data.contexts,
  );

  return (
    <div className="divide-y divide-border-subtle border-y border-border-subtle py-1">
      {dayGroups.map(({ day, dayTasks, items }) => (
        <section className="py-4" key={day.id}>
          <h4 className="text-sm font-semibold text-foreground">{formatDate(day.date)}</h4>
          <div className="mt-2 divide-y divide-border-subtle">
            <TaskGroup label={t('dayTasks')} tasks={dayTasks} />
            {items.map((item) => (
              <TaskGroup key={item.id} label={item.label} tasks={item.tasks} />
            ))}
          </div>
        </section>
      ))}
      {unscheduledItems.length ? (
        <section className="py-4">
          <h4 className="text-sm font-semibold text-foreground">{t('unscheduled')}</h4>
          <div className="mt-2 divide-y divide-border-subtle">
            {unscheduledItems.map((item) => (
              <TaskGroup key={item.id} label={item.label} tasks={item.tasks} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function TripModeTripView({ tripId }: Readonly<{ tripId: string }>) {
  const t = useTranslations('tripMode.views.trip');
  const itineraryT = useTranslations('itinerary');
  const tasksT = useTranslations('tripMode.tasks');
  const locale = useLocale();
  const { context, itinerary, refresh, reservations, status } = useTripModeData();
  const tripContext = useTripContext();
  const trip = tripContext?.trip ?? null;
  const tripModeTasks = useTripModeTasks();
  const tripInfo = useTripResource(queryKeys.tripInfo(tripId), () => fetchTripInfo(tripId));
  const expenses = useTripResource(queryKeys.expenses(tripId), () => fetchExpenses(tripId));
  const pinnedInfo = useMemo(
    () => tripInfo.data?.entries.filter((entry) => entry.isPinned).slice(0, 3) ?? [],
    [tripInfo.data],
  );
  const supportingCounts = {
    expenses: expenses.data?.expenses.length ?? null,
    reservations: reservations?.length ?? null,
  };

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeZone: 'UTC',
      }),
    [locale],
  );

  if (status === 'loading' || tripContext?.status === 'loading') {
    return <TripViewSkeleton label={t('loading')} />;
  }

  if (
    status === 'error' ||
    !context ||
    !itinerary ||
    !tripContext ||
    tripContext.status === 'error' ||
    tripContext.status === 'missing' ||
    !trip
  ) {
    return (
      <PageState
        actions={
          <Button
            onClick={() => {
              tripContext?.refresh();
              void refresh();
            }}
          >
            {t('tryAgain')}
          </Button>
        }
        description={t('loadErrorDescription')}
        headingLevel={2}
        icon={<CircleAlert aria-hidden="true" />}
        kind="error"
        title={t('loadError')}
      />
    );
  }

  const selectedDayIndex = itinerary.days.findIndex((day) => day.date >= context.selectedDate);
  const upcomingDays = selectedDayIndex >= 0 ? itinerary.days.slice(selectedDayIndex) : [];
  const selectedDay = selectedDayIndex >= 0 ? itinerary.days[selectedDayIndex]! : null;
  const visibleDays = upcomingDays.slice(0, 4);
  const remainingDayCount = upcomingDays.length - visibleDays.length;
  const dailyBase = selectedDay?.dailyBaseTripPlaceId
    ? itinerary.tripPlaces.find((place) => place.id === selectedDay.dailyBaseTripPlaceId)
    : null;
  const tripDescription = trip.description?.trim() ?? '';
  const notes = [
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
  const allTasks = tripModeTasks.data?.tasks ?? [];
  const tripWideTasks = tripTasks(allTasks);
  const contextualTaskCount = allTasks.filter((task) => task.context.kind !== 'trip').length;
  const openTripTaskCount = tripWideTasks.filter((task) => !task.completed).length;

  return (
    <div className="space-y-8 pb-2 sm:space-y-10">
      <header className="max-w-[var(--layout-reading)]">
        <h2 className="sr-only">{t('title')}</h2>
        {/* Standing guidance until the traveller has written their own account
            of the trip, at which point theirs is the more useful sentence. It
            stays out of the notes list below: that list is reminders. */}
        <p
          className={cn(
            'text-sm leading-[1.55] text-pretty text-muted-foreground',
            tripDescription && 'whitespace-pre-wrap',
          )}
        >
          {tripDescription || t('description')}
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

      <EditorialSection
        actions={
          <>
            <Button
              disabled={tripModeTasks.status !== 'ready'}
              onClick={() => tripModeTasks.openCreate({ kind: 'trip' })}
              size="sm"
            >
              {tasksT('add')}
            </Button>
            <ManageTasksLink tripId={tripId} />
          </>
        }
        description={tasksT('tripDescription', { count: openTripTaskCount })}
        headingId="trip-mode-tasks-heading"
        headingLevel={3}
        title={tasksT('tripTitle')}
      >
        <TripModeTasksNotice />
        {tripModeTasks.status === 'loading' ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <TripModeTaskList emptyText={tasksT('tripEmpty')} tasks={tripWideTasks} />
        )}
        {tripModeTasks.data && contextualTaskCount ? (
          <Collapsible className="border-t border-border-subtle pt-2">
            <CollapsibleTrigger className="group w-full justify-between gap-3 py-2 text-left">
              <span className="inline-flex items-center gap-2 text-foreground">
                <CheckCircle2 aria-hidden="true" className="text-brand" />
                {tasksT('byDayAndPlace')}
              </span>
              <span className="inline-flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                {tasksT('taskCount', { count: contextualTaskCount })}
                <ChevronDown
                  aria-hidden="true"
                  className="transition-transform duration-[var(--motion-standard)] group-data-panel-open:rotate-180 motion-reduce:transition-none"
                />
              </span>
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <div className="pt-2">
                <ContextualTaskGroups data={tripModeTasks.data} />
              </div>
            </CollapsiblePanel>
          </Collapsible>
        ) : null}
      </EditorialSection>

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
                        {day.name ?? dateFormatter.format(new Date(`${day.date}T00:00:00.000Z`))}
                      </ItemTitle>
                      <ItemDescription>
                        {day.name
                          ? t('daySummaryNamed', {
                              count: day.items.length,
                              day: itineraryT('dayOption', {
                                date: dateFormatter.format(new Date(`${day.date}T00:00:00.000Z`)),
                                number: selectedDayIndex + index + 1,
                              }),
                            })
                          : t('daySummary', {
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

          {/* Preparing the device is housekeeping, not travelling: it closes the
              page rather than opening it, and stays folded until asked. */}
          <OfflineReadyStatus tripId={tripId} variant="compact" />
        </div>
      </div>
    </div>
  );
}
