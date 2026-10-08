'use client';

import { Route } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { ItineraryDayRoutes } from '@/lib/itinerary/api';
import { formatDistanceValue } from '@/lib/itinerary/format-distance';
import { formatTravelDuration } from '@/lib/itinerary/route-format';

type RouteLoadStatus = 'error' | 'idle' | 'loading';

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
        className="flex items-center gap-3 border-b border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground sm:px-6"
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
  const hasWalkingRoute = data?.segments.some((segment) => segment.mode === 'walk') ?? false;

  return (
    <section
      aria-label={t('summaryLabel')}
      // The same minimum the loading row holds, so the summary and its
      // attribution land in a box that was already their size.
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
              value: formatTravelDuration(summary.durationSeconds, locale),
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
      <div className="flex flex-wrap items-baseline text-xs">
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
      </div>
    </section>
  );
}
