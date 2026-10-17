'use client';

import { useLocale, useTranslations } from 'next-intl';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ItineraryRouteSegment, RouteTravelMode } from '@/lib/itinerary/api';
import { formatDistanceValue } from '@/lib/itinerary/format-distance';
import { formatTravelDuration } from '@/lib/itinerary/route-format';
import { TravelModeIcon } from '@/lib/itinerary/travel-mode';
import { cn } from '@/lib/utils';

import { InsertButton } from './insert-gap';
import { SpineRow } from './spine';

const MODES = ['drive', 'transit', 'walk', 'flight'] as const satisfies readonly RouteTravelMode[];

/**
 * The travel between two rows of the day, drawn as the line that joins them.
 *
 * It leads with what the leg costs - how, how long, how far - because where it
 * runs is already said by the rows above and below it. The legs that leave the
 * Stay in the morning and return to it at night are dashed and say so, which
 * is the one thing about them the rows around them do not (PRD 18.4.1). An
 * estimate Trove did not get is said plainly, never filled in.
 */
export function LegConnector({
  className,
  distanceUnit,
  insert,
  onModeChange,
  saving,
  segment,
}: Readonly<{
  className?: string;
  distanceUnit: 'km' | 'mi';
  /** Adding a stop on this leg - splitting it - is the "+" on its line. */
  insert?: { label: string; onInsert: () => void };
  onModeChange: (segment: ItineraryRouteSegment, mode: RouteTravelMode) => void;
  saving: boolean;
  segment: ItineraryRouteSegment;
}>) {
  const t = useTranslations('itinerary.routes');
  const locale = useLocale();
  const originLabel = segment.origin.label ?? t(`point.${segment.origin.kind}`);
  const leavesStay = segment.modeOwner.kind === 'day_start' && segment.origin.kind === 'daily_base';
  const returnsToStay = segment.destination.kind === 'daily_base';
  // The Stay at either end of the day already says where the day starts and
  // ends, so a leg to or from it does not say so again.
  const context = [
    ...(segment.modeOwner.kind !== 'day_start' &&
    !returnsToStay &&
    segment.origin.kind === 'starting_location'
      ? [t('segmentOrigin', { origin: originLabel })]
      : []),
    ...(segment.scope === 'long_distance' ? [t('segmentLongDistance')] : []),
  ].join(' · ');
  const available =
    segment.status === 'ok' && segment.durationSeconds !== null && segment.distanceMeters !== null;
  const metrics = available
    ? t('segmentEstimateMetrics', {
        distance: formatDistanceValue(segment.distanceMeters!, distanceUnit, locale),
        duration: formatTravelDuration(segment.durationSeconds!, locale),
        unit: t(`units.${distanceUnit}`),
      })
    : segment.status === 'not_estimated'
      ? t('segmentNotEstimatedMetrics')
      : t('segmentUnavailableMetrics');
  const line = leavesStay || returnsToStay ? 'dashed' : 'solid';

  return (
    <SpineRow
      above={line}
      align="center"
      below={line}
      className={className}
      marker={insert ? <InsertButton label={insert.label} onInsert={insert.onInsert} /> : undefined}
    >
      <div className="flex min-h-11 items-center gap-2 py-0.5">
        <p className="min-w-0 flex-1 text-xs leading-5 text-muted-foreground tabular-nums">
          <span className="font-medium text-foreground">{t(`mode.${segment.mode}`)}</span>
          <span aria-hidden="true" className="text-text-subtle">
            {' · '}
          </span>
          <span>{metrics}</span>
          {context ? <span className="block">{context}</span> : null}
        </p>
        <Select
          disabled={saving}
          onValueChange={(value) => onModeChange(segment, value as RouteTravelMode)}
          value={segment.mode}
        >
          <SelectTrigger
            aria-label={t('changeMode', { origin: originLabel })}
            className={cn('w-auto gap-1 bg-background', saving && 'opacity-70')}
            size="sm"
          >
            <SelectValue>
              <span className="inline-flex items-center">
                <TravelModeIcon className="size-4" mode={segment.mode} />
                <span className="sr-only">{t(`mode.${segment.mode}`)}</span>
              </span>
            </SelectValue>
          </SelectTrigger>
          {/* Below the trigger rather than over it: Base UI's default aligns the
              popup with the selected item, which at 375px covers the leg the
              menu belongs to. */}
          <SelectContent align="end" alignItemWithTrigger={false}>
            {MODES.map((mode) => (
              <SelectItem key={mode} value={mode}>
                <span className="inline-flex items-center gap-2">
                  <TravelModeIcon className="size-4" mode={mode} />
                  {t(`mode.${mode}`)}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </SpineRow>
  );
}
