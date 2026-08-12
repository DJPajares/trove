'use client';

import Image from 'next/image';
import Link from 'next/link';
import {
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  CircleAlert,
  Info,
  MapPinned,
  Pencil,
  Plus,
  ReceiptText,
  Users,
  WalletCards,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { PageHeader } from '@/components/page-header';
import { PageState } from '@/components/page-state';
import { TripForm } from '@/components/trip-form';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { deleteTrip, fetchTrips, type Trip } from '@/lib/trips/api';
import { fetchTripInfo, type TripInfoEntry } from '@/lib/trip-info/api';
import { cn } from '@/lib/utils';

type EditorState =
  { mode: 'closed'; trip: null } | { mode: 'create'; trip: null } | { mode: 'edit'; trip: Trip };

export function TripsManager() {
  const t = useTranslations('trips');
  const locale = useLocale();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [editor, setEditor] = useState<EditorState>({ mode: 'closed', trip: null });
  const [overviewTrip, setOverviewTrip] = useState<Trip | null>(null);
  const [overviewTripInfo, setOverviewTripInfo] = useState<TripInfoEntry[]>([]);
  const [overviewTripInfoStatus, setOverviewTripInfoStatus] = useState<
    'error' | 'idle' | 'loading'
  >('idle');
  const [tripToDelete, setTripToDelete] = useState<Trip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'error' | 'idle' | 'loading'>('loading');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let active = true;

    void fetchTrips()
      .then(({ trips: nextTrips }) => {
        if (!active) return;
        setTrips(nextTrips);
        setStatus('idle');
      })
      .catch(() => {
        if (!active) return;
        setStatus('error');
      });

    return () => {
      active = false;
    };
  }, []);

  const overviewTripId = overviewTrip?.id;

  useEffect(() => {
    if (!overviewTripId) {
      setOverviewTripInfo([]);
      setOverviewTripInfoStatus('idle');
      return;
    }

    let active = true;
    setOverviewTripInfoStatus('loading');
    void fetchTripInfo(overviewTripId)
      .then(({ entries }) => {
        if (!active) return;
        setOverviewTripInfo(entries.filter((entry) => entry.isPinned));
        setOverviewTripInfoStatus('idle');
      })
      .catch(() => {
        if (!active) return;
        setOverviewTripInfoStatus('error');
      });

    return () => {
      active = false;
    };
  }, [overviewTripId]);

  function handleSaved(trip: Trip) {
    setTrips((current) => {
      const next = current.some((item) => item.id === trip.id)
        ? current.map((item) => (item.id === trip.id ? trip : item))
        : [...current, trip];
      return next.toSorted((left, right) => left.startDate.localeCompare(right.startDate));
    });
    setEditor({ mode: 'closed', trip: null });
  }

  async function handleDelete() {
    if (!tripToDelete) return;
    setDeleting(true);
    setError(null);

    try {
      await deleteTrip(tripToDelete.id);
      setTrips((current) => current.filter((trip) => trip.id !== tripToDelete.id));
      setTripToDelete(null);
      setEditor({ mode: 'closed', trip: null });
    } catch {
      setError(t('deleteError'));
    } finally {
      setDeleting(false);
    }
  }

  const dateFormatter = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  });
  const formatDate = (date: string) => dateFormatter.format(new Date(`${date}T00:00:00.000Z`));
  const groupedTrips = {
    active: trips.filter((trip) => trip.lifecycle === 'active'),
    planning: trips.filter((trip) => trip.lifecycle === 'planning'),
    completed: trips.filter((trip) => trip.lifecycle === 'completed'),
  };

  function renderTrip(trip: Trip) {
    return (
      <Item
        className="group min-h-20 flex-nowrap px-3 py-3 text-left hover:bg-muted/60"
        key={trip.id}
        render={
          <button
            aria-label={t('viewTripLabel', { name: trip.name })}
            onClick={() => setOverviewTrip(trip)}
            type="button"
          />
        }
        variant="default"
      >
        <ItemMedia
          className="size-14 rounded-[var(--radius-md)] bg-secondary text-secondary-foreground sm:size-16"
          variant={trip.coverPhotoUrl ? 'image' : 'icon'}
        >
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
            <MapPinned aria-hidden="true" className="size-5" />
          )}
        </ItemMedia>
        <ItemContent className="min-w-0 gap-1.5">
          <div className="flex min-w-0 items-baseline justify-between gap-3">
            <ItemTitle className="truncate text-base">{trip.name}</ItemTitle>
            <span
              className={cn(
                'shrink-0 text-xs font-medium',
                trip.lifecycle === 'active' ? 'text-status-success' : 'text-muted-foreground',
              )}
            >
              {t(`lifecycle.${trip.lifecycle}`)}
            </span>
          </div>
          <ItemDescription className="line-clamp-1">
            <CalendarDays aria-hidden="true" className="mr-1.5 inline size-3.5" />
            {t('dateRange', {
              endDate: formatDate(trip.endDate),
              startDate: formatDate(trip.startDate),
            })}
          </ItemDescription>
          <p className="truncate text-xs text-muted-foreground">
            {trip.destinations.length
              ? trip.destinations.map((destination) => destination.name).join(', ')
              : t('destinationOpen')}
            {trip.planningReadiness === 'ready' ? ` · ${t('ready')}` : ''}
          </p>
        </ItemContent>
      </Item>
    );
  }

  return (
    <section className="mx-auto w-full max-w-5xl space-y-8">
      <PageHeader
        actions={
          <Button onClick={() => setEditor({ mode: 'create', trip: null })}>
            <Plus aria-hidden="true" data-icon="inline-start" />
            {t('newTrip')}
          </Button>
        }
        description={t('description')}
        title={t('title')}
      />

      {error ? (
        <Alert role="alert" variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {status === 'loading' ? (
        <PageState headingLevel={2} kind="loading" title={t('loading')} />
      ) : status === 'error' ? (
        <PageState
          actions={<Button onClick={() => window.location.reload()}>{t('tryAgain')}</Button>}
          description={t('loadErrorDescription')}
          headingLevel={2}
          icon={<CircleAlert aria-hidden="true" />}
          kind="error"
          title={t('loadError')}
        />
      ) : trips.length === 0 ? (
        <PageState
          actions={
            <Button onClick={() => setEditor({ mode: 'create', trip: null })}>
              <Plus aria-hidden="true" data-icon="inline-start" />
              {t('createFirstTrip')}
            </Button>
          }
          description={t('emptyDescription')}
          headingLevel={2}
          icon={<MapPinned aria-hidden="true" />}
          kind="empty"
          title={t('emptyTitle')}
        />
      ) : (
        <div className="space-y-8">
          {(['active', 'planning', 'completed'] as const).map((lifecycle) =>
            groupedTrips[lifecycle].length ? (
              <section key={lifecycle} className="space-y-3">
                <h2 className="text-sm font-medium text-muted-foreground">
                  {t(`sections.${lifecycle}`)}
                </h2>
                <ItemGroup aria-label={t(`sections.${lifecycle}`)} variant="list">
                  {groupedTrips[lifecycle].map(renderTrip)}
                </ItemGroup>
              </section>
            ) : null,
          )}
        </div>
      )}

      <Sheet onOpenChange={(open) => !open && setOverviewTrip(null)} open={Boolean(overviewTrip)}>
        <SheetContent
          className="data-[side=right]:w-[min(42rem,calc(100%-0.5rem))]"
          closeLabel={t('close')}
        >
          {overviewTrip ? (
            <>
              <SheetHeader className="border-b">
                <SheetTitle>{overviewTrip.name}</SheetTitle>
                <SheetDescription>
                  {t('dateRange', {
                    endDate: formatDate(overviewTrip.endDate),
                    startDate: formatDate(overviewTrip.startDate),
                  })}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-6 overflow-y-auto p-5">
                <div className="flex flex-wrap gap-2">
                  <Button
                    nativeButton={false}
                    render={<Link href={`/trips/${overviewTrip.id}/itinerary`} />}
                  >
                    <CalendarClock aria-hidden="true" data-icon="inline-start" />
                    {t('continuePlanning')}
                  </Button>
                  <Button
                    nativeButton={false}
                    render={<Link href={`/trips/${overviewTrip.id}/places`} />}
                    variant="outline"
                  >
                    <MapPinned aria-hidden="true" data-icon="inline-start" />
                    {t('places')}
                  </Button>
                  <Button
                    nativeButton={false}
                    render={<Link href={`/trips/${overviewTrip.id}/tasks`} />}
                    variant="outline"
                  >
                    <ClipboardCheck aria-hidden="true" data-icon="inline-start" />
                    {t('tasks')}
                  </Button>
                  <Button
                    nativeButton={false}
                    render={<Link href={`/trips/${overviewTrip.id}/info`} />}
                    variant="outline"
                  >
                    <Info aria-hidden="true" data-icon="inline-start" />
                    {t('tripInfo')}
                  </Button>
                  <Button
                    nativeButton={false}
                    render={<Link href={`/trips/${overviewTrip.id}/reservations`} />}
                    variant="outline"
                  >
                    <ReceiptText aria-hidden="true" data-icon="inline-start" />
                    {t('reservations')}
                  </Button>
                  <Button
                    nativeButton={false}
                    render={<Link href={`/trips/${overviewTrip.id}/expenses`} />}
                    variant="outline"
                  >
                    <WalletCards aria-hidden="true" data-icon="inline-start" />
                    {t('expenses')}
                  </Button>
                  <Button
                    onClick={() => {
                      setOverviewTrip(null);
                      setEditor({ mode: 'edit', trip: overviewTrip });
                    }}
                    variant="ghost"
                  >
                    <Pencil aria-hidden="true" data-icon="inline-start" />
                    {t('editTrip')}
                  </Button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-sm font-medium">{t('destinations')}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {overviewTrip.destinations.length
                        ? overviewTrip.destinations
                            .map((destination) => destination.name)
                            .join(', ')
                        : t('destinationOpen')}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">{t('travellers')}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Users aria-hidden="true" className="size-4" />
                      {t('travellerCount', { count: overviewTrip.partySize })}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">{t('planningReadiness')}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t(`readinessState.${overviewTrip.planningReadiness}`)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">{t('startingLocation')}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {overviewTrip.startingLocation?.name ?? t('startingLocationUnavailable')}
                    </p>
                  </div>
                </div>
                {overviewTrip.notes ? (
                  <div>
                    <p className="text-sm font-medium">{t('notes')}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                      {overviewTrip.notes}
                    </p>
                  </div>
                ) : null}
                {overviewTripInfoStatus === 'loading' ? (
                  <section aria-busy="true" aria-live="polite" className="space-y-2 border-t pt-5">
                    <h2 className="text-base font-semibold">{t('tripInfo')}</h2>
                    <p className="text-sm text-muted-foreground">{t('tripInfoLoading')}</p>
                  </section>
                ) : null}
                {overviewTripInfoStatus === 'error' ? (
                  <section className="border-t pt-5">
                    <h2 className="text-base font-semibold">{t('tripInfo')}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{t('tripInfoUnavailable')}</p>
                  </section>
                ) : null}
                {overviewTripInfoStatus === 'idle' && overviewTripInfo.length ? (
                  <section className="space-y-3 border-t pt-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h2 className="text-base font-semibold">{t('tripInfo')}</h2>
                        <p className="mt-1 text-sm text-muted-foreground">{t('pinnedTripInfo')}</p>
                      </div>
                      <Button
                        nativeButton={false}
                        render={<Link href={`/trips/${overviewTrip.id}/info`} />}
                        size="sm"
                        variant="ghost"
                      >
                        {t('viewTripInfo')}
                      </Button>
                    </div>
                    <div className="space-y-3">
                      {overviewTripInfo.map((entry) => (
                        <div className="space-y-1" key={entry.id}>
                          <p className="text-sm font-medium">{entry.label}</p>
                          <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                            {entry.value}
                          </p>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <Sheet
        open={editor.mode !== 'closed'}
        onOpenChange={(open) => !open && setEditor({ mode: 'closed', trip: null })}
      >
        <SheetContent
          className="data-[side=right]:w-[min(44rem,calc(100%-0.5rem))]"
          closeLabel={t('close')}
        >
          <SheetHeader className="border-b">
            <SheetTitle>{editor.mode === 'edit' ? t('editTitle') : t('createTitle')}</SheetTitle>
            <SheetDescription>
              {editor.mode === 'edit' ? t('editDescription') : t('createDescription')}
            </SheetDescription>
            {editor.mode === 'edit' ? (
              <nav aria-label={t('tripNavigation')} className="mt-3 flex flex-wrap gap-1">
                <Button
                  className="text-muted-foreground hover:text-foreground"
                  nativeButton={false}
                  render={<Link href={`/trips/${editor.trip.id}/itinerary`} />}
                  size="sm"
                  variant="ghost"
                >
                  <CalendarClock aria-hidden="true" data-icon="inline-start" />
                  {t('itinerary')}
                </Button>
                <Button
                  className="text-muted-foreground hover:text-foreground"
                  nativeButton={false}
                  render={<Link href={`/trips/${editor.trip.id}/places`} />}
                  size="sm"
                  variant="ghost"
                >
                  <MapPinned aria-hidden="true" data-icon="inline-start" />
                  {t('places')}
                </Button>
                <Button
                  className="text-muted-foreground hover:text-foreground"
                  nativeButton={false}
                  render={<Link href={`/trips/${editor.trip.id}/tasks`} />}
                  size="sm"
                  variant="ghost"
                >
                  <ClipboardCheck aria-hidden="true" data-icon="inline-start" />
                  {t('tasks')}
                </Button>
                <Button
                  className="text-muted-foreground hover:text-foreground"
                  nativeButton={false}
                  render={<Link href={`/trips/${editor.trip.id}/expenses`} />}
                  size="sm"
                  variant="ghost"
                >
                  <WalletCards aria-hidden="true" data-icon="inline-start" />
                  {t('expenses')}
                </Button>
              </nav>
            ) : null}
          </SheetHeader>
          {editor.mode !== 'closed' ? (
            <TripForm
              key={editor.trip?.id ?? 'new'}
              onCancel={() => setEditor({ mode: 'closed', trip: null })}
              onDelete={editor.mode === 'edit' ? () => setTripToDelete(editor.trip) : undefined}
              onSaved={handleSaved}
              trip={editor.trip}
            />
          ) : null}
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={Boolean(tripToDelete)}
        onOpenChange={(open) => !open && setTripToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteDescription', { name: tripToDelete?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={() => void handleDelete()}
              variant="destructive"
            >
              {deleting ? t('deleting') : t('deleteTrip')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
