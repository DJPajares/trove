'use client';

import { useTranslations } from 'next-intl';

import { TripLegBar } from '@/components/trip-leg-bar';
import { TONES, ProgressShell, type Tone } from '@/components/trip-progress-shell';
import { Progress } from '@/components/ui/progress';
import type { TripModeContext } from '@/lib/itinerary/api';
import type { Trip } from '@/lib/trips/api';
import { daysUntilTripStart, departureApproach, resolveCountdown } from '@/lib/trips/lifecycle';
import { cn } from '@/lib/utils';

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
    <ProgressShell
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
    </ProgressShell>
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
    <ProgressShell
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
    </ProgressShell>
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
      <TripLegBar className={className} context={tripModeContext} inverse={inverse} />
    ) : null;
  }

  return trip.planningReadiness === 'ready' ? (
    <DepartureBar className={className} tone={tone} trip={trip} />
  ) : (
    <PreparednessBar className={className} tone={tone} trip={trip} />
  );
}
