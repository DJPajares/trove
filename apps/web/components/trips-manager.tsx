'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  CalendarClock,
  CalendarDays,
  CircleAlert,
  ClipboardCheck,
  MapPinned,
  Plus,
  WalletCards,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { EditorialSection } from '@/components/editorial-section';
import { PageHeader } from '@/components/page-header';
import { PageState } from '@/components/page-state';
import { MediaAttribution } from '@/components/media-attribution';
import { TripForm } from '@/components/trip-form';
import { TripMedia } from '@/components/trip-media';
import { TripOverviewSheet } from '@/components/trip-overview-sheet';
import { useEditorialImages } from '@/hooks/use-editorial-images';
import { editorialSubjectKey, type EditorialSubject } from '@/lib/media/editorial-images';
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
import { resolveTripMediaSource } from '@/lib/media/trip-media';
import { cn } from '@/lib/utils';

type EditorState =
  { mode: 'closed'; trip: null } | { mode: 'create'; trip: null } | { mode: 'edit'; trip: Trip };

export function TripsManager({ planScoreEnabled }: Readonly<{ planScoreEnabled: boolean }>) {
  const t = useTranslations('trips');
  const mediaTranslations = useTranslations('media');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const shouldCreateTrip = searchParams.get('create') === '1';
  const [trips, setTrips] = useState<Trip[]>([]);
  const [editor, setEditor] = useState<EditorState>({ mode: 'closed', trip: null });
  const [overviewTrip, setOverviewTrip] = useState<Trip | null>(null);
  const [tripToDelete, setTripToDelete] = useState<Trip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'error' | 'idle' | 'loading'>('loading');
  const [deleting, setDeleting] = useState(false);

  // Only trips without a cover of their own ask for a photograph, and each asks
  // by destination rather than by trip name, so "Spring in Kyoto" resolves to
  // Kyoto and two travellers naming the same city share one cached answer.
  const editorialSubjects: EditorialSubject[] = trips
    .filter((trip) => !trip.coverPhotoUrl)
    .map((trip) => ({
      category: 'destination' as const,
      name: trip.destinations[0]?.name ?? trip.name,
      tripId: trip.id,
    }));
  const editorialImages = useEditorialImages(editorialSubjects);

  useEffect(() => {
    if (!shouldCreateTrip) return;
    setEditor((current) => (current.mode === 'closed' ? { mode: 'create', trip: null } : current));
    router.replace(pathname, { scroll: false });
  }, [pathname, router, shouldCreateTrip]);

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
  const groupedTrips = {
    active: trips.filter((trip) => trip.lifecycle === 'active'),
    planning: trips.filter((trip) => trip.lifecycle === 'planning'),
    completed: trips.filter((trip) => trip.lifecycle === 'completed'),
  };

  function renderTrip(trip: Trip) {
    const editorial = trip.coverPhotoUrl
      ? null
      : editorialImages.get(
          editorialSubjectKey({
            category: 'destination',
            name: trip.destinations[0]?.name ?? trip.name,
          }),
        );

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
        <ItemMedia className="size-14 rounded-[var(--radius-md)] sm:size-16" variant="default">
          <TripMedia
            alt={
              editorial
                ? mediaTranslations('alt.tripEditorial', {
                    name: trip.destinations[0]?.name ?? trip.name,
                  })
                : ''
            }
            className="size-full"
            // A thumbnail this size cannot carry a legible credit, so the row
            // renders it below instead.
            credit="inline"
            sizes="64px"
            source={resolveTripMediaSource({ coverUrl: trip.coverPhotoUrl, editorial })}
            variant="thumbnail"
          />
        </ItemMedia>
        <ItemContent className="min-w-0 gap-1.5">
          <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
            <ItemTitle className="line-clamp-2 max-w-full text-base sm:line-clamp-1">
              {trip.name}
            </ItemTitle>
            <span
              className={cn(
                'shrink-0 text-xs font-medium',
                trip.lifecycle === 'active' ? 'text-status-success' : 'text-muted-foreground',
              )}
            >
              {t(`lifecycle.${trip.lifecycle}`)}
            </span>
          </div>
          <ItemDescription className="line-clamp-2 sm:line-clamp-1">
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
          {editorial ? (
            <MediaAttribution
              attribution={editorial.attribution}
              // The row is a button, so the credit cannot be a link here.
              className="truncate"
              linked={false}
              variant="inline"
            />
          ) : null}
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
        <PageState
          headingLevel={2}
          kind="loading"
          loadingShape="list"
          scope="section"
          title={t('loading')}
        />
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
              <EditorialSection
                density="compact"
                key={lifecycle}
                title={t(`sections.${lifecycle}`)}
                treatment={lifecycle === 'active' ? 'tinted' : 'ruled'}
              >
                <ItemGroup aria-label={t(`sections.${lifecycle}`)} variant="list">
                  {groupedTrips[lifecycle].map(renderTrip)}
                </ItemGroup>
              </EditorialSection>
            ) : null,
          )}
        </div>
      )}

      <TripOverviewSheet
        onEdit={(trip) => {
          setOverviewTrip(null);
          setEditor({ mode: 'edit', trip });
        }}
        onOpenChange={(open) => !open && setOverviewTrip(null)}
        planScoreEnabled={planScoreEnabled}
        trip={overviewTrip}
      />

      <Sheet
        open={editor.mode !== 'closed'}
        onOpenChange={(open) => !open && setEditor({ mode: 'closed', trip: null })}
      >
        <SheetContent
          className="w-full md:data-[side=right]:w-[min(44rem,calc(100%-0.5rem))]"
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
