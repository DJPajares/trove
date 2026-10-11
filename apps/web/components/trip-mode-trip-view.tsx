'use client';

import { BedDouble, CalendarDays, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, type ReactNode } from 'react';

import { EditorialSection } from '@/components/editorial-section';
import { PageState } from '@/components/page-state';
import { OfflineReadyStatus } from '@/components/offline-ready-status';
import { TripNotificationControl } from '@/components/trip-notification-control';
import { useTripModeData } from '@/components/trip-mode-data';
import {
  TripModeTaskList,
  TripModeTasksNotice,
  useTripModeTasks,
} from '@/components/trip-mode-tasks';
import { TripDayWeather } from '@/components/trip-day-weather';
import { TripModeActionButton, tripModeCardClass } from '@/components/trip-mode-ui';
import { useTripContext } from '@/components/trip-provider';
import { useTripPlacesDrawer } from '@/components/trip-places-provider';
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
import { dayTown } from '@/lib/itinerary/day-place';
import { queryKeys } from '@/lib/query/keys';
import { useTripResource } from '@/lib/query/use-trip-resource';
import type { Task, TasksResponse } from '@/lib/tasks/api';
import { groupTasksByContext } from '@/lib/tasks/grouping';
import { tripTasks } from '@/lib/tasks/trip-mode';
import { fetchTripInfo } from '@/lib/trip-info/api';
import { namedCountryLine } from '@/lib/trips/countries';
import { tripDestinationSummary } from '@/lib/trips/summary';
import { tripWeatherForDate, useTripWeather } from '@/lib/weather/use-trip-weather';
import { cn } from '@/lib/utils';
import * as Icons from '@/lib/icons';
import { tripSectionIcons } from '@/lib/icons';

type Tool = {
  descriptionKey:
    | 'expensesDescription'
    | 'infoDescription'
    | 'itineraryDescription'
    | 'notesDescription'
    | 'placesDescription'
    | 'reservationsDescription';
  icon: typeof CalendarDays;
  key: 'expenses' | 'info' | 'itinerary' | 'notes' | 'places' | 'reservations';
} & ({ href: string; onSelect?: never } | { href?: never; onSelect: () => void });

/** Navigation remains a link; the collection is an action over the current view. */
function TripToolTile({ tool, children }: Readonly<{ tool: Tool; children: ReactNode }>) {
  const className =
    'group flex min-h-28 flex-col justify-between rounded-[var(--radius-xl)] border border-border-subtle bg-card p-3.5 shadow-[var(--shadow-control)] outline-none transition-[background-color,border-color,box-shadow,transform] duration-[var(--motion-standard)] ease-[var(--ease-standard)] hover:border-border-strong hover:bg-surface-hover hover:shadow-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 active:translate-y-px motion-reduce:transition-none';
  return tool.href ? (
    <Link className={className} href={tool.href}>
      {children}
    </Link>
  ) : (
    <Button
      aria-haspopup="dialog"
      className={cn(className, 'h-auto items-stretch whitespace-normal text-left')}
      data-trip-places-trigger
      onClick={tool.onSelect}
      variant="ghost"
    >
      {children}
    </Button>
  );
}

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
  const { openPlaces } = useTripPlacesDrawer();
  const itineraryT = useTranslations('itinerary');
  const tasksT = useTranslations('tripMode.tasks');
  const locale = useLocale();
  const { context, itinerary, refresh, reservations, status } = useTripModeData();
  const tripContext = useTripContext();
  const trip = tripContext?.trip ?? null;
  const tripModeTasks = useTripModeTasks();
  const tripInfo = useTripResource(queryKeys.tripInfo(tripId), () => fetchTripInfo(tripId));
  const expenses = useTripResource(queryKeys.expenses(tripId), () => fetchExpenses(tripId));
  // The same trip-wide answer Today and the day rail read, so an upcoming-day
  // list costs nothing beyond what the traveller has already paid for once.
  const { data: weather } = useTripWeather(tripId);
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
        icon={<Icons.Error aria-hidden="true" />}
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
  const countries = namedCountryLine(trip.countries, locale);
  const destinations = tripDestinationSummary(trip);
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
  // Where the traveller is in the trip, counted on the trip's own dates. Preview
  // only ever selects a day inside them, so the count stays inside its bounds.
  const dayMs = 86_400_000;
  const tripStart = Date.parse(`${trip.startDate}T00:00:00.000Z`);
  const totalTripDays =
    Math.round((Date.parse(`${trip.endDate}T00:00:00.000Z`) - tripStart) / dayMs) + 1;
  const tripDayNumber = Math.min(
    totalTripDays,
    Math.max(
      1,
      Math.round((Date.parse(`${context.selectedDate}T00:00:00.000Z`) - tripStart) / dayMs) + 1,
    ),
  );
  const daysToGo = totalTripDays - tripDayNumber;
  const visitedCount = itinerary.days.reduce(
    (count, day) => count + day.items.filter((item) => item.travelStatus === 'completed').length,
    0,
  );
  // "9 – 13 Oct" rather than two full dates: it has a third of a phone to fit in.
  const dateRangeShort = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).formatRange(
    new Date(`${trip.startDate}T00:00:00.000Z`),
    new Date(`${trip.endDate}T00:00:00.000Z`),
  );
  const dayChip = (value: string) => ({
    number: new Intl.DateTimeFormat(locale, { day: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${value}T00:00:00.000Z`),
    ),
    weekday: new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short' }).format(
      new Date(`${value}T00:00:00.000Z`),
    ),
  });
  const tools: Tool[] = [
    {
      descriptionKey: 'itineraryDescription',
      href: `/trips/${tripId}/itinerary`,
      icon: tripSectionIcons.itinerary,
      key: 'itinerary',
    },
    {
      descriptionKey: 'placesDescription',
      onSelect: openPlaces,
      icon: tripSectionIcons.places,
      key: 'places',
    },
    {
      descriptionKey: 'reservationsDescription',
      href: `/trips/${tripId}/reservations`,
      icon: tripSectionIcons.reservations,
      key: 'reservations',
    },
    {
      descriptionKey: 'expensesDescription',
      href: `/trips/${tripId}/expenses`,
      icon: tripSectionIcons.expenses,
      key: 'expenses',
    },
    {
      descriptionKey: 'notesDescription',
      href: itineraryHref,
      icon: tripSectionIcons.notes,
      key: 'notes',
    },
    {
      descriptionKey: 'infoDescription',
      href: `/trips/${tripId}/info`,
      icon: tripSectionIcons.info,
      key: 'info',
    },
  ];
  const allTasks = tripModeTasks.data?.tasks ?? [];
  const tripWideTasks = tripTasks(allTasks);
  const contextualTaskCount = allTasks.filter((task) => task.context.kind !== 'trip').length;
  const openTripTaskCount = tripWideTasks.filter((task) => !task.completed).length;

  return (
    <div className="space-y-8 pb-2 sm:space-y-10">
      <h2 className="sr-only">{t('title')}</h2>

      {/* Where the traveller is in the whole trip, on the same dark surface Now
          gives the next move: the trip at a glance, before its tools. */}
      <section
        aria-labelledby="trip-mode-summary-heading"
        className="rounded-[1.75rem] bg-[color:var(--score-media-background)] p-5 text-[color:var(--score-media-foreground)] shadow-[var(--shadow-card)] sm:p-6 dark:ring-1 dark:ring-border"
      >
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            {/* The country the trip declared, with the destinations after it: a
                traveller in Trip Mode is already somewhere, and the country is
                the line that orients them. */}
            <p className="truncate text-[length:var(--text-metadata)] font-semibold tracking-[0.08em] text-[color:var(--score-media-brand)] uppercase">
              {countries ?? destinations ?? trip.name}
            </p>
            <h3
              className="mt-1 font-journal text-[2.5rem] leading-none font-normal tracking-[-0.01em] tabular-nums"
              id="trip-mode-summary-heading"
            >
              {t('summaryDay', { number: tripDayNumber, total: totalTripDays })}
            </h3>
          </div>
          <p className="shrink-0 pb-1 text-sm text-[color:var(--score-media-muted)] tabular-nums">
            {t('daysToGo', { count: daysToGo })}
          </p>
        </div>
        <div aria-hidden="true" className="mt-4 flex gap-1">
          {Array.from({ length: totalTripDays }, (_, index) => (
            <span
              className={cn(
                'h-1.5 flex-1 rounded-full',
                index + 1 < tripDayNumber
                  ? 'bg-[color:var(--score-media-brand)]'
                  : index + 1 === tripDayNumber
                    ? 'bg-accent'
                    : 'bg-[color:var(--score-media-foreground)]/15',
              )}
              key={index}
            />
          ))}
        </div>
        {/* Each figure reads value-first; the term still leads in the markup. */}
        <dl className="mt-5 grid grid-cols-3 gap-3">
          <div className="flex min-w-0 flex-col-reverse">
            <dt className="text-xs text-[color:var(--score-media-muted)]">{t('dates')}</dt>
            <dd className="truncate text-base font-semibold tabular-nums">{dateRangeShort}</dd>
          </div>
          <div className="flex min-w-0 flex-col-reverse">
            <dt className="text-xs text-[color:var(--score-media-muted)]">{t('travellers')}</dt>
            <dd className="text-base font-semibold tabular-nums">{trip.partySize}</dd>
          </div>
          <div className="flex min-w-0 flex-col-reverse">
            <dt className="text-xs text-[color:var(--score-media-muted)]">{t('visited')}</dt>
            <dd className="text-base font-semibold tabular-nums">{visitedCount}</dd>
          </div>
        </dl>
        {countries && destinations ? (
          <p className="mt-4 text-[length:var(--text-metadata)] leading-5 text-[color:var(--score-media-muted)]">
            {destinations}
          </p>
        ) : null}
      </section>

      {/* The traveller's own account of the trip, when they have written one.
          It stays out of the notes list below: that list is reminders. */}
      {tripDescription ? (
        <p className="max-w-[var(--layout-reading)] text-sm leading-[1.55] whitespace-pre-wrap text-pretty text-muted-foreground">
          {tripDescription}
        </p>
      ) : null}

      <EditorialSection
        actions={
          <>
            <TripModeActionButton
              disabled={tripModeTasks.status !== 'ready'}
              onClick={() => tripModeTasks.openCreate({ kind: 'trip' })}
            >
              <Plus aria-hidden="true" data-icon="inline-start" />
              {tasksT('add')}
            </TripModeActionButton>
            <TripModeActionButton
              className="bg-transparent hover:bg-muted"
              nativeButton={false}
              render={<Link href={`/trips/${tripId}/tasks`} />}
            >
              {tasksT('manage')}
            </TripModeActionButton>
          </>
        }
        className={cn('p-5 sm:p-6', tripModeCardClass)}
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
                <Icons.Success aria-hidden="true" className="text-brand" />
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
              <ItemGroup className="gap-2" variant="list">
                {visibleDays.map((day, index) => {
                  // The same ladder Today's hero uses: the day's name, then the
                  // town it is safely in, then its date.
                  const dayTitle = day.name?.trim() || dayTown(day, itinerary.tripPlaces);
                  return (
                    <Item
                      className="rounded-[var(--radius-xl)] border border-border-subtle bg-card shadow-[var(--shadow-control)]"
                      key={day.id}
                      render={
                        <Link
                          href={`/trips/${tripId}/itinerary?day=${encodeURIComponent(day.id)}`}
                        />
                      }
                    >
                      <ItemMedia
                        aria-hidden="true"
                        className="w-10 flex-col gap-0 text-center tabular-nums"
                      >
                        <span className="text-[0.6875rem] leading-4 text-muted-foreground">
                          {dayChip(day.date).weekday}
                        </span>
                        <span className="text-lg leading-5 font-semibold text-foreground">
                          {dayChip(day.date).number}
                        </span>
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle className="font-journal text-[1.3125rem] leading-[1.1] font-normal">
                          {dayTitle ?? dateFormatter.format(new Date(`${day.date}T00:00:00.000Z`))}
                        </ItemTitle>
                        <ItemDescription>
                          {dayTitle
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
                      <TripDayWeather forecast={tripWeatherForDate(weather, day.date)} />
                      <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
                    </Item>
                  );
                })}
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
            {/* Places stays over Trip Mode; the other tiles navigate to their tools. */}
            <div className="grid grid-cols-2 gap-3">
              {tools.map((tool) => {
                const { descriptionKey, icon: Icon, key } = tool;
                return (
                  <TripToolTile key={key} tool={tool}>
                    <Icon aria-hidden="true" className="size-5 text-brand" />
                    <span>
                      <span className="block font-semibold text-foreground">
                        {t(`tools.${key}`)}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1 text-[length:var(--text-metadata)] leading-5 text-muted-foreground">
                        <span className="min-w-0 truncate">
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
                        </span>
                        <ChevronRight
                          aria-hidden="true"
                          className="size-3.5 shrink-0 text-text-subtle transition-transform duration-[var(--motion-standard)] ease-[var(--ease-standard)] group-hover:translate-x-0.5 motion-reduce:transition-none"
                        />
                      </span>
                    </span>
                  </TripToolTile>
                );
              })}
            </div>
          </EditorialSection>

          {/* Preparing the device is housekeeping, not travelling: it closes the
              page rather than opening it, and stays folded until asked. */}
          <OfflineReadyStatus tripId={tripId} variant="compact" />
        </div>
      </div>
    </div>
  );
}
