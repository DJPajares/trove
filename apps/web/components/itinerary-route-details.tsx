'use client';

import { CarFront, Footprints, Route, TramFront } from 'lucide-react';
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
        {summary?.durationSeconds !== null && summary?.durationSeconds !== undefined ? (
          <span className="tabular-nums text-muted-foreground">
            {t(partial ? 'knownDuration' : 'duration', {
              value: formatDuration(summary.durationSeconds, locale),
            })}
          </span>
        ) : (
          <span className="text-muted-foreground">{t('travelTimeUnavailable')}</span>
        )}
        {summary?.distanceMeters !== null && summary?.distanceMeters !== undefined ? (
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
}: Readonly<{
  distanceUnit: 'km' | 'mi';
  locale: string;
  onModeChange: (segment: ItineraryRouteSegment, mode: RouteTravelMode) => void;
  saving: boolean;
  segment: ItineraryRouteSegment;
}>) {
  const t = useTranslations('itinerary.routes');
  const originLabel = segment.origin.label ?? t(`point.${segment.origin.kind}`);
  const isAvailable =
    segment.status === 'ok' && segment.durationSeconds !== null && segment.distanceMeters !== null;

  return (
    <div
      className="flex min-h-14 items-center gap-2 border-y border-border/60 bg-muted/15 px-3 py-1.5 text-xs text-muted-foreground sm:min-h-10"
      role="listitem"
    >
      <span aria-hidden="true" className="ml-3 h-5 w-px bg-border-strong" />
      <span className="min-w-0 flex-1 truncate">
        {isAvailable
          ? t('segmentEstimate', {
              distance: formatDistance(segment.distanceMeters!, distanceUnit, locale),
              duration: formatDuration(segment.durationSeconds!, locale),
              origin: originLabel,
              unit: t(`units.${distanceUnit}`),
            })
          : t('segmentUnavailable', { origin: originLabel })}
      </span>
      <Select
        disabled={saving}
        onValueChange={(value) => onModeChange(segment, value as RouteTravelMode)}
        value={segment.mode}
      >
        <SelectTrigger
          aria-label={t('changeMode', { origin: originLabel })}
          className={cn('h-11 w-auto min-w-28 bg-background px-2 sm:h-8', saving && 'opacity-70')}
          size="sm"
        >
          <SelectValue>
            <span className="inline-flex items-center gap-1.5">
              {modeIcon(segment.mode)}
              {t(`mode.${segment.mode}`)}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent align="end">
          {(['drive', 'transit', 'walk'] as const).map((mode) => (
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
