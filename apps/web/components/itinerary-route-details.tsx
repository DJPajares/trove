'use client';

import { CarFront, Footprints, Plane, Route, TramFront } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  ItineraryDayRoutes,
  ItineraryRouteSegment,
  RouteTravelMode,
} from '@/lib/itinerary/api';
import { cn } from '@/lib/utils';

type RouteLoadStatus = 'error' | 'idle' | 'loading';

function modeIcon(mode: RouteTravelMode): ReactNode {
  if (mode === 'flight') return <Plane aria-hidden="true" />;
  if (mode === 'transit') return <TramFront aria-hidden="true" />;
  if (mode === 'walk') return <Footprints aria-hidden="true" />;
  return <CarFront aria-hidden="true" />;
}

function formatDuration(seconds: number, locale: string) {
  const minutes = Math.max(0, Math.round(seconds / 60));
  const minuteFormatter = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'minute',
    unitDisplay: 'short',
  });
  if (minutes < 60) return minuteFormatter.format(minutes);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  const hourValue = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'hour',
    unitDisplay: 'short',
  }).format(hours);
  return remainingMinutes ? `${hourValue} ${minuteFormatter.format(remainingMinutes)}` : hourValue;
}

function formatDistance(meters: number, distanceUnit: 'km' | 'mi', locale: string) {
  const value = distanceUnit === 'mi' ? meters / 1609.344 : meters / 1000;
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value);
}

export function ItineraryRouteSummary({
  data,
  distanceUnit,
  locale,
  status,
}: Readonly<{
  data: ItineraryDayRoutes | null;
  distanceUnit: 'km' | 'mi';
  locale: string;
  status: RouteLoadStatus;
}>) {
  const t = useTranslations('itinerary.routes');

  if (status === 'loading' && !data) {
    return (
      <div
        aria-label={t('loading')}
        className="flex min-h-14 items-center gap-3 border-b border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground sm:px-6"
        role="status"
      >
        <Route aria-hidden="true" className="size-4 animate-pulse motion-reduce:animate-none" />
        {t('loading')}
      </div>
    );
  }

  const summary = data?.summary;
  const partial = summary?.status === 'partial';
  // A day that only moves long distance has no local travel to total. Reporting
  // "0 min, 0 km" would read as a failed estimate rather than an absent one.
  const noLocalTravel =
    summary !== undefined && summary.localSegmentCount === 0 && summary.totalSegmentCount > 0;
  const hasGoogleRoutes = data?.segments.some((segment) => segment.provider === 'google') ?? false;
  const hasWalkingRoute = data?.segments.some((segment) => segment.mode === 'walk') ?? false;

  return (
    <section
      aria-label={t('summaryLabel')}
      className="border-b border-border bg-muted/20 px-4 py-3 sm:px-6"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-2 font-medium">
          <Route aria-hidden="true" className="size-4 text-primary" />
          {t('stops', { count: summary?.scheduledPlaceCount ?? 0 })}
        </span>
        {noLocalTravel ? (
          <span className="text-muted-foreground">{t('noLocalTravel')}</span>
        ) : summary?.durationSeconds !== null && summary?.durationSeconds !== undefined ? (
          <span className="tabular-nums text-muted-foreground">
            {t(partial ? 'knownDuration' : 'duration', {
              value: formatDuration(summary.durationSeconds, locale),
            })}
          </span>
        ) : (
          <span className="text-muted-foreground">{t('travelTimeUnavailable')}</span>
        )}
        {!noLocalTravel &&
        summary?.distanceMeters !== null &&
        summary?.distanceMeters !== undefined ? (
          <span className="tabular-nums text-muted-foreground">
            {t(partial ? 'knownDistance' : 'distance', {
              unit: t(`units.${distanceUnit}`),
              value: formatDistance(summary.distanceMeters, distanceUnit, locale),
            })}
          </span>
        ) : null}
      </div>
      {status === 'error' || summary?.status === 'unavailable' ? (
        <p className="mt-1 text-xs text-muted-foreground">{t('unavailable')}</p>
      ) : partial ? (
        <p className="mt-1 text-xs text-muted-foreground">{t('partial')}</p>
      ) : null}
      {data?.source === 'cache' ? (
        <p className="mt-1 text-xs text-status-warning">
          {t('cachedRoute', {
            date: new Intl.DateTimeFormat(locale, {
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(new Date(data.generatedAt)),
          })}
        </p>
      ) : null}
      {hasWalkingRoute ? (
        <p className="mt-1 text-xs text-muted-foreground">{t('walkingBeta')}</p>
      ) : null}
      {hasGoogleRoutes ? (
        <p className="mt-1 text-[0.6875rem] text-muted-foreground">{t('googleAttribution')}</p>
      ) : null}
    </section>
  );
}

export function ItineraryRouteSegmentRow({
  distanceUnit,
  locale,
  onModeChange,
  saving,
  segment,
  stale = false,
}: Readonly<{
  distanceUnit: 'km' | 'mi';
  locale: string;
  onModeChange: (segment: ItineraryRouteSegment, mode: RouteTravelMode) => void;
  saving: boolean;
  segment: ItineraryRouteSegment;
  /** The whole day's legs came from the offline cache rather than a live estimate. */
  stale?: boolean;
}>) {
  const t = useTranslations('itinerary.routes');
  const originLabel = segment.origin.label ?? t(`point.${segment.origin.kind}`);
  // Between-item legs need no extra context — the two stops on either side
  // already say why the leg exists. Boundary legs (day start / return to the
  // daily base) don't have that, so they're called out explicitly.
  const legRoleLabel =
    segment.modeOwner.kind === 'day_start'
      ? t('dayStartLabel')
      : segment.destination.kind === 'daily_base'
        ? t('returnToBaseLabel')
        : null;
  const isAvailable =
    segment.status === 'ok' && segment.durationSeconds !== null && segment.distanceMeters !== null;
  // Three things worth telling apart: a flight is not estimated by design, a
  // routing attempt that failed, and a cached estimate. A cached leg is still the
  // right leg — the cache is only reused when it was computed for this exact
  // ordering — but its numbers are as old as the day's last successful lookup, so
  // they are never dressed up as current ones.
  const metricsLabel = isAvailable
    ? t(stale ? 'segmentCachedMetrics' : 'segmentEstimateMetrics', {
        distance: formatDistance(segment.distanceMeters!, distanceUnit, locale),
        duration: formatDuration(segment.durationSeconds!, locale),
        unit: t(`units.${distanceUnit}`),
      })
    : segment.status === 'not_estimated'
      ? t('segmentNotEstimatedMetrics')
      : t('segmentUnavailableMetrics');

  return (
    <div
      className="flex min-h-14 items-center gap-2 border-y border-border/60 bg-muted/15 px-3 py-1.5 text-xs text-muted-foreground sm:min-h-10"
      role="listitem"
    >
      <span aria-hidden="true" className="ml-3 h-5 w-px bg-border-strong" />
      {/* Metrics and origin are separate spans so the travel estimate — the reason
          this row exists — can never be the part that ellipses on a narrow screen. */}
      <span className="flex min-w-0 flex-1 flex-col items-start sm:flex-row sm:items-center sm:gap-1.5">
        <span
          className={cn(
            'shrink-0 whitespace-nowrap tabular-nums',
            isAvailable && !stale && 'font-medium text-foreground',
          )}
        >
          {metricsLabel}
        </span>
        <span className="min-w-0 max-w-full truncate">
          {legRoleLabel ? `${legRoleLabel} · ` : ''}
          {t('segmentOrigin', { origin: originLabel })}
        </span>
      </span>
      <Select
        disabled={saving}
        onValueChange={(value) => onModeChange(segment, value as RouteTravelMode)}
        value={segment.mode}
      >
        <SelectTrigger
          aria-label={t('changeMode', { origin: originLabel })}
          className={cn(
            'h-11 w-auto min-w-0 bg-background px-2 sm:h-8 sm:min-w-28',
            saving && 'opacity-70',
          )}
          size="sm"
        >
          <SelectValue>
            {/* Icon-only below sm to give the estimate its space back. `sr-only` rather
                than `hidden` keeps the selected mode in the accessibility tree, since
                the trigger's aria-label names the origin but not the current mode. */}
            <span className="inline-flex items-center gap-1.5">
              {modeIcon(segment.mode)}
              <span className="sr-only sm:not-sr-only">{t(`mode.${segment.mode}`)}</span>
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent align="end">
          {(['drive', 'transit', 'walk', 'flight'] as const).map((mode) => (
            <SelectItem key={mode} value={mode}>
              <span className="inline-flex items-center gap-2">
                {modeIcon(mode)}
                {t(`mode.${mode}`)}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
