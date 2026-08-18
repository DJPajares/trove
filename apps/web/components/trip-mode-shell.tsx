'use client';

import { ArrowLeft, CalendarDays, Clock3, Compass, Eye, Map, MapPinned } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { DatePicker } from '@/components/date-picker';
import { PageState } from '@/components/page-state';
import { TimeInput } from '@/components/time-input';
import { PlanScorePanel } from '@/components/plan-score-panel';
import { TripSyncStatus } from '@/components/trip-sync-status';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { fetchItinerary, type TripModeContextRequestOptions } from '@/lib/itinerary/api';
import { useTripPlanScore } from '@/lib/plan-score/use-trip-plan-score';
import { fetchTrip, type Trip } from '@/lib/trips/api';
import { cn } from '@/lib/utils';

type PreviewSelection = { date: string; time: string };

type TripModePreviewContextValue = {
  contextOptions: (signal?: AbortSignal) => TripModeContextRequestOptions;
  isPreview: boolean;
  previewSelection: PreviewSelection | null;
  withPreviewHref: (href: string) => string;
};

const TripModePreviewContext = createContext<TripModePreviewContextValue>({
  contextOptions: (signal) => ({ signal }),
  isPreview: false,
  previewSelection: null,
  withPreviewHref: (href) => href,
});

function TripModePreviewProvider({
  children,
  value,
}: Readonly<{ children: ReactNode; value: TripModePreviewContextValue }>) {
  return (
    <TripModePreviewContext.Provider value={value}>{children}</TripModePreviewContext.Provider>
  );
}

export function useTripModePreview() {
  return useContext(TripModePreviewContext);
}

type TripModeShellProps = {
  children: ReactNode;
  tripId: string;
};

type LoadState =
  | { status: 'error'; trip: null }
  | { status: 'idle'; trip: Trip }
  | { status: 'loading'; trip: null };

const tripModeViews = [
  { icon: Clock3, key: 'now', path: '' },
  { icon: CalendarDays, key: 'today', path: '/today' },
  { icon: Map, key: 'map', path: '/map' },
  { icon: MapPinned, key: 'trip', path: '/trip' },
] as const;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function addPreviewParams(href: string, date: string, time: string) {
  const hashIndex = href.indexOf('#');
  const pathAndQuery = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const hash = hashIndex >= 0 ? href.slice(hashIndex + 1) : '';
  const queryIndex = pathAndQuery.indexOf('?');
  const path = queryIndex >= 0 ? pathAndQuery.slice(0, queryIndex) : pathAndQuery;
  const query = queryIndex >= 0 ? pathAndQuery.slice(queryIndex + 1) : '';
  const params = new URLSearchParams(query);
  params.set('preview', '1');
  params.set('date', date);
  params.set('time', time);
  return `${path}?${params.toString()}${hash ? `#${hash}` : ''}`;
}

export function TripModeShell({ children, tripId }: Readonly<TripModeShellProps>) {
  const t = useTranslations('tripMode');
  const planScoreTranslations = useTranslations('planScore');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<LoadState>({ status: 'loading', trip: null });

  useEffect(() => {
    let active = true;
    setState({ status: 'loading', trip: null });

    void Promise.all([fetchTrip(tripId), fetchItinerary(tripId)])
      .then(([{ trip }]) => {
        if (active) setState({ status: 'idle', trip });
      })
      .catch(() => {
        if (active) setState({ status: 'error', trip: null });
      });

    return () => {
      active = false;
    };
  }, [reloadKey, tripId]);

  const isPreview = searchParams.get('preview') === '1';
  const requestedDate = searchParams.get('date');
  const requestedTime = searchParams.get('time');
  const previewDate =
    state.trip &&
    requestedDate &&
    DATE_PATTERN.test(requestedDate) &&
    requestedDate >= state.trip.startDate &&
    requestedDate <= state.trip.endDate
      ? requestedDate
      : (state.trip?.startDate ?? '');
  const previewTime = requestedTime && TIME_PATTERN.test(requestedTime) ? requestedTime : '09:00';
  const previewSelection = useMemo(
    () => (isPreview && previewDate ? { date: previewDate, time: previewTime } : null),
    [isPreview, previewDate, previewTime],
  );
  const contextOptions = useCallback<TripModePreviewContextValue['contextOptions']>(
    (signal) =>
      previewSelection
        ? { date: previewSelection.date, languageCode: locale, signal, time: previewSelection.time }
        : { languageCode: locale, signal },
    [locale, previewSelection],
  );
  const withPreviewHref = useCallback<TripModePreviewContextValue['withPreviewHref']>(
    (href) =>
      previewSelection
        ? addPreviewParams(href, previewSelection.date, previewSelection.time)
        : href,
    [previewSelection],
  );
  const planScore = useTripPlanScore(
    previewSelection && state.trip ? state.trip.id : null,
    state.trip?.updatedAt ?? '',
  );
  const previewDayScore =
    planScore.data?.days.find((day) => day.date === previewSelection?.date) ?? null;
  const previewContext = useMemo<TripModePreviewContextValue>(
    () => ({
      contextOptions,
      isPreview: Boolean(previewSelection),
      previewSelection,
      withPreviewHref,
    }),
    [contextOptions, previewSelection, withPreviewHref],
  );

  useEffect(() => {
    if (state.status !== 'idle' || !navigator.onLine) return;
    const basePath = `/trips/${state.trip.id}/mode`;
    for (const { path } of tripModeViews) router.prefetch(`${basePath}${path}`);
  }, [router, state]);

  function updatePreview(next: { date?: string; time?: string }) {
    if (!previewSelection) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('preview', '1');
    params.set('date', next.date ?? previewSelection.date);
    params.set('time', next.time ?? previewSelection.time);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  if (state.status === 'loading') {
    return (
      <section className="mx-auto w-full max-w-6xl">
        <PageState kind="loading" title={t('loading')} />
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section className="mx-auto w-full max-w-6xl">
        <PageState
          actions={
            <>
              <Button onClick={() => setReloadKey((value) => value + 1)}>{t('tryAgain')}</Button>
              <Button nativeButton={false} render={<Link href="/trips" />} variant="outline">
                {t('backToTrips')}
              </Button>
            </>
          }
          description={t('loadErrorDescription')}
          icon={<Compass aria-hidden="true" />}
          kind="error"
          title={t('loadError')}
        />
      </section>
    );
  }

  const { trip } = state;
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  });
  const formatDate = (date: string) => dateFormatter.format(new Date(`${date}T00:00:00.000Z`));

  if (trip.lifecycle !== 'active' && !(previewSelection && trip.lifecycle === 'planning')) {
    return (
      <section className="mx-auto w-full max-w-6xl">
        <PageState
          actions={
            <>
              <Button nativeButton={false} render={<Link href="/trips" />}>
                {t('backToTrips')}
              </Button>
              <Button
                nativeButton={false}
                render={<Link href={`/trips/${trip.id}/itinerary`} />}
                variant="outline"
              >
                {t('openPlanning')}
              </Button>
            </>
          }
          description={t('unavailableDescription', {
            endDate: formatDate(trip.endDate),
            startDate: formatDate(trip.startDate),
            timeZone: trip.referenceTimeZone,
          })}
          icon={<CalendarDays aria-hidden="true" />}
          kind="empty"
          title={t('unavailableTitle')}
        />
      </section>
    );
  }

  const basePath = `/trips/${trip.id}/mode`;

  return (
    <TripModePreviewProvider value={previewContext}>
      <section className="mx-auto w-full max-w-6xl space-y-6" data-slot="trip-mode-shell">
        <header className="space-y-5">
          <Button
            className="-ml-2 text-muted-foreground hover:text-foreground"
            nativeButton={false}
            render={<Link href="/trips" />}
            size="sm"
            variant="ghost"
          >
            <ArrowLeft aria-hidden="true" data-icon="inline-start" />
            {t('exit')}
          </Button>

          <div className="flex items-start gap-4 sm:items-center">
            <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-lg)] bg-secondary text-secondary-foreground shadow-[var(--shadow-control)] sm:size-16">
              {trip.coverPhotoUrl ? (
                <Image
                  alt=""
                  className="size-full object-cover"
                  height={64}
                  src={trip.coverPhotoUrl}
                  unoptimized
                  width={64}
                />
              ) : (
                <MapPinned aria-hidden="true" className="size-6" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-brand">
                {previewSelection ? t('preview.label') : t('label')}
              </p>
              <h1 className="mt-1 break-words text-2xl leading-tight font-semibold tracking-[-0.02em] text-foreground sm:text-3xl">
                {trip.name}
              </h1>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {t('dateRange', {
                  endDate: formatDate(trip.endDate),
                  startDate: formatDate(trip.startDate),
                })}
              </p>
            </div>
            <Button
              className="hidden sm:inline-flex"
              nativeButton={false}
              render={<Link href={`/trips/${trip.id}/itinerary`} />}
              variant="outline"
            >
              {t('openPlanning')}
            </Button>
          </div>
        </header>

        {previewSelection ? (
          <section
            aria-labelledby="trip-mode-preview-heading"
            className="grid gap-5 border-y border-status-info/35 bg-status-info/8 px-4 py-5 sm:px-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end"
          >
            <div className="flex items-start gap-3">
              <Eye aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-status-info" />
              <div>
                <h2 className="font-semibold text-foreground" id="trip-mode-preview-heading">
                  {t('preview.title')}
                </h2>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                  {t('preview.description')}
                </p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-[minmax(12rem,1fr)_minmax(10rem,auto)]">
              <Field>
                <FieldLabel htmlFor="trip-mode-preview-date">{t('preview.date')}</FieldLabel>
                <DatePicker
                  id="trip-mode-preview-date"
                  label={t('preview.date')}
                  max={trip.endDate}
                  min={trip.startDate}
                  onChange={(date) => date && updatePreview({ date })}
                  required
                  value={previewSelection.date}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="trip-mode-preview-time">{t('preview.time')}</FieldLabel>
                <TimeInput
                  id="trip-mode-preview-time"
                  onValueChange={(time) => time && updatePreview({ time })}
                  required
                  value={previewSelection.time}
                />
                <FieldDescription>{t('preview.timeDescription')}</FieldDescription>
              </Field>
            </div>
          </section>
        ) : null}

        {previewSelection ? (
          <PlanScorePanel
            completeness={previewDayScore?.completeness ?? null}
            confidence={previewDayScore?.confidence ?? null}
            disabled={previewDayScore?.withheldReasons.includes('ADMINISTRATIVELY_DISABLED')}
            explanations={
              previewDayScore?.explanations ?? {
                uncertainty: [],
                whatWorks: [],
                worthImproving: [],
              }
            }
            factors={previewDayScore?.factors}
            onRetry={planScore.retry}
            score={previewDayScore?.score ?? null}
            scope="day"
            status={planScore.status}
            title={planScoreTranslations('dayTitle')}
          />
        ) : null}

        <TripSyncStatus tripId={trip.id} />

        <nav
          aria-label={t('navigation')}
          className="sticky top-[4.75rem] z-[calc(var(--layer-sticky)-1)] -mx-1 rounded-[var(--radius-lg)] border border-border bg-background/95 p-1 shadow-[var(--shadow-control)] backdrop-blur supports-[backdrop-filter]:bg-background/88"
          data-translucent-surface
        >
          <ul className="grid grid-cols-4 gap-1">
            {tripModeViews.map(({ icon: Icon, key, path }) => {
              const href = `${basePath}${path}`;
              const active = pathname === href;

              return (
                <li key={key}>
                  <Link
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex min-h-12 items-center justify-center gap-1.5 rounded-[var(--radius-md)] px-2 py-2 text-xs font-medium outline-none transition-colors duration-[var(--motion-standard)] focus-visible:ring-3 focus-visible:ring-ring/40 sm:text-sm',
                      active
                        ? 'bg-secondary text-secondary-foreground'
                        : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
                    )}
                    href={withPreviewHref(href)}
                  >
                    <Icon aria-hidden="true" className="size-4" />
                    <span>{t(`views.${key}.label`)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-h-[min(32rem,55dvh)] border-t border-border pt-8">{children}</div>
      </section>
    </TripModePreviewProvider>
  );
}
