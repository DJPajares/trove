'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  CalendarClock,
  ChevronDown,
  CircleAlert,
  ClipboardCheck,
  MapPinned,
  Plus,
  WalletCards,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import { EditorialSection } from '@/components/editorial-section';
import { PageHeader } from '@/components/page-header';
import { PageState } from '@/components/page-state';
import { TripFeaturedCard } from '@/components/trip-featured-card';
import { TripForm } from '@/components/trip-form';
import { TripListRow } from '@/components/trip-list-row';
import { TripOverviewSheet } from '@/components/trip-overview-sheet';
import { useEditorialImages } from '@/hooks/use-editorial-images';
import { editorialSubjectKey } from '@/lib/media/editorial-images';
import { groupTripsForLibrary, PAST_TRIPS_PREVIEW_COUNT } from '@/lib/trips/lifecycle';
import { libraryEditorialSubjects, tripEditorialSubject } from '@/lib/trips/summary';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
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
import { ItemGroup } from '@/components/ui/item';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { deleteTrip, fetchTrips, type Trip } from '@/lib/trips/api';

type EditorState =
  { mode: 'closed'; trip: null } | { mode: 'create'; trip: null } | { mode: 'edit'; trip: Trip };

export function TripsManager({ planScoreEnabled }: Readonly<{ planScoreEnabled: boolean }>) {
  const t = useTranslations('trips');
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

  const groupedTrips = useMemo(() => groupTripsForLibrary(trips), [trips]);

  // One request for the whole library, in priority order and capped, however
  // many trips a traveller has. Rows read from the answer; none of them ask.
  const editorialImages = useEditorialImages(libraryEditorialSubjects(groupedTrips));
  const editorialFor = (trip: Trip) => {
    const subject = tripEditorialSubject(trip);
    return subject ? (editorialImages.get(editorialSubjectKey(subject)) ?? null) : null;
  };

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
          {groupedTrips.featured ? (
            <TripFeaturedCard
              editorial={editorialFor(groupedTrips.featured)}
              onOpenOverview={setOverviewTrip}
              trip={groupedTrips.featured}
            />
          ) : null}

          {groupedTrips.upcoming.length ? (
            <EditorialSection density="compact" title={t('sections.planning')} treatment="ruled">
              <ItemGroup aria-label={t('sections.planning')} variant="list">
                {groupedTrips.upcoming.map((trip) => (
                  <TripListRow
                    editorial={editorialFor(trip)}
                    key={trip.id}
                    onSelect={setOverviewTrip}
                    trip={trip}
                  />
                ))}
              </ItemGroup>
            </EditorialSection>
          ) : null}

          {groupedTrips.past.length ? (
            <EditorialSection density="compact" title={t('sections.completed')} treatment="ruled">
              <ItemGroup aria-label={t('sections.completed')} variant="list">
                {groupedTrips.past.slice(0, PAST_TRIPS_PREVIEW_COUNT).map((trip) => (
                  <TripListRow
                    editorial={editorialFor(trip)}
                    key={trip.id}
                    onSelect={setOverviewTrip}
                    trip={trip}
                  />
                ))}
              </ItemGroup>
              {groupedTrips.past.length > PAST_TRIPS_PREVIEW_COUNT ? (
                <Collapsible>
                  <CollapsiblePanel>
                    {/* A second list group would draw its own top rule directly
                        under the first one's bottom rule. */}
                    <ItemGroup className="border-t-0" variant="list">
                      {groupedTrips.past.slice(PAST_TRIPS_PREVIEW_COUNT).map((trip) => (
                        <TripListRow
                          editorial={editorialFor(trip)}
                          key={trip.id}
                          onSelect={setOverviewTrip}
                          trip={trip}
                        />
                      ))}
                    </ItemGroup>
                  </CollapsiblePanel>
                  <CollapsibleTrigger className="group mt-3">
                    <ChevronDown
                      aria-hidden="true"
                      className="transition-transform duration-[var(--motion-standard)] group-data-[panel-open]:rotate-180 motion-reduce:transition-none"
                    />
                    <span className="group-data-[panel-open]:hidden">
                      {t('showAllPast', { count: groupedTrips.past.length })}
                    </span>
                    <span className="hidden group-data-[panel-open]:inline">
                      {t('showFewerPast')}
                    </span>
                  </CollapsibleTrigger>
                </Collapsible>
              ) : null}
            </EditorialSection>
          ) : null}
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
