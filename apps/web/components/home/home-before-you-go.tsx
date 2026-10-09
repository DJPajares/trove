'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronRight, CircleCheck, CloudDownload } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';

import { usePreferences } from '@/components/preferences-provider';
import { Button } from '@/components/ui/button';
import { OFFLINE_NUDGE_DAYS, selectNextSteps, type HomeNextStep } from '@/lib/home/next-steps';
import { getOfflineTripReadiness, readTripSnapshot } from '@/lib/offline/trip-store';
import { getOfflineAuthContext } from '@/lib/offline/trip-sync';
import { queryKeys } from '@/lib/query/keys';
import { fetchTasks } from '@/lib/tasks/api';
import type { Trip } from '@/lib/trips/api';
import { formatTripDate } from '@/lib/trips/format';
import { daysUntilTripStart } from '@/lib/trips/lifecycle';
import { useTripReadiness } from '@/lib/trips/use-trip-readiness';
import { weatherConditionIcon, weatherConditionKey } from '@/lib/weather/conditions';
import { tripWeatherForDate, useTripWeather } from '@/lib/weather/use-trip-weather';
import * as Icons from '@/lib/icons';

/**
 * The provider forecasts about sixteen days out. Asking sooner than that can
 * only come back empty, so Home does not ask.
 */
const FORECAST_REACH_DAYS = 15;

/**
 * Whether this device holds a complete offline copy of the trip - read only in
 * the last few days before departure, the only time Home would mention it.
 */
function useOfflineReady(tripId: string, relevant: boolean) {
  const [ready, setReady] = useState<boolean | null>(null);

  useEffect(() => {
    if (!relevant) return;
    let cancelled = false;
    void (async () => {
      try {
        const { userId } = await getOfflineAuthContext();
        const snapshot = await readTripSnapshot(userId, tripId);
        if (!cancelled) setReady(getOfflineTripReadiness(snapshot).state === 'ready');
      } catch {
        if (!cancelled) setReady(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [relevant, tripId]);

  return relevant ? ready : null;
}

function StepRow({
  action,
  description,
  href,
  icon: Icon,
  title,
}: Readonly<{
  action?: ReactNode;
  description?: ReactNode;
  href?: string;
  icon: ComponentType<{ className?: string }>;
  title: ReactNode;
}>) {
  const body = (
    <>
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-tint text-brand">
        <Icon aria-hidden="true" className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        {description ? (
          <span className="mt-0.5 line-clamp-2 text-[length:var(--text-metadata)] leading-5 text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
    </>
  );

  if (href) {
    return (
      <Link
        className="group -mx-2 flex items-center gap-3 rounded-[var(--radius-lg)] px-2 py-3 outline-none transition-colors duration-[var(--motion-standard)] hover:bg-surface-hover focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none"
        href={href}
      >
        {body}
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-text-subtle transition-transform duration-[var(--motion-standard)] group-hover:translate-x-0.5 motion-reduce:transition-none"
        />
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3 py-3">
      {body}
      {action}
    </div>
  );
}

function Step({ step, trip }: Readonly<{ step: HomeNextStep; trip: Trip }>) {
  const t = useTranslations('home.beforeYouGo');
  const readinessT = useTranslations('trips.readinessPrompt');
  const weatherT = useTranslations('tripMode.views.weather');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const { failedTripId, pendingTripId, setReadiness } = useTripReadiness();
  const base = `/trips/${trip.id}`;

  switch (step.kind) {
    case 'readiness':
      return (
        <StepRow
          action={
            <Button
              className="shrink-0"
              disabled={pendingTripId === trip.id}
              onClick={() => void setReadiness(trip, 'ready')}
              size="sm"
              variant="outline"
            >
              {readinessT('action')}
            </Button>
          }
          description={
            failedTripId === trip.id
              ? readinessT('error')
              : step.prompt === 'suggest'
                ? readinessT('suggest')
                : readinessT('nudge', { count: daysUntilTripStart(trip) })
          }
          icon={CircleCheck}
          title={t('readiness')}
        />
      );
    case 'offline':
      return (
        <StepRow
          description={t('offlineDescription')}
          href={base}
          icon={CloudDownload}
          title={t('offline')}
        />
      );
    case 'openDays':
      return (
        <StepRow
          description={t('openDaysDescription')}
          href={`${base}/itinerary`}
          icon={Icons.Itinerary}
          title={t('openDays', { open: step.open, total: step.total })}
        />
      );
    case 'tasks':
      return (
        <StepRow
          description={
            step.next.dueDate
              ? t('nextTaskDue', {
                  date: formatTripDate(step.next.dueDate, locale),
                  label: step.next.label,
                })
              : t('nextTask', { label: step.next.label })
          }
          href={`${base}/tasks`}
          icon={Icons.Tasks}
          title={t('tasks', { count: step.count })}
        />
      );
    case 'weather': {
      const unit = weatherT(`unit.${preferences.temperatureUnit}`);
      const temperature = (value: number) => `${Math.round(value)}${unit}`;
      return (
        <StepRow
          description={t('weatherDescription', {
            high: temperature(step.day.temperatureMax),
            low: temperature(step.day.temperatureMin),
          })}
          href={base}
          icon={weatherConditionIcon(step.day.weatherCode)}
          title={t('weather', {
            condition: weatherT(`condition.${weatherConditionKey(step.day.weatherCode)}`),
          })}
        />
      );
    }
  }
}

/**
 * For a trip still being planned: the few things it asks of the traveller
 * next (`selectNextSteps`), each a sentence that opens where it is done. The
 * readiness question is answered in place; everything else is a door.
 *
 * Every source is the trip's own and costs no provider call worth worrying
 * about: tasks are Trove's, the first day's forecast is the free weather
 * provider the trip already uses - asked only once it can answer - and the
 * offline copy is read from this device.
 */
export function HomeBeforeYouGo({ trip }: Readonly<{ trip: Trip }>) {
  const t = useTranslations('home.beforeYouGo');
  const days = daysUntilTripStart(trip);
  const tasksQuery = useQuery({
    queryFn: () => fetchTasks(trip.id),
    queryKey: queryKeys.tasks(trip.id),
  });
  const weatherQuery = useTripWeather(trip.id, { enabled: days <= FORECAST_REACH_DAYS });
  const offlineReady = useOfflineReady(trip.id, days <= OFFLINE_NUDGE_DAYS);

  const steps = selectNextSteps({
    offlineReady,
    tasks: tasksQuery.data?.tasks ?? null,
    trip,
    weather: tripWeatherForDate(weatherQuery.data, trip.startDate),
  });

  return (
    <section
      aria-labelledby="home-before-heading"
      className="flex flex-col rounded-[var(--radius-2xl)] border border-border-subtle bg-card p-5 shadow-[var(--shadow-card)] sm:p-6"
      data-slot="home-before-you-go"
    >
      <h2
        className="text-[length:var(--text-section-title)] leading-[1.18] font-semibold tracking-[-0.022em] text-foreground"
        id="home-before-heading"
      >
        {t('title')}
      </h2>

      {/* A forecast is worth knowing but asks nothing, so a trip whose list
          holds only that is still a trip with nothing left to do. */}
      {steps.every((step) => step.kind === 'weather') ? (
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{t('allSet')}</p>
      ) : null}
      {steps.length ? (
        <ul className="mt-3 divide-y divide-border-subtle">
          {steps.map((step) => (
            <li key={step.kind}>
              <Step step={step} trip={trip} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
