'use client';

import { CalendarPlus, Eye, MapPinned, Navigation } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useEffect, useMemo, useRef, useState } from 'react';

import { PageState } from '@/components/page-state';
import { Button } from '@/components/ui/button';
import {
  getGoogleMapsMapId,
  hasGoogleMapsConfiguration,
  loadGoogleMaps,
} from '@/lib/maps/google-maps';
import {
  decodeGooglePolyline,
  type ItineraryMapPoint,
  viewportPoints,
} from '@/lib/maps/itinerary-map';
import { cn } from '@/lib/utils';

type ItineraryPlanningMapProps = {
  ariaLabel?: string;
  currentLocation?: {
    accuracyMeters: number | null;
    latitude: number;
    longitude: number;
  } | null;
  /**
   * Puts a Place that is not yet on the selected day onto it. Omitted by surfaces
   * with no day of their own to add to, which hides the action entirely.
   */
  onAddToDay?: (point: ItineraryMapPoint) => Promise<boolean>;
  onOpenPlace: (tripPlaceId: string) => void;
  onSelectPoint: (point: ItineraryMapPoint) => void;
  onViewItem: (itemId: string) => void;
  points: ItineraryMapPoint[];
  routePolylines: string[];
  selectedPointId: string | null;
};

type LoadedGoogleMaps = Awaited<ReturnType<typeof loadGoogleMaps>>;
type GoogleMapInstance = InstanceType<LoadedGoogleMaps['maps']['Map']>;
type GoogleAdvancedMarkerInstance = InstanceType<
  LoadedGoogleMaps['marker']['AdvancedMarkerElement']
>;
type GooglePolylineInstance = InstanceType<LoadedGoogleMaps['maps']['Polyline']>;

function markerContent(point: ItineraryMapPoint) {
  const element = document.createElement('span');
  element.className = cn(
    'grid place-items-center border-2 font-semibold shadow-[var(--shadow-control)] transition-[transform,box-shadow] duration-[var(--motion-fast)]',
    point.kind === 'scheduled'
      ? 'size-9 rounded-full border-background bg-primary text-xs text-primary-foreground'
      : point.kind === 'base'
        ? 'size-8 rounded-[var(--radius-sm)] border-primary bg-card text-[0.6875rem] text-primary'
        : 'size-7 rounded-full border-primary bg-card text-primary',
    'data-[selected=true]:scale-110 data-[selected=true]:ring-4 data-[selected=true]:ring-ring/35',
  );
  element.dataset.selected = 'false';
  element.textContent = point.order ? String(point.order) : '';
  return element;
}

/**
 * A day can start from one place and end at another, so a base marker says which
 * end it is. Surfaces with a single unroled base keep the plain wording.
 */
function baseMarkerLabelKey(role: ItineraryMapPoint['baseRole']) {
  if (role === 'arrival') return 'baseArrivalMarkerLabel' as const;
  if (role === 'departure') return 'baseDepartureMarkerLabel' as const;
  return 'baseMarkerLabel' as const;
}

function baseSelectionKey(role: ItineraryMapPoint['baseRole']) {
  if (role === 'arrival') return 'baseArrivalSelection' as const;
  if (role === 'departure') return 'baseDepartureSelection' as const;
  if (role === 'both') return 'baseRoundTripSelection' as const;
  return 'baseSelection' as const;
}

function currentLocationContent() {
  const element = document.createElement('span');
  element.className =
    'grid size-7 place-items-center rounded-full border-2 border-background bg-status-info shadow-[var(--shadow-control)] ring-4 ring-status-info/25';
  const center = document.createElement('span');
  center.className = 'size-2 rounded-full bg-white';
  element.append(center);
  return element;
}

export function ItineraryPlanningMap({
  ariaLabel,
  currentLocation = null,
  onAddToDay,
  onOpenPlace,
  onSelectPoint,
  onViewItem,
  points,
  routePolylines,
  selectedPointId,
}: Readonly<ItineraryPlanningMapProps>) {
  const t = useTranslations('itinerary.map');
  const locale = useLocale();
  const { resolvedTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GoogleMapInstance | null>(null);
  const markerRefs = useRef(new Map<string, GoogleAdvancedMarkerInstance>());
  const currentLocationMarkerRef = useRef<GoogleAdvancedMarkerInstance | null>(null);
  const polylineRefs = useRef<GooglePolylineInstance[]>([]);
  const onSelectPointRef = useRef(onSelectPoint);
  const [status, setStatus] = useState<'error' | 'loading' | 'ready'>(
    hasGoogleMapsConfiguration() ? 'loading' : 'error',
  );
  const [addingPointId, setAddingPointId] = useState<string | null>(null);
  const [addFeedback, setAddFeedback] = useState<string | null>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef(false);
  const hasPoints = points.length > 0;
  const selectedPoint = useMemo(
    () => points.find((point) => point.id === selectedPointId) ?? null,
    [points, selectedPointId],
  );

  useEffect(() => {
    onSelectPointRef.current = onSelectPoint;
  }, [onSelectPoint]);

  // A result belongs to the Place it was about, not to whatever is tapped next.
  useEffect(() => {
    setAddFeedback(null);
  }, [selectedPointId]);

  // Adding succeeds by making the button disappear — the point becomes `scheduled`
  // and the card offers "View item" in its place. Without this, a keyboard user is
  // dropped to the top of the document by their own successful action.
  useEffect(() => {
    if (!restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    actionsRef.current?.querySelector('button')?.focus();
  }, [selectedPoint?.kind]);

  async function addToDay(point: ItineraryMapPoint) {
    if (!onAddToDay) return;
    setAddingPointId(point.id);
    setAddFeedback(null);
    const added = await onAddToDay(point);
    setAddFeedback(added ? t('addedToDay', { name: point.name }) : t('addToDayError'));
    setAddingPointId(null);
    restoreFocusRef.current = added;
  }

  useEffect(() => {
    const initialPoint = points[0] ?? currentLocation;
    if (!containerRef.current || !initialPoint || !resolvedTheme || !hasGoogleMapsConfiguration())
      return;
    let active = true;
    setStatus('loading');
    void loadGoogleMaps(locale)
      .then(({ maps }) => {
        if (!active || !containerRef.current) return;
        mapRef.current = new maps.Map(containerRef.current, {
          center: { lat: initialPoint.latitude, lng: initialPoint.longitude },
          clickableIcons: false,
          colorScheme: resolvedTheme === 'dark' ? 'DARK' : 'LIGHT',
          fullscreenControl: false,
          gestureHandling: 'cooperative',
          mapId: getGoogleMapsMapId()!,
          mapTypeControl: false,
          streetViewControl: false,
          zoom: 13,
        });
        setStatus('ready');
      })
      .catch(() => active && setStatus('error'));
    return () => {
      active = false;
      markerRefs.current.forEach((marker) => {
        marker.map = null;
      });
      markerRefs.current.clear();
      if (currentLocationMarkerRef.current) currentLocationMarkerRef.current.map = null;
      currentLocationMarkerRef.current = null;
      polylineRefs.current.forEach((polyline) => polyline.setMap(null));
      polylineRefs.current = [];
      mapRef.current = null;
    };
  }, [currentLocation, hasPoints, locale, resolvedTheme]);

  useEffect(() => {
    if (status !== 'ready' || !mapRef.current) return;
    let active = true;
    void loadGoogleMaps(locale)
      .then(({ core, maps, marker }) => {
        if (!active || !mapRef.current) return;
        markerRefs.current.forEach((existingMarker) => {
          existingMarker.map = null;
        });
        markerRefs.current.clear();
        if (currentLocationMarkerRef.current) currentLocationMarkerRef.current.map = null;
        currentLocationMarkerRef.current = null;
        polylineRefs.current.forEach((polyline) => polyline.setMap(null));
        polylineRefs.current = [];

        const bounds = new core.LatLngBounds();
        // Every point gets a marker; only the day's own decide the frame.
        const framing = new Set(viewportPoints(points).map((point) => point.id));
        points.forEach((point) => {
          const content = markerContent(point);
          const advancedMarker = new marker.AdvancedMarkerElement({
            gmpClickable: true,
            map: mapRef.current,
            position: { lat: point.latitude, lng: point.longitude },
            title:
              point.kind === 'scheduled'
                ? t('scheduledMarkerLabel', { name: point.name, order: point.order ?? 0 })
                : point.kind === 'base'
                  ? t(baseMarkerLabelKey(point.baseRole), { name: point.name })
                  : t('consideredMarkerLabel', { name: point.name }),
            zIndex:
              point.kind === 'scheduled' ? 10 + (point.order ?? 0) : point.kind === 'base' ? 8 : 1,
          });
          advancedMarker.append(content);
          advancedMarker.addEventListener('gmp-click', () => onSelectPointRef.current(point));
          markerRefs.current.set(point.id, advancedMarker);
          if (framing.has(point.id)) bounds.extend({ lat: point.latitude, lng: point.longitude });
        });

        const routePaths = routePolylines
          .map(decodeGooglePolyline)
          .filter((path) => path.length > 1);
        const routeColor = getComputedStyle(document.documentElement)
          .getPropertyValue('--primary')
          .trim();
        polylineRefs.current = routePaths.map(
          (path) =>
            new maps.Polyline({
              clickable: false,
              map: mapRef.current,
              path: path.map((point) => ({ lat: point.latitude, lng: point.longitude })),
              strokeColor: routeColor,
              strokeOpacity: 0.82,
              strokeWeight: 5,
              zIndex: 2,
            }),
        );
        routePaths.flat().forEach((point) => {
          bounds.extend({ lat: point.latitude, lng: point.longitude });
        });

        if (currentLocation) {
          const advancedMarker = new marker.AdvancedMarkerElement({
            map: mapRef.current,
            position: { lat: currentLocation.latitude, lng: currentLocation.longitude },
            title: t('currentLocationMarkerLabel'),
            zIndex: 50,
          });
          advancedMarker.append(currentLocationContent());
          currentLocationMarkerRef.current = advancedMarker;
          bounds.extend({ lat: currentLocation.latitude, lng: currentLocation.longitude });
        }

        const locationCount = framing.size + (currentLocation ? 1 : 0);
        if (locationCount === 1 && routePaths.length === 0) {
          mapRef.current.setCenter(bounds.getCenter());
          mapRef.current.setZoom(14);
        } else {
          mapRef.current.fitBounds(bounds, 56);
        }
      })
      .catch(() => active && setStatus('error'));
    return () => {
      active = false;
    };
  }, [currentLocation, locale, points, routePolylines, status, t]);

  useEffect(() => {
    markerRefs.current.forEach((marker, id) => {
      const content = marker.firstElementChild as HTMLElement | null;
      if (content) content.dataset.selected = String(id === selectedPointId);
      marker.zIndex = id === selectedPointId ? 100 : null;
    });
  }, [selectedPointId]);

  if (!points.length && !currentLocation) {
    return (
      <PageState
        className="min-h-[28rem] justify-center rounded-none border-0 bg-muted/35"
        description={t('emptyDescription')}
        headingLevel={2}
        icon={<MapPinned aria-hidden="true" />}
        title={t('emptyTitle')}
      />
    );
  }

  if (!hasGoogleMapsConfiguration()) {
    return (
      <PageState
        className="min-h-[28rem] justify-center rounded-none border-0 bg-muted/35"
        description={t('configurationDescription')}
        headingLevel={2}
        icon={<MapPinned aria-hidden="true" />}
        kind="error"
        title={t('configurationTitle')}
      />
    );
  }

  return (
    <div className="relative min-h-[28rem] overflow-hidden bg-muted/40 lg:min-h-[34rem]">
      <div
        aria-label={ariaLabel ?? t('label')}
        className="absolute inset-0"
        ref={containerRef}
        role="region"
      />
      {status === 'loading' ? (
        <PageState
          className="absolute inset-0 z-[1] justify-center rounded-none border-0 bg-muted/80"
          kind="loading"
          title={t('loading')}
        />
      ) : null}
      {status === 'error' ? (
        <PageState
          className="absolute inset-0 z-[1] justify-center rounded-none border-0 bg-muted/90"
          description={t('unavailableDescription')}
          headingLevel={2}
          icon={<MapPinned aria-hidden="true" />}
          kind="error"
          title={t('unavailableTitle')}
        />
      ) : null}
      {selectedPoint && status === 'ready' ? (
        <div className="absolute inset-x-3 bottom-3 z-[1] rounded-[var(--radius-lg)] border border-border bg-card/95 p-3 shadow-[var(--shadow-overlay)] backdrop-blur-sm">
          <p className="truncate text-sm font-semibold">{selectedPoint.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {selectedPoint.kind === 'scheduled'
              ? t('scheduledSelection', { order: selectedPoint.order ?? 0 })
              : selectedPoint.kind === 'base'
                ? t(baseSelectionKey(selectedPoint.baseRole))
                : t('consideredSelection')}
          </p>
          {/* A Place off this day may still be spoken for. Saying which day it is on
              is what stops the same Place being planned twice by accident. */}
          {selectedPoint.otherDayNumbers?.length ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('alsoOnDays', {
                count: selectedPoint.otherDayNumbers.length,
                days: selectedPoint.otherDayNumbers.join(', '),
              })}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2" ref={actionsRef}>
            {/* Only a Place that is not on this day yet can be added to it. Once it
                is, the point becomes `scheduled` and this gives way to "View item". */}
            {onAddToDay && selectedPoint.kind === 'considered' ? (
              <Button
                disabled={addingPointId === selectedPoint.id}
                onClick={() => void addToDay(selectedPoint)}
                size="sm"
              >
                <CalendarPlus aria-hidden="true" data-icon="inline-start" />
                {t('addToDay')}
              </Button>
            ) : null}
            {selectedPoint.itemId ? (
              <Button onClick={() => onViewItem(selectedPoint.itemId!)} size="sm" variant="outline">
                <Eye aria-hidden="true" data-icon="inline-start" />
                {t('viewItem')}
              </Button>
            ) : null}
            <Button
              onClick={() => onOpenPlace(selectedPoint.tripPlaceId)}
              size="sm"
              variant="outline"
            >
              <MapPinned aria-hidden="true" data-icon="inline-start" />
              {t('viewPlace')}
            </Button>
            <Button
              nativeButton={false}
              render={
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${selectedPoint.latitude},${selectedPoint.longitude}`}
                  rel="noreferrer"
                  target="_blank"
                />
              }
              size="sm"
              variant="outline"
            >
              <Navigation aria-hidden="true" data-icon="inline-start" />
              {t('directions')}
            </Button>
          </div>
          {/* Always mounted so the result is announced, but it takes no room until
              there is something to say. */}
          <p
            aria-live="polite"
            className={cn('text-xs text-muted-foreground', addFeedback && 'mt-2')}
            role="status"
          >
            {addFeedback}
          </p>
        </div>
      ) : null}
    </div>
  );
}
