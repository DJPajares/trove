'use client';

import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Compass, Eye } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { DatePicker } from '@/components/date-picker';
import { ContentSkeleton } from '@/components/content-skeleton';
import { PageState } from '@/components/page-state';
import { PlaceDetailsSheet, type PlaceDetailsRow } from '@/components/place-details-sheet';
import { usePreferences } from '@/components/preferences-provider';
import { TimeInput } from '@/components/time-input';
import { PlanScorePanel } from '@/components/plan-score-panel';
import { TripModeTabBar, TripModeTopBar, tripModeViews } from '@/components/trip-mode-chrome';
import { TripModeDataProvider } from '@/components/trip-mode-data';
import { TripSyncStatus } from '@/components/trip-sync-status';
import { TripModeTasksProvider } from '@/components/trip-mode-tasks';
import { useTripContext } from '@/components/trip-provider';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import {
  deviceTimeZone,
  fetchItinerary,
  type ItineraryTripPlace,
  type TripModeContextRequestOptions,
} from '@/lib/itinerary/api';
import { useEditorialImages } from '@/hooks/use-editorial-images';
import { editorialSubjectKey, type EditorialSubject } from '@/lib/media/editorial-images';
import { useTripPlanScore } from '@/lib/plan-score/use-trip-plan-score';
import { queryKeys } from '@/lib/query/keys';
import { useTripResource } from '@/lib/query/use-trip-resource';
import { resolveProviderPlaceName, resolveTripPlaceName } from '@/lib/trip-places/place-name';
import { isTripModeAvailable } from '@/lib/trips/navigation';
import { cn } from '@/lib/utils';

type PreviewSelection = { date: string; time: string };

type TripModePreviewContextValue = {
  contextOptions: (signal?: AbortSignal) => TripModeContextRequestOptions;
  isPreview: boolean;
  previewSelection: PreviewSelection | null;
  updatePreview: (next: { date?: string; time?: string }) => void;
  withPreviewHref: (href: string) => string;
};

const TripModePreviewContext = createContext<TripModePreviewContextValue>({
  contextOptions: (signal) => ({ signal }),
  isPreview: false,
  previewSelection: null,
  updatePreview: () => undefined,
  withPreviewHref: (href) => href,
});

function TripModePreviewProvider({
  children,
  value,
}: Readonly<{ children: ReactNode; value: TripModePreviewContextValue }>) {
  return (
    <TripModePreviewContext.Provider value={value}>{children}</TripModePreviewContext.Provider>
  );
}

export function useTripModePreview() {
  return useContext(TripModePreviewContext);
}

type TripModePlaceDetailsContextValue = {
  openPlaceDetails: (tripPlace: ItineraryTripPlace) => void;
};

const TripModePlaceDetailsContext = createContext<TripModePlaceDetailsContextValue>({
  openPlaceDetails: () => undefined,
});

export function useTripModePlaceDetails() {
  return useContext(TripModePlaceDetailsContext);
}

type TripModeShellProps = {
  children: ReactNode;
  planScoreEnabled: boolean;
  tripId: string;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function addPreviewParams(href: string, date: string, time: string) {
  const hashIndex = href.indexOf('#');
  const pathAndQuery = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const hash = hashIndex >= 0 ? href.slice(hashIndex + 1) : '';
  const queryIndex = pathAndQuery.indexOf('?');
  const path = queryIndex >= 0 ? pathAndQuery.slice(0, queryIndex) : pathAndQuery;
  const query = queryIndex >= 0 ? pathAndQuery.slice(queryIndex + 1) : '';
  const params = new URLSearchParams(query);
  params.set('preview', '1');
  params.set('date', date);
  params.set('time', time);
  return `${path}?${params.toString()}${hash ? `#${hash}` : ''}`;
}

/**
 * The previewed day one step in `offset`, or `null` when that step would leave
 * the trip. ISO dates sort as strings, so the bounds check needs no parsing.
 */
function adjacentPreviewDate(date: string, offset: number, startDate: string, endDate: string) {
  const [year = 1970, month = 1, day = 1] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
  return shifted >= startDate && shifted <= endDate ? shifted : null;
}

type PreviewControlsProps = {
  activityCounts: Readonly<Record<string, number>>;
  endDate: string;
  idPrefix: string;
  onChange: (next: { date?: string; time?: string }) => void;
  selection: PreviewSelection;
  startDate: string;
};

/** The two controls that define the active Preview state. */
function TripModePreviewControls({
  activityCounts,
  endDate,
  idPrefix,
  onChange,
  selection,
  startDate,
}: Readonly<PreviewControlsProps>) {
  const t = useTranslations('tripMode');
  const previousDate = adjacentPreviewDate(selection.date, -1, startDate, endDate);
  const nextDate = adjacentPreviewDate(selection.date, 1, startDate, endDate);

  return (
    <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
      <Field className="min-w-0">
        <FieldLabel htmlFor={`${idPrefix}-date`}>{t('preview.date')}</FieldLabel>
        {/* Stepping a day at a time is the move Preview is made for, so it
            costs a tap rather than a trip through the calendar. */}
        <div className="flex items-center gap-2">
          <Button
            aria-label={t('preview.previousDay')}
            disabled={!previousDate}
            onClick={() => previousDate && onChange({ date: previousDate })}
            size="icon"
            variant="outline"
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <DatePicker
            activityCounts={activityCounts}
            className="min-w-0 flex-1"
            clearable={false}
            id={`${idPrefix}-date`}
            label={t('preview.date')}
            max={endDate}
            min={startDate}
            onChange={(date) => date && onChange({ date })}
            required
            value={selection.date}
          />
          <Button
            aria-label={t('preview.nextDay')}
            disabled={!nextDate}
            onClick={() => nextDate && onChange({ date: nextDate })}
            size="icon"
            variant="outline"
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </Field>
      <Field className="min-w-0">
        <FieldLabel htmlFor={`${idPrefix}-time`}>{t('preview.time')}</FieldLabel>
        <TimeInput
          id={`${idPrefix}-time`}
          onValueChange={(time) => time && onChange({ time })}
          required
          value={selection.time}
        />
        <FieldDescription>{t('preview.timeDescription')}</FieldDescription>
      </Field>
    </div>
  );
}

/**
 * Keeps the current simulated moment visible and immediately adjustable before
 * the traveller moves into the previewed Trip Mode experience.
 */
function TripModePreviewSummary({
  activityCounts,
  endDate,
  onChange,
  selection,
  startDate,
}: Readonly<Omit<PreviewControlsProps, 'idPrefix'>>) {
  const t = useTranslations('tripMode');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const [controlsOpen, setControlsOpen] = useState(false);

  const dateLabel = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    weekday: 'short',
  }).format(new Date(`${selection.date}T00:00:00.000Z`));
  const [hour, minute] = selection.time.split(':').map(Number);
  const timeLabel = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    hour12: preferences.timeFormat === '12h',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2000, 0, 1, hour ?? 9, minute ?? 0)));
  const summary = t('preview.summary', { date: dateLabel, time: timeLabel });

  return (
    // Which day is being previewed is worth one line; the controls that change
    // it are worth a row only while they are being used. Open they cost about
    // 300px, which on the map was most of the map.
    <Collapsible
      className="-mx-[var(--gutter-inline-start)] border-y border-accent-strong/35 bg-accent-strong/8"
      onOpenChange={setControlsOpen}
      open={controlsOpen}
    >
      <div className="flex items-center gap-2.5 px-[var(--gutter-inline-start)] py-2 sm:gap-3">
        <Eye aria-hidden="true" className="size-4 shrink-0 text-accent-strong" />
        <p className="min-w-0 flex-1 text-sm leading-5 font-medium text-pretty text-foreground">
          {summary}
        </p>
        <CollapsibleTrigger
          className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-[var(--radius-md)] px-2 text-[length:var(--text-metadata)] font-medium text-accent-strong outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          render={<button type="button" />}
        >
          {t(controlsOpen ? 'preview.hideControls' : 'preview.showControls')}
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'size-3.5 transition-transform duration-[var(--motion-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none',
              controlsOpen && 'rotate-180',
            )}
          />
        </CollapsibleTrigger>
      </div>
      <CollapsiblePanel>
        <div className="border-t border-accent-strong/25 px-[var(--gutter-inline-start)] py-4">
          <TripModePreviewControls
            activityCounts={activityCounts}
            endDate={endDate}
            idPrefix="trip-mode-preview-controls"
            onChange={onChange}
            selection={selection}
            startDate={startDate}
          />
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

function TripModePreviewPlanScore({ date, tripId }: Readonly<{ date: string; tripId: string }>) {
  const planScoreTranslations = useTranslations('planScore');
  const planScore = useTripPlanScore(tripId);
  const previewDayScore = planScore.data?.days.find((day) => day.date === date) ?? null;
  const planScoreHidden =
    planScore.status === 'disabled' ||
    Boolean(
      planScore.data?.withheldReasons.includes('ADMINISTRATIVELY_DISABLED') ||
      previewDayScore?.withheldReasons.includes('ADMINISTRATIVELY_DISABLED'),
    );

  if (planScoreHidden || (!previewDayScore && planScore.status !== 'error')) return null;

  return (
    <PlanScorePanel
      completeness={previewDayScore?.completeness ?? null}
      confidence={previewDayScore?.confidence ?? null}
      disabled={previewDayScore?.withheldReasons.includes('ADMINISTRATIVELY_DISABLED')}
      explanations={
        previewDayScore?.explanations ?? {
          uncertainty: [],
          whatWorks: [],
          worthImproving: [],
        }
      }
      factors={previewDayScore?.factors}
      onRetry={planScore.retry}
      score={previewDayScore?.score ?? null}
      scope="day"
      status={planScore.status}
      title={planScoreTranslations('dayTitle')}
    />
  );
}

export function TripModeShell({
  children,
  planScoreEnabled,
  tripId,
}: Readonly<TripModeShellProps>) {
  const t = useTranslations('tripMode');
  const itineraryT = useTranslations('itinerary');
  const tripPlacesT = useTranslations('tripPlaces');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tripContext = useTripContext();
  const contextTrip = tripContext?.trip ?? null;
  const {
    data: itinerary,
    refresh: refreshItinerary,
    status: itineraryStatus,
  } = useTripResource(queryKeys.itinerary(tripId), () => fetchItinerary(tripId));
  const [detailsPlace, setDetailsPlace] = useState<ItineraryTripPlace | null>(null);
  const detailsProviderName = detailsPlace ? resolveProviderPlaceName(detailsPlace) : null;
  const detailsSubjects: EditorialSubject[] =
    detailsPlace && detailsProviderName
      ? [
          {
            category: detailsPlace.place.snapshot?.category,
            name: detailsProviderName,
            placeId: detailsPlace.place.id,
          },
        ]
      : [];
  const detailsImages = useEditorialImages(detailsSubjects);
  const detailsEditorialImages = detailsSubjects[0]
    ? (detailsImages.get(editorialSubjectKey(detailsSubjects[0])) ?? [])
    : [];
  const openPlaceDetails = useCallback((tripPlace: ItineraryTripPlace) => {
    setDetailsPlace(tripPlace);
  }, []);
  const placeDetailsContext = useMemo(() => ({ openPlaceDetails }), [openPlaceDetails]);

  const isPreview = searchParams.get('preview') === '1';
  const requestedDate = searchParams.get('date');
  const requestedTime = searchParams.get('time');
  const previewDate =
    contextTrip &&
    requestedDate &&
    DATE_PATTERN.test(requestedDate) &&
    requestedDate >= contextTrip.startDate &&
    requestedDate <= contextTrip.endDate
      ? requestedDate
      : (contextTrip?.startDate ?? '');
  const previewTime = requestedTime && TIME_PATTERN.test(requestedTime) ? requestedTime : '09:00';
  const previewSelection = useMemo(
    () => (isPreview && previewDate ? { date: previewDate, time: previewTime } : null),
    [isPreview, previewDate, previewTime],
  );
  // Read once per render rather than per call, so every request in a render
  // asks about the same clock.
  const clockTimeZone = deviceTimeZone();
  const contextOptions = useCallback<TripModePreviewContextValue['contextOptions']>(
    (signal) =>
      previewSelection
        ? {
            clockTimeZone,
            date: previewSelection.date,
            languageCode: locale,
            signal,
            time: previewSelection.time,
          }
        : { clockTimeZone, languageCode: locale, signal },
    [clockTimeZone, locale, previewSelection],
  );
  const withPreviewHref = useCallback<TripModePreviewContextValue['withPreviewHref']>(
    (href) =>
      previewSelection
        ? addPreviewParams(href, previewSelection.date, previewSelection.time)
        : href,
    [previewSelection],
  );
  const updatePreview = useCallback(
    (next: { date?: string; time?: string }) => {
      if (!previewSelection) return;
      const params = new URLSearchParams(searchParams.toString());
      params.set('preview', '1');
      params.set('date', next.date ?? previewSelection.date);
      params.set('time', next.time ?? previewSelection.time);
      window.history.replaceState(null, '', `${pathname}?${params.toString()}`);
    },
    [pathname, previewSelection, searchParams],
  );

  const previewContext = useMemo<TripModePreviewContextValue>(
    () => ({
      contextOptions,
      isPreview: Boolean(previewSelection),
      previewSelection,
      // Views step the previewed day too - Today's day strip does - and they
      // must step it the same fast way the banner's own arrows do.
      updatePreview,
      withPreviewHref,
    }),
    [contextOptions, previewSelection, updatePreview, withPreviewHref],
  );

  useEffect(() => {
    if (!contextTrip || itineraryStatus !== 'idle' || !navigator.onLine) return;
    const basePath = `/trips/${contextTrip.id}/mode`;
    for (const { path } of tripModeViews) router.prefetch(`${basePath}${path}`);
  }, [contextTrip, itineraryStatus, router]);

  /**
   * Stepping the preview writes the URL itself rather than routing to it.
   *
   * Which day is being previewed is still part of where you are, so it still
   * belongs in the address bar. But `router.replace` treats it as a
   * destination: the App Router fetches a fresh RSC payload, the service worker
   * takes it network-first, and only once that lands does `useSearchParams`
   * move - which is when the request for the day actually starts. Next patches
   * the history API to feed the router directly, so this arrives at the same
   * place without asking the server what a query string means.
   */

  if (tripContext?.status === 'loading' || itineraryStatus === 'loading') {
    // The shell's own frame, at the size it will be: the way out, the four
    // views and the box the view lands in are all knowable from the trip's id
    // alone, so only the trip's name waits — and it waits in place.
    return (
      <section
        aria-busy="true"
        className="mx-auto flex min-h-[calc(100dvh-var(--safe-top))] w-full max-w-6xl flex-col lg:min-h-0"
        data-slot="trip-mode-shell"
        role="status"
      >
        <span className="sr-only">{t('loading')}</span>
        <TripModeTopBar
          timeZone={deviceTimeZone() ?? contextTrip?.referenceTimeZone ?? null}
          tripId={tripId}
          tripName={null}
        />

        <TripModeTabBar tripId={tripId} />

        <div className="flex min-h-[min(32rem,55dvh)] flex-1 flex-col pt-6 pb-[calc(var(--bottom-bar-height)+var(--safe-bottom)+1rem)] sm:pt-8 lg:pb-8">
          <ContentSkeleton shape="timeline" />
        </div>
      </section>
    );
  }

  if (
    !tripContext ||
    tripContext.status === 'error' ||
    tripContext.status === 'missing' ||
    itineraryStatus === 'error' ||
    !contextTrip ||
    !itinerary
  ) {
    return (
      <section className="mx-auto w-full max-w-6xl">
        <PageState
          actions={
            <>
              <Button
                onClick={() => {
                  tripContext?.refresh();
                  void refreshItinerary();
                }}
              >
                {t('tryAgain')}
              </Button>
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

  const trip = contextTrip;
  const activityCounts = Object.fromEntries(
    itinerary.days.map((day) => [day.date, day.items.length]),
  );
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  });
  const formatDate = (date: string) => dateFormatter.format(new Date(`${date}T00:00:00.000Z`));

  if (!isTripModeAvailable(trip.lifecycle, Boolean(previewSelection))) {
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

  return (
    <TripModePreviewProvider value={previewContext}>
      <TripModeDataProvider
        contextOptions={contextOptions}
        isPreview={Boolean(previewSelection)}
        tripId={trip.id}
      >
        <TripModeTasksProvider tripId={trip.id}>
          <section
            className="mx-auto flex min-h-[calc(100dvh-var(--safe-top))] w-full max-w-6xl flex-col lg:min-h-0"
            data-slot="trip-mode-shell"
          >
            <TripModeTopBar
              isPreview={Boolean(previewSelection)}
              timeZone={
                previewSelection
                  ? trip.referenceTimeZone
                  : (deviceTimeZone() ?? trip.referenceTimeZone)
              }
              tripId={trip.id}
              tripName={trip.name}
            />

            {/* Fixed to the foot of a phone, in the thumb's reach; a plain row
                under the bar on a desktop, which has no thumb zone to aim at.
                Ordered here so that row lands where a reader looks for it. */}
            <TripModeTabBar tripId={trip.id} withPreviewHref={withPreviewHref} />

            {previewSelection ? (
              <TripModePreviewSummary
                activityCounts={activityCounts}
                endDate={trip.endDate}
                onChange={updatePreview}
                selection={previewSelection}
                startDate={trip.startDate}
              />
            ) : null}

            <TripSyncStatus tripId={trip.id} />

            {/* The view starts where the bar ends. The padding at the foot is
                the tab bar's own height plus the safe area, so the last row of
                any view can still be reached above it. */}
            {/* `flex-1` rather than a `dvh` guess: a view that wants the rest
                of the screen gets exactly what the bars leave it, and gets it
                right again when the preview banner opens above. */}
            <div className="flex min-h-[min(32rem,55dvh)] flex-1 flex-col pt-5 pb-[calc(var(--bottom-bar-height)+var(--safe-bottom)+1rem)] sm:pt-6 lg:pb-8">
              <TripModePlaceDetailsContext.Provider value={placeDetailsContext}>
                {children}
              </TripModePlaceDetailsContext.Provider>
            </div>

            {/* Day quality is a review of the plan, not an answer to "what do I need
            now". Above the view it was the largest single thing between a phone
            and its own itinerary. */}
            {planScoreEnabled && previewSelection ? (
              <TripModePreviewPlanScore date={previewSelection.date} tripId={trip.id} />
            ) : null}
          </section>

          {detailsPlace ? (
            <PlaceDetailsSheet
              editorialImages={detailsEditorialImages}
              meta={[
                detailsPlace.priority
                  ? {
                      label: tripPlacesT('priorityLabel'),
                      value: tripPlacesT(`priority.${detailsPlace.priority}`),
                    }
                  : null,
                detailsPlace.note ? { label: itineraryT('notes'), value: detailsPlace.note } : null,
              ].filter((row): row is PlaceDetailsRow => row !== null)}
              name={resolveTripPlaceName(detailsPlace, {
                custom: itineraryT('customPlace'),
                provider: itineraryT('providerPlace'),
              })}
              officialName={detailsPlace.customName?.trim() ? detailsProviderName : null}
              onOpenChange={(open) => !open && setDetailsPlace(null)}
              place={detailsPlace.place}
            />
          ) : null}
        </TripModeTasksProvider>
      </TripModeDataProvider>
    </TripModePreviewProvider>
  );
}
