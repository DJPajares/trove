'use client';

import { Route } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { RouteTimelineRow } from '@/components/timeline-row';
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
import { formatDistanceValue } from '@/lib/itinerary/format-distance';
import { routePresentationState } from '@/lib/itinerary/route-presentation';
import { TravelModeIcon } from '@/lib/itinerary/travel-mode';
import { cn } from '@/lib/utils';

type RouteLoadStatus = 'error' | 'idle' | 'loading';

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
        className="flex min-h-16 items-center gap-3 border-b border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground sm:px-6"
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
      // The same minimum the loading row holds, so the summary and its
      // attribution land in a box that was already their size.
      className="min-h-16 border-b border-border bg-muted/20 px-4 py-3 sm:px-6"
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
              value: formatDistanceValue(summary.distanceMeters, distanceUnit, locale),
            })}
          </span>
        ) : null}
      </div>
      {/* One wrapped line rather than a stack of paragraphs. Every note still
          renders — the Google attribution is an obligation, not a nicety — but
          on a phone they cost one row instead of four, which is four rows of
          the day the traveller gets to see instead. */}
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
        {status === 'error' || summary?.status === 'unavailable' ? (
          <span className="text-muted-foreground">{t('unavailable')}</span>
        ) : partial ? (
          <span className="text-muted-foreground">{t('partial')}</span>
        ) : null}
        {data?.source === 'cache' ? (
          <span className="text-status-warning">
            {t('cachedRoute', {
              date: new Intl.DateTimeFormat(locale, {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(data.generatedAt)),
            })}
          </span>
        ) : null}
        {hasWalkingRoute ? <span className="text-muted-foreground">{t('walkingBeta')}</span> : null}
        {hasGoogleRoutes ? (
          <span className="text-[0.6875rem] text-muted-foreground">{t('googleAttribution')}</span>
        ) : null}
      </div>
    </section>
  );
}

export function ItineraryRouteSegmentRow({
  connector,
  distanceUnit,
  locale,
  onModeChange,
  saving,
  segment,
  stale = false,
}: Readonly<{
  connector?: 'after' | 'before' | 'both' | 'none';
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
  const destinationLabel = segment.destination.label ?? t(`point.${segment.destination.kind}`);
  // Between-item legs need no extra context — the two stops on either side
  // already say why the leg exists. Boundary legs (day start / return to the
  // daily base) don't have that, so they're called out explicitly. That absence
  // is the distinction PRD 18.4.1 asks for: the legs that speak are exactly the
  // ones whose reason is not already on screen.
  const context = [
    ...(segment.modeOwner.kind === 'day_start'
      ? [t('dayStartLabel'), t('segmentOrigin', { origin: originLabel })]
      : segment.destination.kind === 'daily_base'
        ? [t('returnToBaseLabel'), t('segmentDestination', { destination: destinationLabel })]
        : segment.origin.kind === 'starting_location'
          ? [t('segmentOrigin', { origin: originLabel })]
          : []),
    // A flight is not a failed lookup. Saying so is the difference between an
    // estimate Trove could not get and one it was never going to attempt.
    ...(segment.scope === 'long_distance' ? [t('segmentLongDistance')] : []),
  ].join(' · ');
  const isAvailable =
    segment.status === 'ok' && segment.durationSeconds !== null && segment.distanceMeters !== null;
  // Three things worth telling apart: a flight is not estimated by design, a
  // routing attempt that failed, and a cached estimate. A cached leg is still the
  // right leg — the cache is only reused when it was computed for this exact
  // ordering — but its numbers are as old as the day's last successful lookup, so
  // they are never dressed up as current ones.
  const metricsLabel = isAvailable
    ? t(stale ? 'segmentCachedMetrics' : 'segmentEstimateMetrics', {
        distance: formatDistanceValue(segment.distanceMeters!, distanceUnit, locale),
        duration: formatDuration(segment.durationSeconds!, locale),
        unit: t(`units.${distanceUnit}`),
      })
    : segment.status === 'not_estimated'
      ? t('segmentNotEstimatedMetrics')
      : t('segmentUnavailableMetrics');
  const presentationState = routePresentationState(segment.status, stale);

  return (
    <RouteTimelineRow
      actions={
        <Select
          disabled={saving}
          onValueChange={(value) => onModeChange(segment, value as RouteTravelMode)}
          value={segment.mode}
        >
          {/* Icon-only at every width now. The mode is spelled out one column
              over as the row's own primary label, so the trigger no longer has
              to carry the word — and no longer takes the width that used to
              come out of the leg's origin and destination. This is also the only
              place the mode is drawn: the timeline marker used to repeat it, so
              a row of connective tissue carried the same fact twice. */}
          <SelectTrigger
            aria-label={t('changeMode', { origin: originLabel })}
            className={cn('w-auto gap-1 bg-background', saving && 'opacity-70')}
            size="sm"
          >
            <SelectValue>
              <span className="inline-flex items-center">
                <TravelModeIcon mode={segment.mode} />
                <span className="sr-only">{t(`mode.${segment.mode}`)}</span>
              </span>
            </SelectValue>
          </SelectTrigger>
          {/* `alignItemWithTrigger` is Base UI's default: the popup overlays the
              trigger and grows around the selected item, and `side`/`align` are
              ignored while it is on. Against a ~36px icon trigger and a 10rem
              popup that put the menu on top of the leg row it belongs to. Off,
              the popup takes its place below the trigger with the usual
              collision handling — which is the only behaviour that fits at
              375px. The shared default stays as it is: it is the right one for
              the full-width selects in Day settings. */}
          <SelectContent align="end" alignItemWithTrigger={false}>
            {(['drive', 'transit', 'walk', 'flight'] as const).map((mode) => (
              <SelectItem key={mode} value={mode}>
                <span className="inline-flex items-center gap-2">
                  <TravelModeIcon mode={mode} />
                  {t(`mode.${mode}`)}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
      connector={connector}
      context={context || undefined}
      metrics={metricsLabel}
      modeLabel={t(`mode.${segment.mode}`)}
      state={presentationState}
      // Only a stale estimate needs saying. "Current estimate" on every healthy
      // leg was a line of noise per row; silence is what current looks like, and
      // an absent or failed estimate already says so in the metrics.
      stateLabel={presentationState === 'cached' ? t('state.cached') : undefined}
    />
  );
}
