'use client';

import {
  BedDouble,
  CalendarDays,
  CircleAlert,
  Eye,
  ExternalLink,
  LocateFixed,
  MapPin,
  Navigation,
  Route,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { ItineraryPlanningMap } from '@/components/itinerary-planning-map';
import { ItineraryRouteSummary } from '@/components/itinerary-route-details';
import { PageState } from '@/components/page-state';
import { usePreferences } from '@/components/preferences-provider';
import { useTripModePreview } from '@/components/trip-mode-shell';
import { useOfflineDataRefreshKey, useOnlineStatus } from '@/components/trip-sync-status';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  fetchItinerary,
  fetchItineraryDayRoutes,
  fetchTripModeContext,
  type Itinerary,
  type ItineraryDayRoutes,
  type ItineraryItem,
  type ItineraryTripPlace,
  type TripModeContext,
} from '@/lib/itinerary/api';
import { itineraryDayRouteRevision } from '@/lib/itinerary/routes';
import {
  buildItineraryMapPoints,
  type ItineraryMapLocation,
  type ItineraryMapPoint,
} from '@/lib/maps/itinerary-map';
import { googleMapsPlaceHref } from '@/lib/saved/api';
import { cn } from '@/lib/utils';

type LoadState =
  | { data: null; status: 'error' }
  | { data: null; status: 'loading' }
  | { data: { context: TripModeContext; itinerary: Itinerary }; status: 'ready' };

type RouteState =
  | { data: null; status: 'error' | 'idle' | 'loading' }
  | { data: ItineraryDayRoutes; status: 'idle' };

type DeviceLocation = ItineraryMapLocation & { accuracyMeters: number | null };
type LocationStatus = 'denied' | 'idle' | 'loading' | 'ready' | 'unavailable' | 'unsupported';

const NEARBY_PLACE_LIMIT = 8;
const NEARBY_RADIUS_METERS = 25_000;

function distanceMeters(a: ItineraryMapLocation, b: ItineraryMapLocation) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = toRadians(b.latitude - a.latitude);
  const longitudeDelta = toRadians(b.longitude - a.longitude);
  const latitudeA = toRadians(a.latitude);
  const latitudeB = toRadians(b.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

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

export function TripModeMapView({ tripId }: Readonly<{ tripId: string }>) {
  const t = useTranslations('tripMode.views.map');
  const locale = useLocale();
  const router = useRouter();
  const { preferences } = usePreferences();
  const online = useOnlineStatus();
  const offlineDataRefreshKey = useOfflineDataRefreshKey();
  const { contextOptions, isPreview, withPreviewHref } = useTripModePreview();
  const [state, setState] = useState<LoadState>({ data: null, status: 'loading' });
  const [routeState, setRouteState] = useState<RouteState>({ data: null, status: 'idle' });
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('idle');
  const [deviceLocation, setDeviceLocation] = useState<DeviceLocation | null>(null);

  useEffect(() => {
    if (isPreview) {
      setDeviceLocation(null);
      setLocationStatus('idle');
      return;
    }
    if (!('geolocation' in navigator)) setLocationStatus('unsupported');
  }, [isPreview]);

  useEffect(() => {
    let active = true;
    setState({ data: null, status: 'loading' });
    void Promise.all([fetchTripModeContext(tripId, contextOptions()), fetchItinerary(tripId)])
      .then(([context, itinerary]) => {
        if (active) setState({ data: { context, itinerary }, status: 'ready' });
      })
      .catch(() => {
        if (active) setState({ data: null, status: 'error' });
      });
    return () => {
      active = false;
    };
  }, [contextOptions, offlineDataRefreshKey, reloadKey, tripId]);

  const day = useMemo(() => {
    if (state.status !== 'ready') return null;
    return (
      state.data.itinerary.days.find(
        (candidate) => candidate.date === state.data.context.selectedDate,
      ) ?? null
    );
  }, [state]);

  // Keyed on the day's ordering, not just its identity, so a reorder made in the
  // planner invalidates the legs this view is showing.
  const routeRevision = itineraryDayRouteRevision(day);

  useEffect(() => {
    if (!day || !online) {
      setRouteState({ data: null, status: 'idle' });
      return;
    }
    const controller = new AbortController();
    setRouteState({ data: null, status: 'loading' });
    void fetchItineraryDayRoutes(tripId, day.id, {
      includePolyline: true,
      languageCode: locale,
      revision: routeRevision,
      signal: controller.signal,
    })
      .then((data) => setRouteState({ data, status: 'idle' }))
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setRouteState({ data: null, status: 'error' });
        }
      });
    return () => controller.abort();
  }, [day, locale, online, routeRevision, tripId]);

  if (state.status === 'loading') return <MapSkeleton label={t('loading')} />;

  if (state.status === 'error') {
    return (
      <PageState
        actions={
          <Button onClick={() => setReloadKey((value) => value + 1)}>{t('tryAgain')}</Button>
        }
        description={t('loadErrorDescription')}
        headingLevel={2}
        icon={<CircleAlert aria-hidden="true" />}
        kind="error"
        title={t('loadError')}
      />
    );
  }

  const { context, itinerary } = state.data;
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

  const allMapPoints = buildItineraryMapPoints({
    itinerary,
    resolveItemName: itemName,
    resolvePlaceLocation: placeLocation,
    resolvePlaceName: placeName,
    selectedDay: day,
  });
  const scheduledPoints = allMapPoints.filter((point) => point.kind === 'scheduled');
  const baseTripPlaceId =
    day.dailyBaseTripPlaceId ??
    (day.defaultTimeZoneSource === 'accommodation' ? day.defaultTimeZoneSourceTripPlaceId : null);
  const baseTripPlace = baseTripPlaceId
    ? (itinerary.tripPlaces.find((tripPlace) => tripPlace.id === baseTripPlaceId) ?? null)
    : null;
  const baseLocation = baseTripPlace ? placeLocation(baseTripPlace) : null;
  const basePoint: ItineraryMapPoint | null =
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
  const nearbyAnchors: ItineraryMapLocation[] = [
    ...scheduledPoints,
    ...(baseLocation ? [baseLocation] : []),
    ...(deviceLocation ? [deviceLocation] : []),
  ];
  const nearbyPoints = allMapPoints
    .filter((point) => point.kind === 'considered' && nearbyAnchors.length > 0)
    .map((point) => ({
      distance: Math.min(...nearbyAnchors.map((anchor) => distanceMeters(point, anchor))),
      point,
    }))
    .filter(({ distance }) => distance <= NEARBY_RADIUS_METERS)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, NEARBY_PLACE_LIMIT)
    .map(({ point }) => point);
  const mapPoints = [...scheduledPoints, ...(basePoint ? [basePoint] : []), ...nearbyPoints];
  const routePolylines =
    routeState.data?.segments
      .map((segment) => segment.encodedPolyline)
      .filter((polyline): polyline is string => Boolean(polyline)) ?? [];
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
  function requestLocation() {
    if (!navigator.geolocation) {
      setLocationStatus('unsupported');
      return;
    }
    setLocationStatus('loading');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setDeviceLocation({
          accuracyMeters: Number.isFinite(position.coords.accuracy)
            ? position.coords.accuracy
            : null,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setLocationStatus('ready');
      },
      (error) => {
        setDeviceLocation(null);
        setLocationStatus(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable');
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 },
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-3xl font-semibold tracking-[-0.025em] text-foreground sm:text-4xl">
            {t('title')}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{date}</p>
          <p className="max-w-2xl text-xs leading-5 text-text-subtle">
            {t(isPreview ? 'previewDescription' : 'description')}
          </p>
        </div>
        {!isPreview && online && locationStatus !== 'unsupported' ? (
          <Button
            disabled={locationStatus === 'loading'}
            onClick={requestLocation}
            variant={locationStatus === 'ready' ? 'secondary' : 'outline'}
          >
            <LocateFixed aria-hidden="true" data-icon="inline-start" />
            {locationStatus === 'loading'
              ? t('locating')
              : locationStatus === 'ready'
                ? t('updateLocation')
                : t('useLocation')}
          </Button>
        ) : null}
      </header>

      {isPreview ? (
        <Alert variant="info">
          <Eye aria-hidden="true" />
          <AlertDescription>{t('previewLocation')}</AlertDescription>
        </Alert>
      ) : locationStatus === 'ready' ? (
        <Alert variant="info">
          <LocateFixed aria-hidden="true" />
          <AlertDescription>{t('locationShown')}</AlertDescription>
        </Alert>
      ) : locationStatus === 'denied' || locationStatus === 'unavailable' ? (
        <Alert>
          <CircleAlert aria-hidden="true" />
          <AlertDescription>
            {locationStatus === 'denied' ? t('locationDenied') : t('locationUnavailable')}
          </AlertDescription>
        </Alert>
      ) : null}

      {!online ? (
        <Alert variant="warning">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{t('offlineMap')}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <section
          aria-label={t('mapSectionLabel')}
          className="min-w-0 overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card shadow-[var(--shadow-surface)]"
        >
          <ItineraryRouteSummary
            data={routeState.status === 'loading' ? null : routeSummaryData}
            distanceUnit={preferences.distanceUnit}
            locale={locale}
            status={routeState.status}
          />
          <ul
            aria-label={t('legendLabel')}
            className="flex flex-wrap gap-x-4 gap-y-2 border-b border-border px-4 py-3 text-xs text-muted-foreground sm:px-6"
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
                <span aria-hidden="true" className="size-3 rounded-full border-2 border-primary" />
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
          {online ? (
            <ItineraryPlanningMap
              ariaLabel={t('interactiveMapLabel')}
              currentLocation={deviceLocation}
              onSelectPoint={(point) => setSelectedPointId(point.id)}
              onViewItem={(itemId) =>
                router.push(withPreviewHref(`/trips/${tripId}/mode/today#trip-mode-item-${itemId}`))
              }
              points={mapPoints}
              routePolylines={routePolylines}
              selectedPointId={selectedPointId}
            />
          ) : (
            <div className="flex min-h-72 items-center justify-center bg-surface-sunken px-6 text-center">
              <div className="max-w-sm">
                <MapPin aria-hidden="true" className="mx-auto size-6 text-brand" />
                <p className="mt-3 font-medium text-foreground">{t('offlineMapTitle')}</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {t('offlineMapDescription')}
                </p>
              </div>
            </div>
          )}
        </section>

        <aside aria-label={t('dayContextLabel')} className="space-y-6">
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
                  {googleMapsPlaceHref(baseTripPlace.place) ? (
                    <a
                      className="mt-1 block rounded-[var(--radius-sm)] text-sm font-semibold outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/40"
                      href={googleMapsPlaceHref(baseTripPlace.place)!}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {placeName(baseTripPlace)}
                    </a>
                  ) : (
                    <p className="mt-1 text-sm font-semibold">{placeName(baseTripPlace)}</p>
                  )}
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
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                          {index + 1}
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
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-text-subtle">
                              {item.notes ?? item.tripPlace?.note}
                            </p>
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
                                <ExternalLink aria-hidden="true" data-icon="inline-start" />
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
            <Navigation aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            {t('directionsHandoff')}
          </p>
        </aside>
      </div>
    </div>
  );
}
