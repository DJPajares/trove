'use client';

import { useTranslations, useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { usePreferences } from '@/components/preferences-provider';
import { formatDistanceValue } from '@/lib/itinerary/format-distance';
import { formatTravelDuration } from '@/lib/itinerary/route-format';
import {
  mapRoutePath,
  type MapRouteEndpoint,
  type MapRouteLeg,
} from '@/lib/maps/map-route-selection';

export function MapRouteSummary({ leg }: Readonly<{ leg: MapRouteLeg }>) {
  const t = useTranslations('itinerary.map');
  const routeT = useTranslations('itinerary.routes');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const endpoint = (end: MapRouteEndpoint) => {
    const name = end.label ?? routeT(`point.${end.kind}`);
    return end.order === null ? name : t('routeEndpoint', { order: end.order, name });
  };
  return (
    <span className="block min-w-0 text-start">
      <span className="block text-sm font-semibold text-foreground">
        {t('routeDirection', {
          origin: endpoint(leg.origin),
          destination: endpoint(leg.destination),
        })}
      </span>
      <span className="mt-1 block text-xs text-muted-foreground">
        {routeT(
          leg.status === 'not_estimated'
            ? 'state.not-estimated'
            : leg.status !== 'ok'
              ? 'state.unavailable'
              : leg.cached
                ? 'state.cached'
                : 'state.estimated',
        )}{' '}
        · {routeT(`mode.${leg.mode}`)}
        {leg.durationSeconds !== null ? (
          <> · {formatTravelDuration(leg.durationSeconds, locale)}</>
        ) : null}
        {leg.distanceMeters !== null ? (
          <>
            {' '}
            ·{' '}
            {routeT('distance', {
              value: formatDistanceValue(leg.distanceMeters, preferences.distanceUnit, locale),
              unit: routeT(`units.${preferences.distanceUnit}`),
            })}
          </>
        ) : null}
      </span>
      {mapRoutePath(leg).length < 2 ? (
        <span className="mt-1 block text-xs text-muted-foreground">
          {t('routePathUnavailable')}
        </span>
      ) : null}
    </span>
  );
}

export function MapRouteChooser({
  legs,
  selectedRouteId,
  onSelect,
}: Readonly<{
  legs: MapRouteLeg[];
  selectedRouteId: string | null;
  onSelect: (leg: MapRouteLeg) => void;
}>) {
  const t = useTranslations('itinerary.map');
  return (
    <div aria-label={t('chooseRoute')} className="flex flex-col gap-1" role="group">
      {legs.map((leg) => (
        <Button
          aria-pressed={leg.id === selectedRouteId}
          className="h-auto min-h-11 w-full justify-start whitespace-normal px-3 py-2"
          key={leg.id}
          onClick={() => onSelect(leg)}
          variant={leg.id === selectedRouteId ? 'secondary' : 'ghost'}
        >
          <MapRouteSummary leg={leg} />
        </Button>
      ))}
    </div>
  );
}
