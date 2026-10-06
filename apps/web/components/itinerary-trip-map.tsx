'use client';

import { skipToken, useQueries, type UseQueryResult } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useMemo, useState } from 'react';

import { ItineraryPlanningMap, type RouteLine } from '@/components/itinerary-planning-map';
import { Chip, ChipGroup } from '@/components/ui/chip';
import type {
  ItineraryDay,
  ItineraryDayRoutes,
  ItineraryItem,
  ItineraryTripPlace,
} from '@/lib/itinerary/api';
import { itineraryDayRouteRevision } from '@/lib/itinerary/routes';
import {
  buildTripMapPoints,
  type ItineraryMapLocation,
  type ItineraryMapPoint,
} from '@/lib/maps/itinerary-map';
import { mapDayTint } from '@/lib/maps/map-day-tints';
import { queryKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils';

const NO_ROUTE_LINES: RouteLine[] = [];
const ALL_DAYS = 'all';

// Held outside the component so the combined answer only changes when one of
// the cached entries does, rather than on every render.
// A watched entry carries no type of its own; it holds whatever the Day view's
// fetch put there, which is a day's routes.
const routeDataOf = (results: UseQueryResult[]) =>
  results.map((result) => result.data as ItineraryDayRoutes | undefined);

type ItineraryTripMapProps = {
  days: ItineraryDay[];
  /** Goes to the stop in its own day, where it can be read and changed. */
  onOpenItem: (itemId: string) => void;
  /** `focusDate` is the day the map is narrowed to, when it is. */
  onViewPlaceDetails: (point: ItineraryMapPoint, focusDate: string | null) => void;
  resolveItemName: (item: ItineraryItem) => string;
  resolvePlaceLocation: (tripPlace: ItineraryTripPlace) => ItineraryMapLocation | null;
  resolvePlaceName: (tripPlace: ItineraryTripPlace) => string;
  /** Keeps a retained, hidden map from moving until it is shown again. */
  suspendUpdates: boolean;
  tripId: string;
  tripPlaces: ItineraryTripPlace[];
};

/**
 * Where the whole trip goes, one colour per day.
 *
 * Everything on it is already in hand: the itinerary carries every Place's
 * coordinates and every day's stay, and a day's legs are only drawn when the
 * Day view has already fetched them. Nothing here asks a provider for anything
 * beyond the map itself, which is built once, on request, by the Overview.
 */
export function ItineraryTripMap({
  days,
  onOpenItem,
  onViewPlaceDetails,
  resolveItemName,
  resolvePlaceLocation,
  resolvePlaceName,
  suspendUpdates,
  tripId,
  tripPlaces,
}: Readonly<ItineraryTripMapProps>) {
  const t = useTranslations('itinerary');
  const locale = useLocale();
  const [requestedFocusDayId, setRequestedFocusDayId] = useState<string | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);

  // Watches the entries the Day view fills; `skipToken` means none of these
  // ever fetches. Either variant names a day's stay, and only the one asked for
  // with polylines can draw its route.
  const cachedRoutes = useQueries({
    combine: routeDataOf,
    queries: days.flatMap((day) => {
      const revision = itineraryDayRouteRevision(day);
      return [true, false].map((includePolyline) => ({
        queryFn: skipToken,
        queryKey: queryKeys.itineraryDayRoutes(tripId, day.id, revision, includePolyline, locale),
      }));
    }),
  });
  const routesByDayId = useMemo(
    () =>
      new Map(
        days.map((day, index) => [
          day.id,
          { polylines: cachedRoutes[index * 2], plain: cachedRoutes[index * 2 + 1] },
        ]),
      ),
    [cachedRoutes, days],
  );

  // The resolvers read only the itinerary and its translations, both of which
  // arrive here as `days` and `tripPlaces`, so they are left out of the deps -
  // as the Day view's own map points leave them out.
  const tripMap = useMemo(
    () =>
      buildTripMapPoints({
        days,
        focusDayId: requestedFocusDayId,
        resolveItemName,
        resolvePlaceLocation,
        resolvePlaceName,
        routeSegmentsByDayId: Object.fromEntries(
          [...routesByDayId].map(([dayId, routes]) => [
            dayId,
            (routes.polylines ?? routes.plain)?.segments,
          ]),
        ),
        tripPlaces,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [days, requestedFocusDayId, routesByDayId, tripPlaces],
  );
  const focusDayIndex = tripMap.focusDayId
    ? days.findIndex((day) => day.id === tripMap.focusDayId)
    : -1;
  const focusDay = focusDayIndex >= 0 ? days[focusDayIndex]! : null;

  const routeLines = useMemo(() => {
    const segments = focusDay ? routesByDayId.get(focusDay.id)?.polylines?.segments : undefined;
    const lines = segments?.flatMap((segment) =>
      segment.encodedPolyline
        ? [{ encodedPolyline: segment.encodedPolyline, mode: segment.mode }]
        : [],
    );
    return lines?.length ? lines : NO_ROUTE_LINES;
  }, [focusDay, routesByDayId]);

  const clearSelection = useCallback(() => setSelectedPointId(null), []);

  const describeSelection = useCallback(
    (point: ItineraryMapPoint) => {
      const dayNumbers = point.dayNumbers ?? [];
      if (point.kind === 'scheduled' && point.dayIndex !== undefined) {
        const day = point.dayIndex + 1;
        const others = dayNumbers.filter((number) => number !== day);
        return others.length
          ? t('map.tripStopSelectionAlso', {
              count: others.length,
              day,
              days: others.join(', '),
              order: point.order ?? 0,
            })
          : t('map.tripStopSelection', { day, order: point.order ?? 0 });
      }
      if (point.kind === 'base' && point.order === null && dayNumbers.length) {
        return t('map.tripStaySelection', {
          count: dayNumbers.length,
          days: dayNumbers.join(', '),
        });
      }
      if (point.kind === 'considered') return t('map.tripConsideredSelection');
      // A stay numbered within a focused day says which end of it it is.
      return null;
    },
    [t],
  );

  return (
    <div className="flex flex-col">
      {tripMap.points.length ? (
        <div className="border-b border-border-subtle px-4 py-3 sm:px-6">
          {/* The chips are the legend too: each carries the colour its day's
              stops are drawn in. A day with nothing located cannot be chosen,
              so the map is never asked to show nothing. */}
          <ChipGroup
            aria-label={t('map.tripDaysLabel')}
            className="interaction-scrollbar -mx-1 min-w-0 flex-nowrap overflow-x-auto px-1"
            multiple={false}
            onValueChange={([value]) => {
              setRequestedFocusDayId(!value || value === ALL_DAYS ? null : value);
              setSelectedPointId(null);
            }}
            value={[tripMap.focusDayId ?? ALL_DAYS]}
          >
            <Chip value={ALL_DAYS}>{t('map.allDays')}</Chip>
            {days.map((day, index) => (
              <Chip
                disabled={!tripMap.locatedDayIds.has(day.id)}
                icon={
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mx-auto mt-px block size-2.5 rounded-full',
                      mapDayTint(index).dot,
                    )}
                  />
                }
                key={day.id}
                value={day.id}
              >
                {t('dayNumber', { number: index + 1 })}
              </Chip>
            ))}
          </ChipGroup>
        </div>
      ) : null}
      <ItineraryPlanningMap
        ariaLabel={t('map.tripRegionLabel')}
        describeSelection={describeSelection}
        onClearSelection={clearSelection}
        onSelectPoint={(point) => setSelectedPointId(point.id)}
        onViewItem={onOpenItem}
        onViewPlaceDetails={(point) => onViewPlaceDetails(point, focusDay?.date ?? null)}
        points={tripMap.points}
        routeLines={routeLines}
        selectedPointId={selectedPointId}
        suspendUpdates={suspendUpdates}
        viewItemLabel={t('map.openInDay')}
      />
      {tripMap.unlocatedStopCount ? (
        <p className="border-t border-border-subtle px-4 py-3 text-xs leading-5 text-muted-foreground sm:px-6">
          {t('map.unlocatedStops', { count: tripMap.unlocatedStopCount })}
        </p>
      ) : null}
    </div>
  );
}
