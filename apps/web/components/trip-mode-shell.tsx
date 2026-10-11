'use client';

import { useTripPlacesDrawer } from '@/components/trip-places-provider';

import { dayActionLink } from '@/lib/plan-score/presentation';

import { CalendarDays, ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { CSSProperties, ReactNode, Ref } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { ContentSkeleton } from '@/components/content-skeleton';
import { PageState } from '@/components/page-state';
import { PlaceDetailsSheet, type PlaceDetailsRow } from '@/components/place-details-sheet';
import { usePreferences } from '@/components/preferences-provider';
import { PlanScorePanel } from '@/components/plan-score-panel';
import { TripModeTabBar, TripModeTopBar, tripModeViews } from '@/components/trip-mode-chrome';
import { TripModeMapView } from '@/components/trip-mode-map-view';
import { TripModeDataProvider } from '@/components/trip-mode-data';
import { TripSyncStatus } from '@/components/trip-sync-status';
import { TripModeExpenseProvider } from '@/components/trip-mode-expense-sheet';
import { TripModeTasksProvider } from '@/components/trip-mode-tasks';
import { tripModeCardClass } from '@/components/trip-mode-ui';
import { useTripContext } from '@/components/trip-provider';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  deviceTimeZone,
  fetchItinerary,
  type ItineraryTripPlace,
  type TripModeContextRequestOptions,
} from '@/lib/itinerary/api';
import { useEditorialImages } from '@/hooks/use-editorial-images';
import { tripModeMapLifecycle } from '@/lib/maps/map-retention';
import { editorialSubjectKey, type EditorialSubject } from '@/lib/media/editorial-images';
import { isNavigationPathActive } from '@/lib/navigation';
import { useTripPlanScore } from '@/lib/plan-score/use-trip-plan-score';
import { queryKeys } from '@/lib/query/keys';
import { useTripResource } from '@/lib/query/use-trip-resource';
import { resolveProviderPlaceName, resolveTripPlaceName } from '@/lib/trip-places/place-name';
import { isTripModeAvailable } from '@/lib/trips/navigation';
import { cn } from '@/lib/utils';
import * as Icons from '@/lib/icons';

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
  openPlaceDetails: (tripPlace: ItineraryTripPlace, visitDate?: string | null) => void;
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
  endDate: string;
  onChange: (next: { date?: string; time?: string }) => void;
  ref?: Ref<HTMLElement>;
  selection: PreviewSelection;
  startDate: string;
};

const MINUTES_PER_DAY = 24 * 60;
const PREVIEW_TIME_STEP_MINUTES = 5;
const DAY_MS = 86_400_000;

function minutesFromTime(time: string) {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function timeFromMinutes(minutes: number) {
  const clamped = Math.min(Math.max(Math.round(minutes), 0), MINUTES_PER_DAY - 1);
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

/**
 * The two controls that define the active Preview state, always in view.
 *
 * Preview identifies itself here rather than in the header, and neither value
 * sits behind a field or a Change step: the day moves a tap at a time on the
 * stepper, and the time moves along the bar. The bar moves only its own reading
 * while it is dragged and writes the URL once, on release - every committed
 * value asks the server for that moment's context, and a drag across the day
 * should be one question, not two hundred.
 */
function TripModePreviewControls({
  endDate,
  onChange,
  ref,
  selection,
  startDate,
}: Readonly<PreviewControlsProps>) {
  const t = useTranslations('tripMode');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const previousDate = adjacentPreviewDate(selection.date, -1, startDate, endDate);
  const nextDate = adjacentPreviewDate(selection.date, 1, startDate, endDate);
  const committedMinutes = minutesFromTime(selection.time);
  const [scrubMinutes, setScrubMinutes] = useState<number | null>(null);
  const minutes = scrubMinutes ?? committedMinutes;

  // A committed value replaces the scrub reading.
  useEffect(() => {
    setScrubMinutes(null);
  }, [selection.time]);

  const formatClock = (value: number) =>
    new Intl.DateTimeFormat(locale, {
      hour: 'numeric',
      hour12: preferences.timeFormat === '12h',
      minute: '2-digit',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(2000, 0, 1, Math.floor(value / 60), value % 60)));
  // Counted on the trip's own dates, so the stepper says which day of the trip
  // this is the same way every other Trip Mode surface does.
  const dayNumber =
    Math.round(
      (Date.parse(`${selection.date}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`)) /
        DAY_MS,
    ) + 1;
  const dayLabel = t('preview.dayLabel', {
    date: new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
      weekday: 'short',
    }).format(new Date(`${selection.date}T00:00:00.000Z`)),
    number: dayNumber,
  });

  return (
    <section
      aria-label={t('preview.label')}
      // Above the Map view's map, which runs full screen behind the bars: the
      // controls are how Preview identifies itself, so nothing may cover them.
      className="relative z-[3] rounded-[var(--radius-2xl)] bg-secondary px-4 pt-1.5 pb-3 text-secondary-foreground"
      data-slot="trip-mode-preview-controls"
      ref={ref}
    >
      <div className="flex items-center gap-2">
        <p className="inline-flex min-w-0 flex-1 items-center gap-1.5 text-[0.8125rem] font-semibold">
          <Eye aria-hidden="true" className="size-4 shrink-0" />
          {t('preview.badge')}
        </p>
        {/* Stepping a day at a time is the move Preview is made for. */}
        <Button
          aria-label={t('preview.previousDay')}
          className="-me-1 hover:bg-secondary-foreground/8"
          disabled={!previousDate}
          onClick={() => previousDate && onChange({ date: previousDate })}
          size="icon"
          variant="ghost"
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <p
          aria-live="polite"
          className="shrink-0 text-[0.9375rem] font-semibold whitespace-nowrap tabular-nums"
        >
          {dayLabel}
        </p>
        <Button
          aria-label={t('preview.nextDay')}
          className="-ms-1 -me-2 hover:bg-secondary-foreground/8"
          disabled={!nextDate}
          onClick={() => nextDate && onChange({ date: nextDate })}
          size="icon"
          variant="ghost"
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
      <div className="mt-0.5 flex items-center gap-4">
        <div className="shrink-0">
          <p className="text-[0.6875rem] leading-4 font-semibold" id="trip-mode-preview-time-label">
            {t('preview.time')}
          </p>
          <p
            aria-hidden="true"
            className="text-2xl leading-7 font-semibold tracking-[-0.01em] tabular-nums"
          >
            {formatClock(minutes)}
          </p>
        </div>
        <Slider
          className="min-w-0 flex-1"
          getAriaValueText={(_formatted, value) => formatClock(value)}
          largeStep={60}
          max={MINUTES_PER_DAY - PREVIEW_TIME_STEP_MINUTES}
          min={0}
          onValueChange={(value) => setScrubMinutes(value as number)}
          onValueCommitted={(value) => onChange({ time: timeFromMinutes(value as number) })}
          step={PREVIEW_TIME_STEP_MINUTES}
          thumbLabelledBy="trip-mode-preview-time-label"
          value={minutes}
        />
      </div>
    </section>
  );
}

function TripModePreviewPlanScore({
  className,
  date,
  tripId,
}: Readonly<{ className?: string; date: string; tripId: string }>) {
  const planScoreTranslations = useTranslations('planScore');
  const { openPlaces } = useTripPlacesDrawer();
  const planScore = useTripPlanScore(tripId);
  const previewDayScore = planScore.data?.days.find((day) => day.date === date) ?? null;
  const planScoreHidden =
    planScore.status === 'disabled' ||
    Boolean(
      planScore.data?.withheldReasons.includes('ADMINISTRATIVELY_DISABLED') ||
      previewDayScore?.withheldReasons.includes('ADMINISTRATIVELY_DISABLED'),
    );

  if (planScoreHidden) return null;

  return (
    <PlanScorePanel
      onOpenTripPlaces={openPlaces}
      className={cn(tripModeCardClass, 'p-4', className)}
      density="compact"
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
      assessment={planScore.data}
      dayId={previewDayScore?.dayId}
      change={planScore.changeFor(previewDayScore?.dayId ?? '')}
      resolveAction={(explanation) =>
        planScore.data ? dayActionLink(tripId, planScore.data, explanation) : null
      }
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
  const [detailsVisitDate, setDetailsVisitDate] = useState<string | null>();
  // The Map view is built here rather than by its route, so a map already paid
  // for survives a trip to Today and back instead of being built again.
  const onMapView = isNavigationPathActive(pathname, `/trips/${tripId}/mode/map`);
  const [mapVisited, setMapVisited] = useState(onMapView);
  useEffect(() => {
    if (onMapView) setMapVisited(true);
  }, [onMapView]);
  const mapLifecycle = tripModeMapLifecycle({ onMapView, visited: mapVisited });
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
  const openPlaceDetails = useCallback(
    (tripPlace: ItineraryTripPlace, visitDate?: string | null) => {
      setDetailsPlace(tripPlace);
      setDetailsVisitDate(visitDate);
    },
    [],
  );
  const placeDetailsContext = useMemo(() => ({ openPlaceDetails }), [openPlaceDetails]);
  const [previewControlsHeight, setPreviewControlsHeight] = useState(0);
  const previewControlsRef = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    // Read once now as well: the observer's first report waits for a rendering
    // step, and until it arrives the Map sheet would be capped as if the
    // controls were not there.
    setPreviewControlsHeight(node.offsetHeight);
    const observer = new ResizeObserver(() => setPreviewControlsHeight(node.offsetHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

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
        <TripModeTopBar tripId={tripId} tripName={null} />

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
          icon={<Icons.Error aria-hidden="true" />}
          kind="error"
          title={t('loadError')}
        />
      </section>
    );
  }

  const trip = contextTrip;
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
          <TripModeExpenseProvider tripId={trip.id}>
            <section
              className="mx-auto flex min-h-[calc(100dvh-var(--safe-top))] w-full max-w-6xl flex-col lg:min-h-0 gap-2"
              // How far the Preview controls reach below the header, for anything
              // that floats over the full-screen map and must clear them.
              style={
                {
                  '--trip-mode-preview-offset': previewSelection
                    ? `${previewControlsHeight + 8}px`
                    : '0px',
                } as CSSProperties
              }
              data-slot="trip-mode-shell"
            >
              <TripModeTopBar tripId={trip.id} tripName={trip.name} />

              {/* Fixed to the foot of a phone, in the thumb's reach; a plain row
                under the bar on a desktop, which has no thumb zone to aim at.
                Ordered here so that row lands where a reader looks for it. */}
              <TripModeTabBar tripId={trip.id} withPreviewHref={withPreviewHref} />

              {previewSelection ? (
                <TripModePreviewControls
                  endDate={trip.endDate}
                  onChange={updatePreview}
                  ref={previewControlsRef}
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
                  {mapLifecycle.render ? (
                    <div
                      className={mapLifecycle.active ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}
                    >
                      <TripModeMapView active={mapLifecycle.active} tripId={trip.id} />
                    </div>
                  ) : null}
                </TripModePlaceDetailsContext.Provider>

                {/* Day quality is a review of the plan, not an answer to "what do I
                  need now". Above the view it was the largest single thing between a
                  phone and its own itinerary. It stays inside this container so the
                  tab bar's padding lands below it, not above it. */}
                {planScoreEnabled && previewSelection ? (
                  <TripModePreviewPlanScore
                    className="mt-4"
                    date={previewSelection.date}
                    tripId={trip.id}
                  />
                ) : null}
              </div>
            </section>

            {detailsPlace ? (
              <PlaceDetailsSheet
                key={detailsPlace.place.id}
                editorialImages={detailsEditorialImages}
                meta={[
                  detailsPlace.priority
                    ? {
                        label: tripPlacesT('priorityLabel'),
                        value: tripPlacesT(`priority.${detailsPlace.priority}`),
                      }
                    : null,
                  detailsPlace.note
                    ? { label: itineraryT('notes'), value: detailsPlace.note }
                    : null,
                ].filter((row): row is PlaceDetailsRow => row !== null)}
                name={resolveTripPlaceName(detailsPlace, {
                  custom: itineraryT('customPlace'),
                  provider: itineraryT('providerPlace'),
                })}
                officialName={detailsPlace.customName?.trim() ? detailsProviderName : null}
                onOpenChange={(open) => !open && setDetailsPlace(null)}
                place={detailsPlace.place}
                visitDate={detailsVisitDate}
              />
            ) : null}
          </TripModeExpenseProvider>
        </TripModeTasksProvider>
      </TripModeDataProvider>
    </TripModePreviewProvider>
  );
}
