'use client';

import { useLocale, useTranslations } from 'next-intl';

import { usePreferences } from '@/components/preferences-provider';
import { TONES, ProgressShell, type Tone } from '@/components/trip-progress-shell';
import { Button } from '@/components/ui/button';
import { useTravellerPosition } from '@/hooks/use-traveller-position';
import type { RouteTravelMode, TripModeContext, TripModeLegEndpoint } from '@/lib/itinerary/api';
import { formatEstimatedDistance } from '@/lib/itinerary/format-distance';
import { legProgressFraction } from '@/lib/itinerary/leg-progress';
import { TravelModeIcon } from '@/lib/itinerary/travel-mode';
import { haversineMeters } from '@/lib/maps/haversine';
import { cn } from '@/lib/utils';

/**
 * How the line between two stops is drawn, borrowed from the map so a walk
 * reads the same in both places: dots for walking, dashes for transit, a solid
 * line for driving. A flight is never routed, so it keeps the solid default.
 *
 * The proportions follow `lib/maps/route-line-style.ts` - a dot roughly every
 * 12px, a dash roughly every 18px - scaled down to a line this thin. The
 * pattern paints in `--track-ink` rather than the track's own 25%, because dots
 * cover about a third of a line and would otherwise all but vanish.
 */
const MODE_LINE: Record<RouteTravelMode, string> = {
  drive: '',
  flight: '',
  transit:
    'bg-transparent bg-[repeating-linear-gradient(90deg,currentColor_0_7px,transparent_7px_12px)] text-(--track-ink)',
  walk: 'bg-transparent bg-[repeating-linear-gradient(90deg,currentColor_0_3px,transparent_3px_8px)] text-(--track-ink)',
};

function endpointCoordinate(endpoint: TripModeLegEndpoint) {
  return endpoint.coordinate;
}

/**
 * One end of the leg. A plain dot rather than a glyph: the name underneath is
 * what tells a traveller which place this is, and two dots either side of a
 * line read as a journey without needing to be decoded.
 */
function Endpoint({ located, tone }: Readonly<{ located: boolean; tone: Tone }>) {
  return (
    <span
      aria-hidden="true"
      className={cn('size-3 shrink-0 rounded-full', located ? tone.fill : cn('border', tone.track))}
    />
  );
}

export type TripLegBarProps = {
  className?: string;
  context: TripModeContext;
  inverse?: boolean;
};

/**
 * Where the traveller is between two places.
 *
 * The leg comes from the context's own `leg` block rather than from `leaveBy`,
 * which only ever spans two stops Trove paid to route between - that left the
 * morning out of the daily base, and the evening back to it, with nothing to
 * draw at all. Distance is measured straight between the two ends and named as
 * an estimate; the device's position is what moves the marker along the line.
 */
export function TripLegBar({ className, context, inverse = false }: Readonly<TripLegBarProps>) {
  const t = useTranslations('tripProgress.leg');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const { position, request, status } = useTravellerPosition({
    enabled: context.contextSource === 'live',
  });

  const tone = inverse ? TONES.inverse : TONES.default;
  const leg = context.leg;

  if (!leg) return null;

  const originPoint = endpointCoordinate(leg.origin);
  const destinationPoint = endpointCoordinate(leg.destination);
  const originName = leg.origin.name ?? t('unnamedPlace');
  const destinationName = leg.destination.name ?? t('unnamedPlace');

  const meters =
    originPoint && destinationPoint ? haversineMeters(originPoint, destinationPoint) : null;
  const distance =
    meters === null ? null : formatEstimatedDistance(meters, preferences.distanceUnit, locale);
  const distanceText = distance
    ? t('distanceEstimate', { unit: t(`unit.${distance.unit}`), value: distance.value })
    : t('distanceUnknown');

  const fraction =
    position && originPoint && destinationPoint
      ? legProgressFraction(originPoint, destinationPoint, position)
      : null;
  const percentage = fraction === null ? 0 : Math.round(fraction * 100);
  const mode = t(`mode.${leg.mode}`);

  return (
    <ProgressShell
      announcement={
        fraction === null
          ? t('announcementUnlocated', {
              destination: destinationName,
              distance: distanceText,
              mode,
              origin: originName,
            })
          : t('announcementLocated', {
              destination: destinationName,
              distance: distanceText,
              mode,
              origin: originName,
              percentage,
            })
      }
      className={className}
      label={t('label')}
      tone={tone}
      value={percentage}
      valueText={distanceText}
    >
      <div
        className="flex items-center gap-2"
        style={{ '--track-ink': tone.trackInk } as React.CSSProperties}
      >
        <Endpoint located={originPoint !== null} tone={tone} />
        <div className="relative min-w-0 flex-1">
          <div className={cn('h-1 rounded-full', tone.track, MODE_LINE[leg.mode])} />
          {/* Absent rather than parked at nought: a marker sitting on the origin
              dot would claim the traveller is standing there, which is the one
              thing an unknown position cannot say. */}
          {fraction === null ? null : (
            <span
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute top-1/2 grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border shadow-sm transition-[left] duration-[var(--motion-slow)] motion-reduce:transition-none [&_svg]:size-3.5',
                inverse
                  ? 'border-white/25 bg-neutral-950/70 text-white backdrop-blur-sm'
                  : 'border-border-subtle bg-card text-foreground',
              )}
              style={{ left: `${percentage}%` }}
            >
              <TravelModeIcon mode={leg.mode} />
            </span>
          )}
        </div>
        <Endpoint located={destinationPoint !== null} tone={tone} />
      </div>

      <div className={cn('mt-1.5 flex items-start justify-between gap-3 text-xs', tone.ink)}>
        <span className="min-w-0 truncate">{originName}</span>
        <span className="min-w-0 truncate text-right">{destinationName}</span>
      </div>

      {fraction === null && status !== 'unsupported' && context.contextSource === 'live' ? (
        <div className={cn('mt-1.5 text-xs', tone.ink)}>
          {status === 'denied' ? (
            <p>{t('locationDenied')}</p>
          ) : (
            <Button
              className={cn('h-auto p-0 text-xs', inverse && 'text-white/85')}
              disabled={status === 'loading'}
              onClick={request}
              size="sm"
              variant="link"
            >
              {status === 'loading' ? t('locating') : t('locate')}
            </Button>
          )}
        </div>
      ) : null}
    </ProgressShell>
  );
}
