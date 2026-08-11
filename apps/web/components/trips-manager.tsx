'use client';

import Image from 'next/image';
import Link from 'next/link';
import { CalendarClock, CalendarDays, CircleAlert, MapPinned, Plus, Trash2 } from 'lucide-react';
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
import { cn } from '@/lib/utils';

type EditorState =
  { mode: 'closed'; trip: null } | { mode: 'create'; trip: null } | { mode: 'edit'; trip: Trip };

export function TripsManager() {
  const t = useTranslations('trips');
  const locale = useLocale();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [editor, setEditor] = useState<EditorState>({ mode: 'closed', trip: null });
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
        <ItemGroup aria-label={t('tripListLabel')} variant="list">
          {trips.map((trip) => (
            <Item
              className="group min-h-20 flex-nowrap px-3 py-3 text-left hover:bg-muted/60"
              key={trip.id}
              render={
                <button
                  aria-label={t('editTripLabel', { name: trip.name })}
                  onClick={() => setEditor({ mode: 'edit', trip })}
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
                    ? trip.destinations.map((destination) => destination.name).join(' · ')
                    : t('destinationOpen')}
                  {trip.planningReadiness === 'ready' ? ` · ${t('ready')}` : ''}
                </p>
              </ItemContent>
            </Item>
          ))}
        </ItemGroup>
      )}

      <Sheet
        open={editor.mode !== 'closed'}
        onOpenChange={(open) => !open && setEditor({ mode: 'closed', trip: null })}
      >
        <SheetContent
          className="data-[side=right]:w-[min(44rem,calc(100%-0.5rem))]"
          closeLabel={t('close')}
        >
          <SheetHeader className="border-b">
            <div className="flex items-start justify-between gap-4 pr-8">
              <div>
                <SheetTitle>
                  {editor.mode === 'edit' ? t('editTitle') : t('createTitle')}
                </SheetTitle>
                <SheetDescription>
                  {editor.mode === 'edit' ? t('editDescription') : t('createDescription')}
                </SheetDescription>
              </div>
              {editor.mode === 'edit' ? (
                <div className="flex items-center gap-1">
                  <Button
                    nativeButton={false}
                    render={<Link href={`/trips/${editor.trip.id}/itinerary`} />}
                    size="sm"
                    variant="outline"
                  >
                    <CalendarClock aria-hidden="true" data-icon="inline-start" />
                    {t('itinerary')}
                  </Button>
                  <Button
                    nativeButton={false}
                    render={<Link href={`/trips/${editor.trip.id}/places`} />}
                    size="sm"
                    variant="outline"
                  >
                    <MapPinned aria-hidden="true" data-icon="inline-start" />
                    {t('places')}
                  </Button>
                  <Button
                    aria-label={t('deleteTripLabel', { name: editor.trip.name })}
                    onClick={() => setTripToDelete(editor.trip)}
                    size="icon-sm"
                    type="button"
                    variant="destructive"
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              ) : null}
            </div>
          </SheetHeader>
          {editor.mode !== 'closed' ? (
            <TripForm
              key={editor.trip?.id ?? 'new'}
              onCancel={() => setEditor({ mode: 'closed', trip: null })}
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
