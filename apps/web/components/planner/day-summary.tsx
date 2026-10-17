'use client';

import { Route, Timer } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { usePreferences } from '@/components/preferences-provider';
import type { DayFacts } from '@/lib/itinerary/day-facts';
import { formatDistanceValue } from '@/lib/itinerary/format-distance';
import { formatPlannedDuration, formatTravelDuration } from '@/lib/itinerary/route-format';
import { cn } from '@/lib/utils';

function Measure({
  icon,
  label,
  pending,
  title,
}: Readonly<{ icon: ReactNode; label: string; pending?: boolean; title?: string }>) {
  return (
    <li
      className={cn(
        'flex min-w-0 items-center gap-1.5',
        pending && 'animate-pulse motion-reduce:animate-none',
      )}
      title={title}
    >
      <span aria-hidden="true" className="shrink-0 [&_svg]:size-3.5">
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </li>
  );
}

/**
 * The day in one look: how long it is planned to take, how that time splits
 * between being at stops and getting between them, and how far it goes.
 *
 * The planned time leads, because it is the answer to "is this day too full?".
 * Beneath it, one thin bar weighs time at stops against travel - a glance says
 * whether the day is spent there or on the way - and the travel and distance
 * that make it up, each saying when it is only the part that could be measured.
 * A day without a length for every stop leads with its stops instead, and
 * draws no bar it could not draw honestly.
 */
export function DaySummary({
  compactTravel,
  facts,
  routesLoading,
}: Readonly<{
  /** The traveller turned travel details off; the day says nothing about travel. */
  compactTravel: boolean;
  facts: DayFacts;
  routesLoading: boolean;
}>) {
  const t = useTranslations('itinerary.planner.masthead');
  const routesT = useTranslations('itinerary.routes');
  const locale = useLocale();
  const { preferences } = usePreferences();

  if (!facts.stopCount) {
    return (
      <p className="flex h-full items-center rounded-[var(--radius-lg)] border border-dashed border-border px-3.5 py-3 text-sm text-muted-foreground">
        {t('stops', { count: 0 })}
      </p>
    );
  }

  const travel = compactTravel ? null : facts.travel;
  const planned = facts.planned;
  const travelMinutes = travel?.kind === 'known' ? Math.round(travel.durationSeconds / 60) : 0;
  const total = (planned?.minutes ?? 0) + travelMinutes;
  const travelShare = planned && travelMinutes && total ? travelMinutes / total : 0;

  return (
    <div className="flex h-full flex-col justify-center gap-2.5 rounded-[var(--radius-lg)] border border-border-subtle bg-card px-3.5 py-3">
      <p className="min-w-0">
        <span className="block text-xl leading-tight font-semibold tracking-[-0.02em] tabular-nums">
          {planned
            ? `${planned.approximate ? '≈' : ''}${formatPlannedDuration(planned.minutes, locale)}`
            : t('stops', { count: facts.stopCount })}
        </span>
        {planned ? (
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {t('facts.plannedAt', { count: facts.stopCount })}
          </span>
        ) : null}
      </p>

      {/* Time at stops against time getting there, drawn only when both are known. */}
      {travelShare ? (
        <span aria-hidden="true" className="flex h-1.5 gap-0.5 overflow-hidden rounded-full">
          <span className="rounded-full bg-primary" style={{ flexGrow: 1 - travelShare }} />
          <span
            className="min-w-1.5 rounded-full bg-accent-strong/70"
            style={{ flexGrow: travelShare }}
          />
        </span>
      ) : null}

      {travel || (routesLoading && !compactTravel) ? (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
          {routesLoading && !travel ? (
            <Measure icon={<Timer />} label={t('measuringTravel')} pending />
          ) : travel?.kind === 'known' ? (
            <>
              <Measure
                icon={<Timer className={travelShare ? 'text-accent-strong' : undefined} />}
                label={routesT(travel.partial ? 'knownDuration' : 'duration', {
                  value: formatTravelDuration(travel.durationSeconds, locale),
                })}
              />
              {travel.distanceMeters !== null ? (
                <Measure
                  icon={<Route />}
                  label={routesT(travel.partial ? 'knownDistance' : 'distance', {
                    unit: routesT(`units.${preferences.distanceUnit}`),
                    value: formatDistanceValue(
                      travel.distanceMeters,
                      preferences.distanceUnit,
                      locale,
                    ),
                  })}
                />
              ) : null}
            </>
          ) : travel?.kind === 'unavailable' ? (
            <Measure icon={<Timer />} label={routesT('travelTimeUnavailable')} />
          ) : travel?.kind === 'long_distance_only' ? (
            <Measure icon={<Route />} label={routesT('noLocalTravel')} />
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
