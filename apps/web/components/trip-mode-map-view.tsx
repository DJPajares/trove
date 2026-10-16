'use client';

import { useQuery } from '@tanstack/react-query';
import {
  BedDouble,
  CalendarDays,
  CircleAlert,
  Eye,
  LocateFixed,
  MapPin,
  Route,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { buildMapRouteLegs } from '@/lib/maps/map-route-selection';
import { useMapSelection } from '@/hooks/use-map-selection';
import { ItineraryPlanningMap } from '@/components/itinerary-planning-map';
import { ExpandableDescription } from '@/components/expandable-description';
import { ItineraryRouteSummary } from '@/components/itinerary-route-details';
import { PageState } from '@/components/page-state';
import { usePreferences } from '@/components/preferences-provider';
import { TripModeMapSheet } from '@/components/trip-mode-map-sheet';
import { useTripModeData } from '@/components/trip-mode-data';
import { useTripModePlaceDetails, useTripModePreview } from '@/components/trip-mode-shell';
import { useOnlineStatus } from '@/components/trip-sync-status';
import { useNowTick } from '@/hooks/use-now-tick';
import { useTravellerPosition } from '@/hooks/use-traveller-position';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  deviceTimeZone,
  fetchItineraryDayRoutes,
  type ItineraryDayRoutes,
  type ItineraryItem,
  type ItineraryTripPlace,
} from '@/lib/itinerary/api';
import { dayStopNumbers, resolveDailyBases } from '@/lib/itinerary/day-sequence';
import { placeVisitDate, scheduledPlaceUse } from '@/lib/itinerary/places';
import { itineraryDayRouteRevision } from '@/lib/itinerary/routes';
import { formatTravelDuration } from '@/lib/itinerary/route-format';
import { haversineMeters } from '@/lib/maps/haversine';
import {
  buildItineraryMapPoints,
  dailyBasePoints,
  type ItineraryMapLocation,
  type ItineraryMapPoint,
} from '@/lib/maps/itinerary-map';
import { queryKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils';
import * as Icons from '@/lib/icons';

type RouteState =
  | { data: null; status: 'error' | 'idle' | 'loading' }
  | { data: ItineraryDayRoutes; status: 'idle' };

const NEARBY_PLACE_LIMIT = 8;
const NEARBY_RADIUS_METERS = 25_000;

function MapSkeleton({ label }: Readonly<{ label: string }>) {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-6" role="status">
      <span className="sr-only">{label}</span>
      <div className="space-y-3">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-5 w-72 max-w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Skeleton className="h-[32rem] w-full rounded-[var(--radius-xl)]" />
        <Skeleton className="h-80 w-full rounded-[var(--radius-xl)]" />
      </div>
    </div>
  );
}

/**
 * `active` is false while the shell keeps this view alive, hidden, behind
 * another one. A built map is worth keeping - each construction is billed - but
 * a hidden one has no business watching the device or buying route legs.
 */
export function TripModeMapView({
  active = true,
  tripId,
}: Readonly<{ active?: boolean; tripId: string }>) {
  const t = useTranslations('tripMode.views.map');
  const nowT = useTranslations('tripMode.views.now');
  const itineraryT = useTranslations('itinerary');
  const locale = useLocale();
  const router = useRouter();
  const { preferences } = usePreferences();
  const online = useOnlineStatus();
  const { isPreview, withPreviewHref } = useTripModePreview();
  const { context, itinerary, refresh, status } = useTripModeData();
  const { openPlaceDetails } = useTripModePlaceDetails();
  const [mapControlsContainer, setMapControlsContainer] = useState<HTMLDivElement | null>(null);
  const [mapControlsExpanded, setMapControlsExpanded] = useState(false);
  const {
    position: deviceLocation,
    request: requestLocation,
    status: locationStatus,
  } = useTravellerPosition({ enabled: !isPreview && active });
  // Ticks only while the view is on screen and the clock is real.
  const now = useNowTick(!isPreview && active);

  const day = useMemo(() => {
    if (!context || !itinerary) return null;
    return itinerary.days.find((candidate) => candidate.date === context.selectedDate) ?? null;
  }, [context, itinerary]);
  const placeUse = useMemo(() => (itinerary ? scheduledPlaceUse(itinerary) : {}), [itinerary]);

  // Keyed on the day's ordering, not just its identity, so a reorder made in the
  // planner invalidates the legs this view is showing.
  const routeRevision = itineraryDayRouteRevision(day);
  const {
    selectedPointId,
    selectedRouteId,
    setSelectedPointId,
    selectRoute,
    clearSelection: clearMapSelection,
  } = useMapSelection(`${tripId}:${day?.id}:${routeRevision}`);

  const routesQuery = useQuery({
    enabled: Boolean(day && online && active),
    queryFn: ({ signal }) =>
      fetchItineraryDayRoutes(tripId, day?.id as string, {
        includePolyline: true,
        languageCode: locale,
        revision: routeRevision,
        signal,
      }),
    queryKey: queryKeys.itineraryDayRoutes(tripId, day?.id ?? '', routeRevision, true, locale),
  });
  const routeState: RouteState = routesQuery.data
    ? { data: routesQuery.data, status: 'idle' }
    : !day || !online
      ? { data: null, status: 'idle' }
      : routesQuery.error
        ? { data: null, status: 'error' }
        : routesQuery.isPending
          ? { data: null, status: 'loading' }
          : { data: null, status: 'idle' };

  if (status === 'loading') return <MapSkeleton label={t('loading')} />;

  if (status === 'error' || !context || !itinerary) {
    return (
      <PageState
        actions={<Button onClick={() => void refresh()}>{t('tryAgain')}</Button>}
        description={t('loadErrorDescription')}
        headingLevel={2}
        icon={<Icons.Error aria-hidden="true" />}
        kind="error"
        title={t('loadError')}
      />
    );
  }

  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: 'full',
    timeZone: 'UTC',
  }).format(new Date(`${context.selectedDate}T00:00:00.000Z`));
  // Names, addresses and pins all ride on the itinerary — including the copy
  // held offline — so the map is drawn without asking whether we are online.
  const placeName = (tripPlace: ItineraryTripPlace) =>
    tripPlace.place.name ??
    tripPlace.place.snapshot?.name ??
    tripPlace.place.providerLabel ??
    t('placeFallback');
  const placeLocation = (tripPlace: ItineraryTripPlace) => tripPlace.place.location ?? null;
  const itemName = (item: ItineraryItem) =>
    item.customLabel ?? (item.tripPlace ? placeName(item.tripPlace) : null) ?? t('itemFallback');
  const itemLocation = (item: ItineraryItem) =>
    item.customLocation?.label ??
    item.tripPlace?.place.snapshot?.address ??
    item.tripPlace?.place.providerAddress ??
    null;
  const formatSchedule = (item: ItineraryItem) => {
    if (item.localStartTime) {
      const [hour, minute] = item.localStartTime.split(':').map(Number);
      return new Intl.DateTimeFormat(locale, {
        hour: 'numeric',
        hour12: preferences.timeFormat === '12h',
        minute: '2-digit',
        timeZone: 'UTC',
      }).format(new Date(Date.UTC(2000, 0, 1, hour, minute)));
    }
    return item.dayPart ? t(`dayPart.${item.dayPart}`) : t('scheduleFlexible');
  };

  if (!day) {
    return (
      <PageState
        actions={
          <Button
            nativeButton={false}
            render={<Link href={withPreviewHref(`/trips/${tripId}/mode/today`)} />}
          >
            <CalendarDays aria-hidden="true" data-icon="inline-start" />
            {t('openToday')}
          </Button>
        }
        description={t('noDayDescription', { date })}
        headingLevel={2}
        icon={<MapPin aria-hidden="true" />}
        title={t('noDayTitle')}
      />
    );
  }

  // The circles on the map and the rows in Today are numbered by the same
  // function from the same inputs, so a pin and a stop can never disagree about
  // which stop they are. Without the offset the map restarted at 1 on any day
  // whose base had already taken first place.
  const dailyBases = resolveDailyBases({ day, routeSegments: routeState.data?.segments });
  const stopNumbers = dayStopNumbers({
    bases: dailyBases,
    itemCount: day.items.length,
  });
  const allMapPoints = buildItineraryMapPoints({
    itinerary,
    orderOffset: stopNumbers.itemOffset,
    resolveItemName: itemName,
    resolvePlaceLocation: placeLocation,
    resolvePlaceName: placeName,
    selectedDay: day,
  });
  const scheduledPoints = allMapPoints.filter((point) => point.kind === 'scheduled');
  const baseTripPlaceId =
    dailyBases.arrivalTripPlaceId ??
    dailyBases.departureTripPlaceId ??
    (day.defaultTimeZoneSource === 'accommodation' ? day.defaultTimeZoneSourceTripPlaceId : null);
  const baseTripPlace = baseTripPlaceId
    ? (itinerary.tripPlaces.find((tripPlace) => tripPlace.id === baseTripPlaceId) ?? null)
    : null;
  const baseLocation = baseTripPlace ? placeLocation(baseTripPlace) : null;
  const fallbackBasePoint: ItineraryMapPoint | null =
    baseTripPlace && baseLocation && !scheduledPoints.some((point) => point.id === baseTripPlace.id)
      ? {
          id: `base:${baseTripPlace.id}`,
          itemId: null,
          kind: 'base',
          latitude: baseLocation.latitude,
          longitude: baseLocation.longitude,
          name: placeName(baseTripPlace),
          order: null,
          tripPlaceId: baseTripPlace.id,
        }
      : null;
  const resolvedBasePoints = dailyBasePoints({
    bases: dailyBases,
    numbers: stopNumbers,
    resolvePlaceLocation: placeLocation,
    resolvePlaceName: placeName,
    scheduledTripPlaceIds: new Set(scheduledPoints.map((point) => point.tripPlaceId)),
    tripPlaces: itinerary.tripPlaces,
  });
  const basePoints = resolvedBasePoints.length
    ? resolvedBasePoints
    : fallbackBasePoint
      ? [fallbackBasePoint]
      : [];
  const basePoint = basePoints[0] ?? null;
  const basePlaceIds = new Set(basePoints.map((point) => point.tripPlaceId));
  const nearbyAnchors: ItineraryMapLocation[] = [
    ...scheduledPoints,
    ...basePoints,
    ...(deviceLocation ? [deviceLocation] : []),
  ];
  const nearbyPoints = allMapPoints
    .filter(
      (point) =>
        point.kind === 'considered' &&
        !basePlaceIds.has(point.tripPlaceId) &&
        nearbyAnchors.length > 0,
    )
    .map((point) => ({
      distance: Math.min(...nearbyAnchors.map((anchor) => haversineMeters(point, anchor))),
      point,
    }))
    .filter(({ distance }) => distance <= NEARBY_RADIUS_METERS)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, NEARBY_PLACE_LIMIT)
    .map(({ point }) => point);
  const mapPoints = [...scheduledPoints, ...basePoints, ...nearbyPoints];
  const routeLines = buildMapRouteLegs(
    day,
    routeState.data?.segments ?? [],
    mapPoints,
    routeState.data?.source === 'cache' || routeState.data?.stale === true,
  );
  const routeSummaryData: ItineraryDayRoutes = routeState.data ?? {
    generatedAt: context.contextAt,
    segments: [],
    summary: {
      distanceMeters: null,
      durationSeconds: null,
      knownSegmentCount: 0,
      localSegmentCount: 0,
      scheduledPlaceCount: scheduledPoints.length,
      status: 'unavailable',
      totalSegmentCount: 0,
    },
  };
  // Which of these sentences applies is the whole distinction between a planned
  // map and a live one, so exactly one of them is always on screen.
  const locationNotice = isPreview
    ? { icon: Eye, text: t('previewLocation'), tone: 'info' as const }
    : !online
      ? { icon: CircleAlert, text: t('offlineMap'), tone: 'warning' as const }
      : locationStatus === 'ready'
        ? { icon: LocateFixed, text: t('locationShown'), tone: 'info' as const }
        : locationStatus === 'denied' || locationStatus === 'unavailable'
          ? {
              icon: CircleAlert,
              text: locationStatus === 'denied' ? t('locationDenied') : t('locationUnavailable'),
              tone: 'muted' as const,
            }
          : null;
  const NoticeIcon = locationNotice?.icon;
  const routeSummary = (
    <ItineraryRouteSummary
      data={routeState.status === 'loading' ? null : routeSummaryData}
      distanceUnit={preferences.distanceUnit}
      locale={locale}
      status={routeState.status}
    />
  );

  // The next move, read from the same context Now reads, so the map's peek and
  // Now can never disagree about where the traveller is going.
  const nextItem = day.items.find((item) => item.id === context.nextItemId) ?? null;
  const nextIndex = nextItem ? day.items.indexOf(nextItem) : -1;
  const nextRoute = context.leaveBy?.destinationItemId === nextItem?.id ? context.leaveBy : null;
  const clockAt = isPreview ? context.contextAt : now.toISOString();
  const leaveIn = nextRoute
    ? Math.round((Date.parse(nextRoute.at) - Date.parse(clockAt)) / 60_000)
    : null;
  const countdown =
    leaveIn === null
      ? null
      : leaveIn <= 0
        ? nowT('leaveNow')
        : leaveIn < 60
          ? nowT('leaveInMinutes', { minutes: leaveIn })
          : nowT('leaveInHours', { hours: Math.floor(leaveIn / 60), minutes: leaveIn % 60 });
  const legZone = isPreview ? day.defaultTimeZone : (deviceTimeZone() ?? day.defaultTimeZone);
  const nextLocation = nextItem?.tripPlace ? placeLocation(nextItem.tripPlace) : null;
  const nextDirections =
    online && nextLocation
      ? `https://www.google.com/maps/dir/?api=1&destination=${nextLocation.latitude},${nextLocation.longitude}`
      : null;
  const canLocate = !isPreview && online && locationStatus !== 'unsupported';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 lg:block lg:space-y-6">
      <header className="min-w-0 shrink-0">
        <h2 className="sr-only">{day.name ?? t('title')}</h2>
        <p className="text-[length:var(--text-metadata)] leading-5 font-medium text-muted-foreground tabular-nums">
          {day.name ? itineraryT('dayOption', { date, number: context.day?.number ?? 1 }) : date}
        </p>
        {/* The explanation moves to `lg:`, where there is room for it. On a
            phone it was three lines of prose standing between a traveller and
            the map they opened. */}
        <p className="mt-0.5 hidden max-w-[var(--layout-reading)] text-[length:var(--text-metadata)] leading-5 text-pretty text-text-subtle lg:block">
          {t(isPreview ? 'previewDescription' : 'description')}
        </p>
      </header>

      {/* The map is the view. On a phone it fills what is left of the screen
          between the two bars, with the day riding over it on a sheet; at `lg:`
          it goes back to being a card beside a rail, which that width has room
          for. One map either way - a second instance is a second charge. */}
      <div className="flex -mx-[var(--gutter-inline-start)] min-h-[22rem] flex-1 overflow-hidden lg:static lg:mx-0 lg:grid lg:min-h-0 lg:flex-none lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-6 lg:overflow-visible">
        <section
          aria-label={t('mapSectionLabel')}
          className="absolute inset-0 lg:static lg:min-w-0 lg:overflow-hidden lg:rounded-[var(--radius-xl)] lg:border lg:border-border lg:bg-card lg:shadow-[var(--shadow-surface)]"
        >
          {online ? (
            <ItineraryPlanningMap
              ariaLabel={t('interactiveMapLabel')}
              className="h-full lg:h-auto"
              currentLocation={deviceLocation}
              controlsContainer={mapControlsContainer}
              onControlsExpandedChange={setMapControlsExpanded}
              selectedRouteId={selectedRouteId}
              onSelectRoute={selectRoute}
              onClearSelection={clearMapSelection}
              onSelectPoint={(point) => setSelectedPointId(point.id)}
              onViewItem={(itemId) =>
                router.push(withPreviewHref(`/trips/${tripId}/mode/today#trip-mode-item-${itemId}`))
              }
              onViewPlaceDetails={(point) => {
                const tripPlace = itinerary.tripPlaces.find(
                  (candidate) => candidate.id === point.tripPlaceId,
                );
                if (tripPlace)
                  openPlaceDetails(
                    tripPlace,
                    point.kind === 'considered' ? placeVisitDate(placeUse[tripPlace.id]) : day.date,
                  );
              }}
              points={mapPoints}
              routeLines={routeLines}
              selectedPointId={selectedPointId}
              suspendUpdates={!active}
            />
          ) : (
            <div className="flex h-full min-h-72 items-center justify-center bg-surface-sunken px-6 text-center">
              <div className="max-w-sm">
                <MapPin aria-hidden="true" className="mx-auto size-6 text-brand" />
                <p className="mt-3 font-medium text-foreground">{t('offlineMapTitle')}</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {t('offlineMapDescription')}
                </p>
              </div>
            </div>
          )}

          {/* Carried over the map on a phone rather than stacked above it: how
              far and how long, which marker is which, and the device's own
              position. At `lg:` the rail beside the map has room for all of it. */}
          <div className="pointer-events-none absolute inset-x-3 top-[calc(var(--safe-top)+var(--header-offset)+5rem+var(--trip-mode-preview-offset,0px))] z-[1] flex flex-col items-start gap-2 md:top-[calc(var(--safe-top)+var(--header-offset)+4rem+var(--trip-mode-preview-offset,0px))] lg:hidden">
            <div
              className="pointer-events-auto w-full overflow-hidden rounded-[var(--radius-xl)] bg-background/95 shadow-[var(--shadow-overlay)] backdrop-blur supports-[backdrop-filter]:bg-background/88"
              data-translucent-surface
            >
              {routeSummary}
            </div>
            {/* A solid dot is where the device is; a filled circle is where the
                plan puts a stop. The two are never drawn alike. */}
            <ul
              aria-label={t('legendLabel')}
              className="pointer-events-auto inline-flex flex-wrap items-center gap-x-3 gap-y-1 rounded-full bg-background/95 px-3 py-1.5 text-xs text-foreground shadow-[var(--shadow-control)]"
            >
              {deviceLocation ? (
                <li className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="size-2.5 rounded-full bg-status-info ring-2 ring-status-info/25"
                  />
                  {t('legend.device')}
                </li>
              ) : null}
              <li className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="size-2.5 rounded-full bg-primary" />
                {t('legend.planned')}
              </li>
            </ul>
          </div>
          {canLocate || basePoint ? (
            <div className="absolute end-3 top-[42%] z-[1] flex flex-col gap-2 lg:hidden">
              {canLocate ? (
                <Button
                  aria-busy={locationStatus === 'loading'}
                  aria-describedby="trip-mode-map-location-status"
                  aria-label={locationStatus === 'ready' ? t('updateLocation') : t('useLocation')}
                  className="size-12 rounded-full border-border-subtle bg-background shadow-[var(--shadow-overlay)]"
                  disabled={locationStatus === 'loading'}
                  onClick={requestLocation}
                  size="icon"
                  variant="outline"
                >
                  <LocateFixed
                    aria-hidden="true"
                    className={cn(
                      'size-5',
                      locationStatus === 'ready' && 'text-status-info',
                      locationStatus === 'loading' && 'animate-spin motion-reduce:animate-none',
                    )}
                  />
                </Button>
              ) : null}
              {basePoint ? (
                <Button
                  aria-label={t('showOnMap', { name: basePoint.name })}
                  className="size-12 rounded-full border-border-subtle bg-background shadow-[var(--shadow-overlay)]"
                  onClick={() => setSelectedPointId(basePoint.id)}
                  size="icon"
                  variant="outline"
                >
                  <BedDouble aria-hidden="true" className="size-5" />
                </Button>
              ) : null}
            </div>
          ) : null}
        </section>

        <TripModeMapSheet
          peek={
            <>
              <div ref={setMapControlsContainer} />
              {/* On a phone the route summary rides on the map, so the peek can
                  hold the next move - the thing a map in Trip Mode is opened
                  to act on - and every stop of the day a tap away. */}
              {!mapControlsExpanded && nextItem ? (
                <div className="flex items-center gap-3 py-1.5 lg:hidden">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-strong text-sm font-semibold text-primary-foreground tabular-nums">
                    <span className="sr-only">
                      {t('stopNumber', { number: stopNumbers.itemOffset + nextIndex + 1 })}
                    </span>
                    <span aria-hidden="true">{stopNumbers.itemOffset + nextIndex + 1}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-semibold text-foreground">
                      {itemName(nextItem)}
                    </p>
                    <p className="truncate text-[length:var(--text-metadata)] text-muted-foreground tabular-nums">
                      {countdown && nextRoute ? (
                        <>
                          <span className="font-semibold text-accent-strong">{countdown}</span>
                          <span aria-hidden="true"> · </span>
                          {nowT('travelEstimate', {
                            duration: formatTravelDuration(nextRoute.routeDurationSeconds, locale),
                            mode: nowT(`travelMode.${nextRoute.mode}`),
                          })}
                          <span aria-hidden="true"> · </span>
                          {nowT('leaveByAt', {
                            time: new Intl.DateTimeFormat(locale, {
                              hour: 'numeric',
                              hour12: preferences.timeFormat === '12h',
                              minute: '2-digit',
                              timeZone: legZone,
                            }).format(new Date(nextRoute.at)),
                          })}
                        </>
                      ) : (
                        formatSchedule(nextItem)
                      )}
                    </p>
                  </div>
                  {nextDirections ? (
                    <Button
                      aria-label={nowT('directionsTo', { name: itemName(nextItem) })}
                      className="size-12 shrink-0 rounded-full"
                      nativeButton={false}
                      render={<a href={nextDirections} rel="noreferrer" target="_blank" />}
                      size="icon"
                    >
                      <Icons.Directions aria-hidden="true" className="size-5" />
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {!mapControlsExpanded && day.items.length ? (
                <ul
                  aria-label={t('todayItinerary')}
                  className="interaction-scrollbar -mx-[var(--gutter-inline-start)] flex gap-2 overflow-x-auto px-[var(--gutter-inline-start)] pt-1 pb-2 lg:hidden"
                >
                  {day.items.map((item, index) => {
                    const point = scheduledPoints.find((candidate) => candidate.itemId === item.id);
                    const isNext = item.id === nextItem?.id;
                    const settled = item.travelStatus !== 'upcoming';
                    return (
                      <li className="shrink-0" key={item.id}>
                        <Button
                          aria-label={t('showOnMap', { name: itemName(item) })}
                          aria-pressed={selectedPointId === point?.id}
                          className={cn(
                            'h-10 rounded-full px-3 font-normal shadow-none',
                            isNext ? 'border-accent-strong' : 'border-border-subtle',
                            settled && 'text-muted-foreground',
                          )}
                          disabled={!point}
                          onClick={() => point && setSelectedPointId(point.id)}
                          size="sm"
                          variant="outline"
                        >
                          <span
                            aria-hidden="true"
                            className={cn(
                              'font-semibold tabular-nums',
                              isNext && 'text-accent-strong',
                            )}
                          >
                            {stopNumbers.itemOffset + index + 1}
                          </span>
                          <span aria-hidden="true" className="max-w-40 truncate">
                            {itemName(item)}
                          </span>
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {/* How far and how long, beside the map where the rail has room. */}
              <div className="hidden lg:block lg:overflow-hidden lg:rounded-[var(--radius-xl)] lg:border lg:border-border-subtle lg:bg-card lg:shadow-[var(--shadow-surface)]">
                {routeSummary}
              </div>
            </>
          }
        >
          <div className="-mx-[var(--gutter-inline-start)] border-y border-border-subtle lg:mx-0 lg:rounded-[var(--radius-xl)] lg:border lg:bg-card lg:shadow-[var(--shadow-surface)]">
            {locationNotice && NoticeIcon ? (
              <p
                className={cn(
                  'flex items-start gap-2 px-4 py-2.5 text-xs leading-5 sm:px-6',
                  locationNotice.tone === 'info'
                    ? 'text-status-info'
                    : locationNotice.tone === 'warning'
                      ? 'text-status-warning'
                      : 'text-muted-foreground',
                )}
              >
                <NoticeIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                {locationNotice.text}
              </p>
            ) : null}
            {canLocate ? (
              <div className="hidden border-t border-border-subtle px-4 py-2.5 sm:px-6 lg:block">
                {/* The label holds still and the icon carries the wait. A
                    control that renames itself mid-tap makes the traveller
                    re-read it to find out whether anything happened; a spinning
                    icon says the same thing without moving the words. The
                    sentence the label used to swap to is still announced, out
                    of sight, below. */}
                <Button
                  aria-busy={locationStatus === 'loading'}
                  aria-describedby="trip-mode-map-location-status"
                  className="w-full sm:w-auto"
                  disabled={locationStatus === 'loading'}
                  onClick={requestLocation}
                  size="sm"
                  variant={locationStatus === 'ready' ? 'secondary' : 'outline'}
                >
                  <LocateFixed
                    aria-hidden="true"
                    className={cn(
                      locationStatus === 'loading' && 'animate-spin motion-reduce:animate-none',
                    )}
                    data-icon="inline-start"
                  />
                  {locationStatus === 'ready' ? t('updateLocation') : t('useLocation')}
                </Button>
              </div>
            ) : null}
            {/* Outside the location control, which only the rail shows: the map
                carries its own button on a phone, and both are described by this. */}
            <p
              aria-live="polite"
              className="sr-only"
              id="trip-mode-map-location-status"
              role="status"
            >
              {locationStatus === 'loading' ? t('locating') : ''}
            </p>
            <ul
              aria-label={t('legendLabel')}
              className="flex flex-wrap gap-x-4 gap-y-2 border-t border-border-subtle px-4 py-3 text-xs text-muted-foreground sm:px-6"
            >
              <li className="inline-flex items-center gap-2">
                <span aria-hidden="true" className="size-3 rounded-full bg-primary" />
                {t('legend.planned')}
              </li>
              {baseTripPlace ? (
                <li className="inline-flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-3 rounded-[var(--radius-xs)] border-2 border-primary"
                  />
                  {t('legend.base')}
                </li>
              ) : null}
              {nearbyPoints.length ? (
                <li className="inline-flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-3 rounded-full border-2 border-primary"
                  />
                  {t('legend.tripPlaces')}
                </li>
              ) : null}
              {deviceLocation ? (
                <li className="inline-flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-3 rounded-full bg-status-info ring-2 ring-status-info/25"
                  />
                  {t('legend.device')}
                </li>
              ) : null}
            </ul>
          </div>

          {baseTripPlace ? (
            <section className="border-b border-border pb-5">
              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-secondary text-secondary-foreground">
                  <BedDouble aria-hidden="true" className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                    {t(day.dailyBaseTripPlaceId ? 'dayBase' : 'accommodationBase')}
                  </p>
                  <button
                    aria-label={itineraryT('viewDetailsFor', { name: placeName(baseTripPlace) })}
                    className="mt-1 block rounded-[var(--radius-sm)] text-left text-sm font-semibold outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
                    onClick={() => openPlaceDetails(baseTripPlace, day.date)}
                    type="button"
                  >
                    {placeName(baseTripPlace)}
                  </button>
                </div>
              </div>
            </section>
          ) : null}

          <section aria-labelledby="trip-mode-map-itinerary-heading">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-semibold" id="trip-mode-map-itinerary-heading">
                {t('todayItinerary')}
              </h3>
              <Button
                nativeButton={false}
                render={<Link href={withPreviewHref(`/trips/${tripId}/mode/today`)} />}
                size="sm"
                variant="ghost"
              >
                {t('openToday')}
              </Button>
            </div>
            {day.items.length ? (
              <ol className="mt-3 divide-y divide-border border-y border-border">
                {day.items.map((item, index) => {
                  const location = item.tripPlace ? placeLocation(item.tripPlace) : null;
                  const point = scheduledPoints.find((candidate) => candidate.itemId === item.id);
                  return (
                    <li
                      className={cn(
                        'py-3',
                        selectedPointId === point?.id && 'bg-secondary/45 px-2',
                      )}
                      key={item.id}
                    >
                      <div className="flex items-start gap-3">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground tabular-nums">
                          <span className="sr-only">
                            {t('stopNumber', { number: stopNumbers.itemOffset + index + 1 })}
                          </span>
                          <span aria-hidden="true">{stopNumbers.itemOffset + index + 1}</span>
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-brand tabular-nums">
                            {formatSchedule(item)}
                          </p>
                          <p className="mt-0.5 text-sm font-medium text-foreground">
                            {itemName(item)}
                          </p>
                          {itemLocation(item) ? (
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                              {itemLocation(item)}
                            </p>
                          ) : null}
                          {item.notes || item.tripPlace?.note ? (
                            <ExpandableDescription
                              className="mt-1 text-xs leading-5 text-text-subtle"
                              lines={2}
                              name={itemName(item)}
                              text={item.notes || item.tripPlace?.note || ''}
                            />
                          ) : null}
                          <div className="mt-2 flex flex-wrap gap-1">
                            {point ? (
                              <Button
                                aria-label={t('showOnMap', { name: itemName(item) })}
                                onClick={() => setSelectedPointId(point.id)}
                                size="xs"
                                variant="ghost"
                              >
                                <MapPin aria-hidden="true" data-icon="inline-start" />
                                {t('show')}
                              </Button>
                            ) : null}
                            {online && location ? (
                              <Button
                                nativeButton={false}
                                render={
                                  <a
                                    href={`https://www.google.com/maps/dir/?api=1&destination=${location.latitude},${location.longitude}`}
                                    rel="noreferrer"
                                    target="_blank"
                                  />
                                }
                                size="xs"
                                variant="ghost"
                              >
                                <Icons.Directions aria-hidden="true" data-icon="inline-start" />
                                {t('directions')}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <div className="mt-3 border-y border-border py-5 text-sm text-muted-foreground">
                <Route aria-hidden="true" className="mb-2 size-5 text-brand" />
                {t('emptyItinerary')}
              </div>
            )}
          </section>

          <p className="flex items-start gap-2 text-xs leading-5 text-text-subtle">
            <Icons.Directions aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            {t('directionsHandoff')}
          </p>
        </TripModeMapSheet>
      </div>
    </div>
  );
}
