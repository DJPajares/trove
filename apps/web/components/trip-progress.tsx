'use client';

import { useLocale, useTranslations } from 'next-intl';

import { usePreferences } from '@/components/preferences-provider';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useTravellerPosition } from '@/hooks/use-traveller-position';
import type { ItineraryItem, RouteTravelMode, TripModeContext } from '@/lib/itinerary/api';
import { formatDistanceValue } from '@/lib/itinerary/format-distance';
import { legProgressFraction } from '@/lib/itinerary/leg-progress';
import { TravelModeIcon } from '@/lib/itinerary/travel-mode';
import { haversineMeters, type Coordinate } from '@/lib/maps/haversine';
import type { Trip } from '@/lib/trips/api';
import { daysUntilTripStart, departureApproach, resolveCountdown } from '@/lib/trips/lifecycle';
import { cn } from '@/lib/utils';

/**
 * The track's own language, borrowed from the map so a walk reads the same in
 * both places: dots for walking, dashes for transit, a solid line for driving.
 * A flight is never routed, so it keeps the solid default.
 *
 * The pattern paints in `--track-ink` rather than the solid track colour: dots
 * cover about a third of the line and dashes about half, so at the track's own
 * 25% they would all but vanish. The ink is mixed to land the patterned track
 * at roughly the weight of the solid one.
 */
const MODE_TRACK: Record<RouteTravelMode, string> = {
  drive: '',
  flight: '',
  transit:
    'bg-[repeating-linear-gradient(90deg,currentColor_0_6px,transparent_6px_11px)] text-(--track-ink) bg-transparent',
  walk: 'bg-[repeating-linear-gradient(90deg,currentColor_0_2px,transparent_2px_6px)] text-(--track-ink) bg-transparent',
};

type Tone = { fill: string; ink: string; label: string; track: string; trackInk: string };

const TONES: Record<'default' | 'inverse', Tone> = {
  default: {
    fill: 'bg-primary',
    ink: 'text-muted-foreground',
    label: 'text-muted-foreground',
    track: 'bg-primary/25',
    trackInk: 'color-mix(in oklab, var(--color-primary) 50%, transparent)',
  },
  inverse: {
    fill: 'bg-primary-on-media',
    ink: 'text-white/85',
    label: 'text-white/85',
    track: 'bg-primary-on-media/25',
    trackInk: 'color-mix(in oklab, var(--color-primary-on-media) 55%, transparent)',
  },
};

function Shell({
  announcement,
  children,
  className,
  label,
  tone,
  value,
  valueText,
}: Readonly<{
  announcement: string;
  children: React.ReactNode;
  className?: string;
  label: string;
  tone: Tone;
  value: number;
  valueText: string;
}>) {
  const locale = useLocale();

  return (
    <Progress.Root
      aria-valuetext={announcement}
      className={cn('w-full min-w-0', className)}
      locale={locale}
      value={value}
    >
      <div className={cn('mb-1.5 flex items-baseline justify-between gap-3 text-xs', tone.ink)}>
        <Progress.Label className="font-medium">{label}</Progress.Label>
        <Progress.Value className="shrink-0 tabular-nums">{() => valueText}</Progress.Value>
      </div>
      {children}
    </Progress.Root>
  );
}

function PreparednessBar({
  className,
  tone,
  trip,
}: Readonly<{ className?: string; tone: Tone; trip: Trip }>) {
  const t = useTranslations('tripProgress.preparedness');
  const preparedness = trip.tripPreparedness;

  if (!preparedness) return null;

  const { daysPlanned, daysWithStay, percentage, totalDays } = preparedness;

  return (
    <Shell
      announcement={t(preparedness.stayApplicable ? 'announcement' : 'announcementPlannedOnly', {
        daysPlanned,
        daysWithStay,
        percentage,
        totalDays,
      })}
      className={className}
      label={t('label')}
      tone={tone}
      value={percentage}
      valueText={t('value', { percentage })}
    >
      <Progress.Track className={cn('h-1.5 overflow-hidden rounded-full', tone.track)}>
        <Progress.Indicator className={cn('rounded-full', tone.fill)} />
      </Progress.Track>
    </Shell>
  );
}

function DepartureBar({
  className,
  tone,
  trip,
}: Readonly<{ className?: string; tone: Tone; trip: Trip }>) {
  const t = useTranslations('tripProgress.departure');
  const homeT = useTranslations('home');
  const percentage = departureApproach(trip);

  // Beyond the final month the wait has no honest denominator, so the surface
  // keeps its countdown line and simply has no bar.
  if (percentage === null) return null;

  const countdown = resolveCountdown(daysUntilTripStart(trip));
  const countdownText = homeT('countdown', { count: countdown.value, unit: countdown.unit });

  return (
    <Shell
      announcement={t('announcement', {
        countdown: countdownText,
        percentage: Math.round(percentage),
      })}
      className={className}
      label={t('label')}
      tone={tone}
      value={percentage}
      valueText={countdownText}
    >
      <Progress.Track className={cn('h-1.5 overflow-hidden rounded-full', tone.track)}>
        <Progress.Indicator className={cn('rounded-full', tone.fill)} />
      </Progress.Track>
    </Shell>
  );
}

function itemName(item: ItineraryItem, fallback: string) {
  return (
    item.customLabel ??
    item.tripPlace?.place.name ??
    item.tripPlace?.place.snapshot?.name ??
    item.tripPlace?.place.providerLabel ??
    fallback
  );
}

function itemCoordinate(item: ItineraryItem | undefined): Coordinate | null {
  const location = item?.tripPlace?.place.location;

  return location ? { latitude: location.latitude, longitude: location.longitude } : null;
}

function LegBar({
  className,
  context,
  tone,
}: Readonly<{ className?: string; context: TripModeContext; tone: Tone }>) {
  const t = useTranslations('tripProgress.leg');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const { position, request, status } = useTravellerPosition({
    enabled: context.contextSource === 'live',
  });

  const leaveBy = context.leaveBy;
  const items = context.day?.items ?? [];
  const destination = items.find((item) => item.id === leaveBy?.destinationItemId);
  const origin = items.find((item) => item.id === leaveBy?.originItemId);

  if (!leaveBy || !destination) return null;

  const destinationPoint = itemCoordinate(destination);
  const originPoint = itemCoordinate(origin);
  const name = itemName(destination, t('label'));

  // The label prefers the real travel distance Routes gave us; the marker's
  // position never mixes it with a straight line, so the two can disagree
  // without the marker leaving its track.
  const straightLine =
    originPoint && destinationPoint ? haversineMeters(originPoint, destinationPoint) : null;
  const labelMeters = leaveBy.distanceMeters ?? straightLine;
  const distanceText =
    labelMeters === null
      ? t('distanceUnknown')
      : t('distance', {
          unit: t(`unit.${preferences.distanceUnit}`),
          value: formatDistanceValue(labelMeters, preferences.distanceUnit, locale),
        });

  const fraction =
    position && originPoint && destinationPoint
      ? legProgressFraction(originPoint, destinationPoint, position)
      : null;
  const percentage = fraction === null ? 0 : Math.round(fraction * 100);
  const mode = t(`mode.${leaveBy.mode}`);

  return (
    <Shell
      announcement={
        fraction === null
          ? t('announcementUnlocated', { distance: distanceText, mode, name })
          : t('announcementLocated', { distance: distanceText, mode, name, percentage })
      }
      className={className}
      label={name}
      tone={tone}
      value={percentage}
      valueText={distanceText}
    >
      <div className="relative" style={{ '--track-ink': tone.trackInk } as React.CSSProperties}>
        <Progress.Track
          className={cn('h-1.5 overflow-hidden rounded-full', tone.track, MODE_TRACK[leaveBy.mode])}
        >
          <Progress.Indicator className={cn('rounded-full', tone.fill)} />
        </Progress.Track>
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute top-1/2 grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border shadow-sm transition-[left] duration-[var(--motion-slow)] motion-reduce:transition-none [&_svg]:size-3.5',
            tone === TONES.inverse
              ? 'border-white/25 bg-neutral-950/70 text-white backdrop-blur-sm'
              : 'border-border-subtle bg-card text-foreground',
          )}
          style={{ left: `${percentage}%` }}
        >
          <TravelModeIcon mode={leaveBy.mode} />
        </span>
      </div>
      {fraction === null && status !== 'unsupported' && context.contextSource === 'live' ? (
        <div className={cn('mt-1.5 text-xs', tone.ink)}>
          {status === 'denied' ? (
            <p>{t('locationDenied')}</p>
          ) : (
            <Button
              className={cn('h-auto p-0 text-xs', tone === TONES.inverse && 'text-white/85')}
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
    </Shell>
  );
}

export type TripProgressProps = {
  className?: string;
  inverse?: boolean;
  trip: Trip;
  /** Only read for an active trip, and only ever a value the surface already has. */
  tripModeContext?: TripModeContext | null;
};

/**
 * One bar, saying whichever thing the trip's own phase makes worth saying.
 *
 * A trip being planned is asked how much of what it needs is on the plan; one
 * the traveller has called Ready is asked how close departure is; one under way
 * is asked how far it is to the next stop. A finished trip is asked nothing -
 * there is no progress left to make.
 */
export function TripProgress({
  className,
  inverse = false,
  trip,
  tripModeContext = null,
}: Readonly<TripProgressProps>) {
  const tone = inverse ? TONES.inverse : TONES.default;

  if (trip.lifecycle === 'completed') return null;

  if (trip.lifecycle === 'active') {
    return tripModeContext ? (
      <LegBar className={className} context={tripModeContext} tone={tone} />
    ) : null;
  }

  return trip.planningReadiness === 'ready' ? (
    <DepartureBar className={className} tone={tone} trip={trip} />
  ) : (
    <PreparednessBar className={className} tone={tone} trip={trip} />
  );
}
