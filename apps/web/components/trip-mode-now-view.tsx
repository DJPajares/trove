'use client';

import {
  ArrowRight,
  CalendarDays,
  CarFront,
  Clock3,
  Compass,
  ExternalLink,
  Footprints,
  MapPin,
  Route,
  TramFront,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { PageState } from '@/components/page-state';
import { usePreferences } from '@/components/preferences-provider';
import { useTripModePreview } from '@/components/trip-mode-shell';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  fetchTripModeContext,
  type ItineraryItem,
  type RouteTravelMode,
  type TripModeContext,
} from '@/lib/itinerary/api';
import {
  cacheProviderPlaceDetails,
  getCachedProviderPlaceDetails,
  getProviderPlaceDetails,
  type ProviderPlaceDetails,
} from '@/lib/saved/api';

type LoadState =
  | { context: null; status: 'error' }
  | { context: null; status: 'loading' }
  | { context: TripModeContext; status: 'ready' };

function providerId(item: ItineraryItem | null) {
  return item?.tripPlace?.place.providerRefs.find((ref) => ref.provider === 'google')
    ?.externalPlaceId;
}

function itemName(item: ItineraryItem, details: ProviderPlaceDetails | null, fallback: string) {
  return item.customLabel ?? item.tripPlace?.place.name ?? details?.name ?? fallback;
}

function itemLocation(item: ItineraryItem, details: ProviderPlaceDetails | null) {
  return item.customLocation?.label ?? details?.formattedAddress ?? null;
}

function directionsHref(item: ItineraryItem, name: string) {
  const externalPlaceId = providerId(item);
  const location = item.tripPlace?.place.location;
  if (!externalPlaceId && !location) return null;

  const destination = location ? `${location.latitude},${location.longitude}` : name;
  const query = new URLSearchParams({ api: '1', destination });
  if (externalPlaceId) query.set('destination_place_id', externalPlaceId);
  return `https://www.google.com/maps/dir/?${query.toString()}`;
}

function travelIcon(mode: RouteTravelMode): ReactNode {
  if (mode === 'walk') return <Footprints aria-hidden="true" />;
  if (mode === 'transit') return <TramFront aria-hidden="true" />;
  return <CarFront aria-hidden="true" />;
}

function TripModeNowSkeleton({ label }: Readonly<{ label: string }>) {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-6" role="status">
      <span className="sr-only">{label}</span>
      <div className="space-y-3">
        <Skeleton className="h-9 w-36" />
        <Skeleton className="h-5 w-56" />
      </div>
      <Skeleton className="h-24 w-full rounded-[var(--radius-lg)]" />
      <Skeleton className="h-80 w-full rounded-[var(--radius-xl)]" />
    </div>
  );
}

export function TripModeNowView({ tripId }: Readonly<{ tripId: string }>) {
  const t = useTranslations('tripMode.views.now');
  const locale = useLocale();
  const { preferences } = usePreferences();
  const { contextOptions, isPreview, withPreviewHref } = useTripModePreview();
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<LoadState>({ context: null, status: 'loading' });
  const [details, setDetails] = useState<Record<string, ProviderPlaceDetails>>({});

  useEffect(() => {
    const controller = new AbortController();
    setState({ context: null, status: 'loading' });
    setDetails({});
    void fetchTripModeContext(tripId, contextOptions(controller.signal))
      .then((context) => setState({ context, status: 'ready' }))
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setState({ context: null, status: 'error' });
        }
      });
    return () => controller.abort();
  }, [contextOptions, reloadKey, tripId]);

  const context = state.context;
  const currentItem = useMemo(
    () => context?.day?.items.find((item) => item.id === context.currentOrRelevant?.itemId) ?? null,
    [context],
  );
  const nextItem = useMemo(
    () => context?.day?.items.find((item) => item.id === context.nextItemId) ?? null,
    [context],
  );

  useEffect(() => {
    let active = true;
    const ids = [providerId(currentItem), providerId(nextItem)].filter((value): value is string =>
      Boolean(value),
    );
    for (const id of new Set(ids)) {
      const cached = getCachedProviderPlaceDetails(id);
      if (cached) {
        setDetails((current) => ({ ...current, [id]: cached }));
        continue;
      }
      void getProviderPlaceDetails(id)
        .then((result) => {
          if (!active || result.status !== 'ok' || !result.place) return;
          cacheProviderPlaceDetails(id, result.place);
          setDetails((current) => ({ ...current, [id]: result.place! }));
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, [currentItem, nextItem]);

  const getDetails = useCallback(
    (item: ItineraryItem | null) => {
      const id = providerId(item);
      return id ? (details[id] ?? null) : null;
    },
    [details],
  );

  if (state.status === 'loading') return <TripModeNowSkeleton label={t('loading')} />;

  if (state.status === 'error') {
    return (
      <PageState
        actions={
          <>
            <Button onClick={() => setReloadKey((value) => value + 1)}>{t('tryAgain')}</Button>
            <Button
              nativeButton={false}
              render={<Link href={withPreviewHref(`/trips/${tripId}/mode/today`)} />}
              variant="outline"
            >
              {t('openToday')}
            </Button>
          </>
        }
        description={t('loadErrorDescription')}
        headingLevel={2}
        icon={<Compass aria-hidden="true" />}
        kind="error"
        title={t('loadError')}
      />
    );
  }

  const { context: readyContext } = state;
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: 'full',
    timeZone: 'UTC',
  }).format(new Date(`${readyContext.selectedDate}T00:00:00.000Z`));
  const timeFormat = (value: string, timeZone: string) =>
    new Intl.DateTimeFormat(locale, {
      hour: 'numeric',
      hour12: preferences.timeFormat === '12h',
      minute: '2-digit',
      timeZone,
    }).format(new Date(value));
  const formatSchedule = (item: ItineraryItem) => {
    if (item.startInstant) {
      return timeFormat(
        item.startInstant,
        item.timeZone ?? readyContext.day?.defaultTimeZone ?? readyContext.trip.referenceTimeZone,
      );
    }
    if (item.dayPart) return t(`dayPart.${item.dayPart}`);
    return t('scheduleFlexible');
  };
  const formatDuration = (seconds: number) => {
    const minutes = Math.max(1, Math.round(seconds / 60));
    if (minutes < 60) {
      return new Intl.NumberFormat(locale, {
        style: 'unit',
        unit: 'minute',
        unitDisplay: 'short',
      }).format(minutes);
    }
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    const hourText = new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: 'hour',
      unitDisplay: 'short',
    }).format(hours);
    const minuteText = new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: 'minute',
      unitDisplay: 'short',
    }).format(remainder);
    return remainder ? `${hourText} ${minuteText}` : hourText;
  };
  const formatDistance = (meters: number) => {
    const value = preferences.distanceUnit === 'mi' ? meters / 1609.344 : meters / 1000;
    const amount = new Intl.NumberFormat(locale, {
      maximumFractionDigits: value < 10 ? 1 : 0,
    }).format(value);
    return t('distance', { unit: t(`unit.${preferences.distanceUnit}`), value: amount });
  };
  const currentDetails = getDetails(currentItem);
  const nextDetails = getDetails(nextItem);
  const nextName = nextItem ? itemName(nextItem, nextDetails, t('placeFallback')) : null;
  const route =
    readyContext.leaveBy?.destinationItemId === nextItem?.id ? readyContext.leaveBy : null;
  const directions = nextItem && nextName ? directionsHref(nextItem, nextName) : null;

  return (
    <div className="space-y-7">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-brand">
            {t(isPreview ? 'previewEyebrow' : 'eyebrow')}
          </p>
          <h2 className="mt-1 text-3xl font-semibold tracking-[-0.025em] text-foreground sm:text-4xl">
            {t('title')}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{date}</p>
        </div>
        <Button
          nativeButton={false}
          render={<Link href={withPreviewHref(`/trips/${tripId}/mode/today`)} />}
          variant="outline"
        >
          <CalendarDays aria-hidden="true" data-icon="inline-start" />
          {t('openToday')}
        </Button>
      </header>

      {currentItem && readyContext.currentOrRelevant ? (
        <section
          aria-labelledby="trip-mode-current-heading"
          className="flex items-start gap-3 border-y border-border py-4"
        >
          <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-secondary text-secondary-foreground">
            <MapPin aria-hidden="true" className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              {t(`currentKind.${readyContext.currentOrRelevant.kind}`)}
            </p>
            <h3
              className="mt-1 text-base font-semibold text-foreground"
              id="trip-mode-current-heading"
            >
              {itemName(currentItem, currentDetails, t('placeFallback'))}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">{formatSchedule(currentItem)}</p>
            {itemLocation(currentItem, currentDetails) ? (
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {itemLocation(currentItem, currentDetails)}
              </p>
            ) : null}
            <p className="mt-2 text-xs leading-5 text-text-subtle">{t('locationDisclaimer')}</p>
          </div>
        </section>
      ) : null}

      {readyContext.state === 'free_time' ? (
        <div className="flex items-start gap-3 rounded-[var(--radius-lg)] bg-secondary/65 px-4 py-4">
          <Clock3 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand" />
          <div>
            <p className="font-medium text-foreground">{t('freeTimeTitle')}</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {t('freeTimeDescription')}
            </p>
          </div>
        </div>
      ) : null}

      {nextItem && nextName ? (
        <section
          aria-labelledby="trip-mode-next-heading"
          className="rounded-[var(--radius-xl)] border border-border bg-card p-5 shadow-[var(--shadow-surface)] sm:p-7"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-brand">
            <ArrowRight aria-hidden="true" className="size-4" />
            {t('nextLabel')}
          </div>
          <div className="mt-4 grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
            <div className="min-w-0">
              <h3
                className="text-2xl leading-tight font-semibold tracking-[-0.02em] text-foreground sm:text-3xl"
                id="trip-mode-next-heading"
              >
                {nextName}
              </h3>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <Clock3 aria-hidden="true" className="size-4" />
                  {formatSchedule(nextItem)}
                </span>
                {itemLocation(nextItem, nextDetails) ? (
                  <span className="inline-flex items-start gap-2">
                    <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    {itemLocation(nextItem, nextDetails)}
                  </span>
                ) : null}
              </div>
            </div>

            {route ? (
              <div className="md:min-w-48 md:border-l md:border-border md:pl-6">
                <p className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                  {t('leaveByLabel')}
                </p>
                <p className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-foreground tabular-nums">
                  {timeFormat(
                    route.at,
                    nextItem.timeZone ??
                      readyContext.day?.defaultTimeZone ??
                      readyContext.trip.referenceTimeZone,
                  )}
                </p>
              </div>
            ) : null}
          </div>

          {route ? (
            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-4 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <span className="[&_svg]:size-4">{travelIcon(route.mode)}</span>
                {t('travelEstimate', {
                  duration: formatDuration(route.routeDurationSeconds),
                  mode: t(`travelMode.${route.mode}`),
                })}
              </span>
              {route.distanceMeters !== null ? (
                <span>{formatDistance(route.distanceMeters)}</span>
              ) : null}
              {route.provider === 'google' ? (
                <span className="w-full text-xs text-text-subtle">{t('googleAttribution')}</span>
              ) : null}
            </div>
          ) : (
            <p className="mt-6 border-t border-border pt-4 text-sm leading-6 text-muted-foreground">
              {nextItem.startInstant ? t('routeUnavailable') : t('timingFlexible')}
            </p>
          )}

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            <Button
              className="sm:w-auto"
              nativeButton={false}
              render={<Link href={withPreviewHref(`/trips/${tripId}/mode/today`)} />}
              variant="outline"
            >
              {t('openToday')}
            </Button>
            {directions ? (
              <Button
                className="sm:w-auto"
                nativeButton={false}
                render={
                  <a
                    aria-label={t('directionsExternal')}
                    href={directions}
                    rel="noreferrer"
                    target="_blank"
                  />
                }
              >
                <Route aria-hidden="true" data-icon="inline-start" />
                {t('directions')}
                <ExternalLink aria-hidden="true" data-icon="inline-end" />
              </Button>
            ) : null}
          </div>
        </section>
      ) : (
        <PageState
          actions={
            <Button
              nativeButton={false}
              render={<Link href={withPreviewHref(`/trips/${tripId}/mode/today`)} />}
            >
              {t('openToday')}
            </Button>
          }
          className="py-4"
          description={
            readyContext.state === 'no_day'
              ? t('noDayDescription', { date })
              : t('noNextDescription')
          }
          headingLevel={2}
          icon={<Clock3 aria-hidden="true" />}
          title={readyContext.state === 'no_day' ? t('noDayTitle') : t('noNextTitle')}
        />
      )}
    </div>
  );
}
