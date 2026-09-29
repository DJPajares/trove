'use client';

import {
  CalendarDays,
  ChevronDown,
  CloudRain,
  Footprints,
  Lightbulb,
  Sunset,
  Thermometer,
  Timer,
  type LucideIcon,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';

import { panelSurfaceClass, type PanelSurface } from '@/components/panel-surface';
import { SuggestedAction } from '@/components/plan-score-panel';
import { usePreferences } from '@/components/preferences-provider';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { PlanScoreExplanation } from '@/lib/plan-score/api';
import type { ScoreAction } from '@/lib/plan-score/presentation';
import type { Insight, InsightKind } from '@/lib/insights/compose';
import { cn } from '@/lib/utils';

const ICONS: Record<InsightKind, LucideIcon> = {
  rain: CloudRain,
  holiday: CalendarDays,
  daylight: Sunset,
  walking: Footprints,
  continuous: Timer,
  climate: Thermometer,
};
const OPEN_METEO = { href: 'https://open-meteo.com/', label: 'Open-Meteo' };
/** Provider-backed items link their title to the provider; advisories have none. */
const SOURCES: Partial<Record<InsightKind, { href: string; label: string }>> = {
  climate: OPEN_METEO,
  rain: OPEN_METEO,
  holiday: { href: 'https://github.com/commenthol/date-holidays', label: 'date-holidays' },
};
/** Enough to say what matters; the rest waits behind one control. */
const INITIAL_ITEMS = 3;

/** "1–3, 5" rather than "1, 2, 3, and 5": a trip's days read as ranges. */
function dayRanges(days: readonly number[]) {
  const ranges: string[] = [];
  for (let index = 0; index < days.length; index++) {
    const start = days[index]!;
    while (days[index + 1] === days[index]! + 1) index++;
    ranges.push(start === days[index] ? String(start) : `${start}–${days[index]}`);
  }
  return ranges.join(', ');
}

function InsightItem({
  insight,
  resolveAction,
  showDays,
  totalDays,
}: {
  insight: Insight;
  resolveAction?: (explanation: PlanScoreExplanation) => ScoreAction | null;
  showDays: boolean;
  totalDays: number;
}) {
  const t = useTranslations('insights');
  const format = useFormatter();
  const { preferences } = usePreferences();
  const Icon = ICONS[insight.kind];
  const unit = preferences.temperatureUnit;
  const degrees = (celsius: number) =>
    Math.round(unit === 'fahrenheit' ? (celsius * 9) / 5 + 32 : celsius);

  let title: string;
  let body: string;
  if (insight.kind === 'holiday' && insight.holiday) {
    title = insight.holiday.name;
    body = t('holiday.body', {
      date: format.dateTime(new Date(`${insight.holiday.date}T00:00:00Z`), {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
        weekday: 'short',
      }),
    });
  } else if (insight.kind === 'climate' && insight.climate) {
    const { climate } = insight;
    title = t('climate.title', {
      high: format.number(degrees(climate.temperatureMaxC), { style: 'unit', unit }),
      low: String(degrees(climate.temperatureMinC)),
      month: format.dateTime(new Date(Date.UTC(2000, climate.month - 1, 1)), {
        month: 'long',
        timeZone: 'UTC',
      }),
    });
    body = t('climate.body', { advice: climate.advice, wetDays: climate.wetDays });
  } else {
    title = t(`${insight.kind as 'rain' | 'daylight' | 'walking' | 'continuous'}.title`);
    body = t(`${insight.kind as 'rain' | 'daylight' | 'walking' | 'continuous'}.body`);
  }
  const certainty =
    insight.certainty === 'pattern' && insight.climate
      ? t('certainty.pattern', insight.climate.years)
      : t(`certainty.${insight.certainty}`);
  const source = SOURCES[insight.kind as keyof typeof SOURCES];
  // A day label only helps when the item does not already cover the whole trip.
  const days =
    showDays && insight.dayNumbers.length && insight.dayNumbers.length < totalDays
      ? t('days', { count: insight.dayNumbers.length, days: dayRanges(insight.dayNumbers) })
      : null;

  return (
    <li className="flex gap-3">
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          {source ? (
            // The title credits where the item came from, in place of a footer.
            <a
              className="rounded-sm text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              href={source.href}
              rel="noopener noreferrer"
              target="_blank"
            >
              {title}
              <span className="sr-only"> {t('opensSource', { source: source.label })}</span>
            </a>
          ) : (
            <span className="text-sm font-medium">{title}</span>
          )}
          <span className="text-xs text-muted-foreground">
            {certainty}
            {days ? (
              <>
                {' '}
                <span aria-hidden="true">·</span> {days}
              </>
            ) : null}
          </span>
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
        {insight.explanation?.action ? (
          <SuggestedAction explanation={insight.explanation} resolveAction={resolveAction} />
        ) : null}
      </div>
    </li>
  );
}

/**
 * What the traveller should know or consider about the trip or a day. Separate
 * from Plan Score by design: nothing here changes how good the plan is.
 */
export function TripInsightsPanel({
  className,
  headingLevel = 3,
  insights,
  resolveAction,
  showDays,
  surface = 'card',
  totalDays,
}: Readonly<{
  className?: string;
  headingLevel?: 2 | 3;
  insights: readonly Insight[];
  resolveAction?: (explanation: PlanScoreExplanation) => ScoreAction | null;
  /** Trip-wide views name the days an item applies to. */
  showDays: boolean;
  surface?: PanelSurface;
  totalDays: number;
}>) {
  const t = useTranslations('insights');
  const [open, setOpen] = useState(false);
  if (!insights.length) return null;
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const item = (insight: Insight) => (
    <InsightItem
      insight={insight}
      key={insight.id}
      resolveAction={resolveAction}
      showDays={showDays}
      totalDays={totalDays}
    />
  );
  const initial = insights.slice(0, INITIAL_ITEMS);
  const more = insights.slice(INITIAL_ITEMS);

  return (
    <section
      aria-label={t('title')}
      className={cn('space-y-4', panelSurfaceClass(surface), className)}
    >
      <Heading className="flex items-center gap-2 text-sm font-medium">
        <Lightbulb aria-hidden="true" className="size-4 text-muted-foreground" />
        {t('title')}
      </Heading>
      <Collapsible onOpenChange={setOpen} open={open}>
        <ul className="space-y-4">{initial.map(item)}</ul>
        {more.length ? (
          <>
            <CollapsiblePanel>
              <ul className="space-y-4 pt-4">{more.map(item)}</ul>
            </CollapsiblePanel>
            <CollapsibleTrigger className="group mt-3 text-xs">
              {open ? t('showFewer') : t('showMore', { count: more.length })}
              <ChevronDown
                aria-hidden="true"
                className="size-3 transition-transform duration-[var(--motion-standard)] group-data-panel-open:rotate-180 motion-reduce:transition-none"
              />
            </CollapsibleTrigger>
          </>
        ) : null}
      </Collapsible>
    </section>
  );
}
