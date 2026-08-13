'use client';

import { Eye, MapPinned } from 'lucide-react';
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
import { decodeGooglePolyline, type ItineraryMapPoint } from '@/lib/maps/itinerary-map';
import { cn } from '@/lib/utils';

type ItineraryPlanningMapProps = {
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
    'grid place-items-center rounded-full border-2 font-semibold shadow-[var(--shadow-control)] transition-[transform,box-shadow] duration-[var(--motion-fast)]',
    point.kind === 'scheduled'
      ? 'size-9 border-background bg-primary text-xs text-primary-foreground'
      : 'size-7 border-primary bg-card text-primary',
    'data-[selected=true]:scale-110 data-[selected=true]:ring-4 data-[selected=true]:ring-ring/35',
  );
  element.dataset.selected = 'false';
  element.textContent = point.order ? String(point.order) : '';
  return element;
}

export function ItineraryPlanningMap({
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
  const polylineRefs = useRef<GooglePolylineInstance[]>([]);
  const onSelectPointRef = useRef(onSelectPoint);
  const [status, setStatus] = useState<'error' | 'loading' | 'ready'>(
    hasGoogleMapsConfiguration() ? 'loading' : 'error',
  );
  const hasPoints = points.length > 0;
  const selectedPoint = useMemo(
    () => points.find((point) => point.id === selectedPointId) ?? null,
    [points, selectedPointId],
  );

  useEffect(() => {
    onSelectPointRef.current = onSelectPoint;
  }, [onSelectPoint]);

  useEffect(() => {
    const initialPoint = points[0];
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
      polylineRefs.current.forEach((polyline) => polyline.setMap(null));
      polylineRefs.current = [];
      mapRef.current = null;
    };
  }, [hasPoints, locale, resolvedTheme]);

  useEffect(() => {
    if (status !== 'ready' || !mapRef.current) return;
    let active = true;
    void loadGoogleMaps(locale)
      .then(({ maps, marker }) => {
        if (!active || !mapRef.current) return;
        markerRefs.current.forEach((existingMarker) => {
          existingMarker.map = null;
        });
        markerRefs.current.clear();
        polylineRefs.current.forEach((polyline) => polyline.setMap(null));
        polylineRefs.current = [];

        const bounds = new maps.LatLngBounds();
        points.forEach((point) => {
          const content = markerContent(point);
          const advancedMarker = new marker.AdvancedMarkerElement({
            gmpClickable: true,
            map: mapRef.current,
            position: { lat: point.latitude, lng: point.longitude },
            title:
              point.kind === 'scheduled'
                ? t('scheduledMarkerLabel', { name: point.name, order: point.order ?? 0 })
                : t('consideredMarkerLabel', { name: point.name }),
            zIndex: point.kind === 'scheduled' ? 10 + (point.order ?? 0) : 1,
          });
          advancedMarker.append(content);
          advancedMarker.addEventListener('gmp-click', () => onSelectPointRef.current(point));
          markerRefs.current.set(point.id, advancedMarker);
          bounds.extend({ lat: point.latitude, lng: point.longitude });
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

        if (points.length === 1 && routePaths.length === 0) {
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
  }, [locale, points, routePolylines, status, t]);

  useEffect(() => {
    markerRefs.current.forEach((marker, id) => {
      const content = marker.firstElementChild as HTMLElement | null;
      if (content) content.dataset.selected = String(id === selectedPointId);
      marker.zIndex = id === selectedPointId ? 100 : null;
    });
  }, [selectedPointId]);

  if (!points.length) {
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
      <div aria-label={t('label')} className="absolute inset-0" ref={containerRef} role="region" />
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
              : t('consideredSelection')}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
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
          </div>
        </div>
      ) : null}
    </div>
  );
}
