'use client';

import { ChevronDown, Plus, Search } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';

import { AddTripPlaceSheet } from '@/components/add-trip-place-sheet';
import { EditTripPlaceSheet } from '@/components/edit-trip-place-sheet';
import { PageState } from '@/components/page-state';
import { RemoveTripPlaceDialog } from '@/components/remove-trip-place-dialog';
import { SavedPlacesForTrip } from '@/components/saved-places-for-trip';
import { TripPlacesPanel } from '@/components/trip-places-panel';
import {
  TripPlacesNoMatches,
  TripPlacesToolbar,
  type TripPlacesLens,
} from '@/components/trip-places-toolbar';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
import { journalSerif } from '@/components/memories/journal-font';
import { Sheet, SheetContent, SheetHeading } from '@/components/ui/sheet';
import { useTripPlaceSignals } from '@/hooks/use-trip-place-signals';
import { fetchItinerary, type Itinerary } from '@/lib/itinerary/api';
import {
  mergeItineraryTripPlace,
  scheduledPlaceUse,
  type ScheduledPlaceUse,
} from '@/lib/itinerary/places';
import { queryKeys } from '@/lib/query/keys';
import { useTripResource } from '@/lib/query/use-trip-resource';
import { invalidateTripQueries } from '@/lib/query/trip-invalidation';
import type { Coordinate } from '@/lib/maps/haversine';
import type { TripPlace } from '@/lib/trip-places/api';
import { groupTripPlacesForDay } from '@/lib/trip-places/list-view';
import { resolveTripPlaceName } from '@/lib/trip-places/place-name';
import { tripPlaceDaySorts } from '@/lib/trip-places/signals';
import { tripPlaceSorts } from '@/lib/trip-places/sort';
import { useTripPlaces } from '@/lib/trip-places/use-trip-places';
import { useTripPlacesView } from '@/lib/trip-places/use-trip-places-view';
import * as Icons from '@/lib/icons';
import { cn } from '@/lib/utils';

export type TripPlacesDayContext = {
  /** The located stops (and base) of the day being planned, for "nearest to this day". */
  anchors: readonly Coordinate[];
  /** The day being planned, `YYYY-MM-DD`, so each place can say whether it is open then. */
  date: string;
  /** Optional custom name for the day currently being planned. */
  dayName: string | null;
  /** 1-based number of the day currently being planned. */
  dayNumber: number;
  onAddToDay: (tripPlace: TripPlace) => Promise<boolean>;
  placeUse: Record<string, ScheduledPlaceUse>;
};

type TripPlacesDrawerProps = {
  dayContext: TripPlacesDayContext | null;
  finalFocus: () => HTMLElement | boolean;
  onOpenChange: (open: boolean) => void;
  onOpenChangeComplete: (open: boolean) => void;
  open: boolean;
  tripId: string;
};

const NOTHING_ADDING: ReadonlySet<string> = new Set();

/**
 * One contextual collection, mounted on demand. A live planner day can supply
 * add actions; other screens retain collection management and scheduled-use hints.
 * Search, filter and order stay pinned while the collection scrolls.
 */
export function TripPlacesDrawer({
  dayContext,
  finalFocus,
  onOpenChange,
  onOpenChangeComplete,
  open,
  tripId,
}: Readonly<TripPlacesDrawerProps>) {
  const locale = useLocale();
  const t = useTranslations('tripPlaces');
  const places = useTripPlaces(tripId);
  const addButton = useRef<HTMLButtonElement | null>(null);
  const editedId = useRef<string | null>(null);
  const removedId = useRef<string | null>(null);
  function collectionFocus(id: string | null) {
    return (
      (id ? document.querySelector<HTMLElement>(`[data-trip-place-id="${id}"] button`) : null) ??
      addButton.current ??
      true
    );
  }
  const queryClient = useQueryClient();
  const { data: itinerary } = useTripResource(queryKeys.itinerary(tripId), () =>
    fetchItinerary(tripId, { cachedOnly: true }),
  );
  const placeUse = useMemo(
    () => dayContext?.placeUse ?? (itinerary ? scheduledPlaceUse(itinerary) : undefined),
    [dayContext?.placeUse, itinerary],
  );
  const date = dayContext?.date;
  const [editPlace, setEditPlace] = useState<TripPlace | null>(null);
  const [removingPlace, setRemovingPlace] = useState<TripPlace | null>(null);
  const [addingIds, setAddingIds] = useState<ReadonlySet<string>>(NOTHING_ADDING);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [addFailed, setAddFailed] = useState(false);
  /** What the Add sheet opens with: null while it is closed, a search when one is carried over. */
  const [addQuery, setAddQuery] = useState<string | null>(null);
  const { distanceOf, hoursOf, signalsFor } = useTripPlaceSignals(tripId, {
    anchors: dayContext?.anchors,
    date,
  });

  const placeName = (tripPlace: TripPlace) =>
    resolveTripPlaceName(tripPlace, {
      custom: t('customPlace'),
      provider: t('providerPlace'),
    });

  const view = useTripPlacesView(places.places, {
    dayContext: dayContext ? { distanceOf, hoursOf } : undefined,
    initialSort: dayContext ? 'nearest' : 'name',
    nameOf: placeName,
    placeUse,
    sorts: dayContext ? tripPlaceDaySorts : tripPlaceSorts,
  });
  // What the list is for right now. Beside a day it opens on that day; the
  // lens maps onto the view's own filter, so search and order still apply.
  const [lens, setLensValue] = useState<TripPlacesLens>(dayContext ? 'day' : 'all');
  const activeLens = lens === 'day' && !dayContext ? 'all' : lens;
  function setLens(next: TripPlacesLens) {
    setLensValue(next);
    view.setShow(next === 'unplanned' ? 'unplanned' : 'all');
  }
  const searching = view.query.trim() !== '';
  const dayGroups =
    activeLens === 'day' && dayContext && !searching
      ? groupTripPlacesForDay(view.visible, { date: dayContext.date, distanceOf, placeUse })
      : null;

  const dayDate = useMemo(
    () =>
      date
        ? new Intl.DateTimeFormat(locale, {
            day: 'numeric',
            month: 'short',
            timeZone: 'UTC',
            weekday: 'short',
          }).format(new Date(`${date}T00:00:00Z`))
        : '',
    [date, locale],
  );

  async function addToDay(tripPlace: TripPlace) {
    if (!dayContext) return;
    const { dayName, dayNumber, onAddToDay } = dayContext;
    setAddingIds((current) => new Set([...current, tripPlace.id]));
    setFeedback(null);
    setAddFailed(false);
    // Kept in view before the day updates, so under "not on a day" the row does
    // not disappear the moment it stops being true.
    view.keepVisible(tripPlace.id);
    const added = await onAddToDay(tripPlace);
    if (added) {
      setFeedback(
        dayName
          ? t('addedToNamedDay', { name: dayName, number: dayNumber })
          : t('addedToDay', { number: dayNumber }),
      );
    } else {
      setAddFailed(true);
    }
    setAddingIds((current) => new Set([...current].filter((id) => id !== tripPlace.id)));
  }

  function placeAdded(tripPlace: TripPlace) {
    places.setPlaces((current) =>
      current.some((entry) => entry.id === tripPlace.id) ? current : [...current, tripPlace],
    );
    queryClient.setQueryData<Itinerary>(queryKeys.itinerary(tripId), (current) =>
      current ? mergeItineraryTripPlace(current, tripPlace) : current,
    );
    void invalidateTripQueries(queryClient, tripId, ['trip-overview', 'plan-score']);
  }

  const hasPlaces = places.status === 'idle' && places.places.length > 0;

  /** The one list, shared by every group the drawer shows. */
  const panel = (tripPlaces: readonly TripPlace[], rowClassName = 'px-5') => (
    <TripPlacesPanel
      busyPlaceIds={addingIds}
      day={dayContext ? { date: dayContext.date, number: dayContext.dayNumber } : undefined}
      justAddedIds={view.kept}
      onAddToDay={dayContext ? (tripPlace) => void addToDay(tripPlace) : undefined}
      onEditPlace={(place) => {
        editedId.current = place.id;
        setEditPlace(place);
      }}
      onPlaceLocated={places.placeLocated}
      onCategoriesChange={(tripPlace, categories) =>
        void places.setCategories(tripPlace, categories)
      }
      onPriorityChange={(tripPlace, priority) => void places.setPriority(tripPlace, priority)}
      onRemove={(place) => {
        removedId.current = place.id;
        setRemovingPlace(place);
      }}
      placeUse={placeUse}
      returnFocusToPlace={collectionFocus}
      rowClassName={rowClassName}
      signalsFor={signalsFor}
      tripId={tripId}
      tripPlaces={tripPlaces}
    />
  );
  const errorMessage = addFailed
    ? t('addToDayError')
    : places.error && !removingPlace
      ? t(places.error.key, places.error.values)
      : null;

  return (
    <Sheet onOpenChange={onOpenChange} onOpenChangeComplete={onOpenChangeComplete} open={open}>
      {/* Pinned to its full height on a phone, so a search or filter narrowing
            the list never pulls the sheet down under the traveller's thumb. */}
      <SheetContent
        className={cn(
          journalSerif.variable,
          'gap-0 bg-background max-md:h-[90dvh] md:data-[side=right]:w-[min(28rem,calc(100%-0.5rem))]',
        )}
        closeLabel={t('close')}
        finalFocus={finalFocus}
        side="right"
      >
        <SheetHeading
          description={
            hasPlaces
              ? t('collectionSummary', {
                  planned: view.counts.all - view.counts.unplanned,
                  total: view.counts.all,
                })
              : t('description')
          }
          title={t('placesDrawerTitle')}
        >
          {dayContext ? (
            // The day the drawer is working for, said once and plainly, so
            // every + below reads as "add to this day".
            <p className="mt-2 flex min-h-10 items-center gap-2.5 rounded-full bg-score-media-background px-4 text-sm text-score-media-foreground">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full bg-score-media-brand"
              />
              <span className="min-w-0 truncate">
                <span className="font-semibold">
                  {t('planningDayShort', { number: dayContext.dayNumber })}
                </span>
                <span className="text-score-media-muted">
                  {' · '}
                  {dayContext.dayName ?? dayDate}
                </span>
              </span>
            </p>
          ) : null}
        </SheetHeading>

        {hasPlaces ? (
          <TripPlacesToolbar
            action={
              <Button
                aria-label={t('addPlace')}
                className="shrink-0 rounded-full"
                ref={addButton}
                onClick={() => setAddQuery('')}
                size="icon"
                type="button"
                variant="outline"
              >
                <Plus aria-hidden="true" />
              </Button>
            }
            className="px-5 pt-4 pb-3"
            dayNumber={dayContext?.dayNumber}
            lens={activeLens}
            onLensChange={setLens}
            view={view}
          />
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-5">
          <p aria-live="polite" className="sr-only" role="status">
            {feedback}
          </p>

          {errorMessage ? (
            <Alert className="mx-5 mb-3 w-auto" role="alert" variant="destructive">
              <Icons.Error aria-hidden="true" />
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}

          {places.status === 'loading' ? (
            <PageState className="px-5" kind="loading" loadingShape="list" title={t('loading')} />
          ) : null}

          {places.status === 'error' ? (
            <PageState
              actions={<Button onClick={() => void places.refresh()}>{t('tryAgain')}</Button>}
              className="px-5"
              description={t('loadErrorDescription')}
              headingLevel={2}
              icon={<Icons.Error aria-hidden="true" />}
              kind="error"
              title={t('loadError')}
            />
          ) : null}

          {places.status === 'idle' && !places.places.length ? (
            <PageState
              actions={
                <Button ref={addButton} onClick={() => setAddQuery('')} type="button">
                  <Plus aria-hidden="true" data-icon="inline-start" />
                  {t('addFirstPlace')}
                </Button>
              }
              className="px-5"
              description={t('emptyDescription')}
              headingLevel={2}
              icon={<Icons.Places aria-hidden="true" />}
              kind="empty"
              title={t('emptyTitle')}
            />
          ) : null}

          {hasPlaces && !view.visible.length ? (
            <TripPlacesNoMatches
              className="px-5"
              onAddQuery={setAddQuery}
              onShowAll={activeLens === 'all' ? undefined : () => setLens('all')}
              view={view}
            />
          ) : null}

          {dayGroups && dayContext ? (
            <div className="space-y-4">
              {dayGroups.onThisDay.length ? (
                // Already planned for this day: worth knowing, not worth the
                // space. One line, opened on request.
                <Collapsible className="mx-5 rounded-[var(--radius-lg)] border border-dashed border-border-strong">
                  <CollapsibleTrigger className="group/on flex min-h-11 w-full gap-2.5 px-3.5 text-left text-sm text-foreground hover:text-foreground">
                    <Icons.Success aria-hidden="true" className="text-brand" />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-semibold">
                        {t('alreadyOnDay', {
                          count: dayGroups.onThisDay.length,
                          number: dayContext.dayNumber,
                        })}
                      </span>
                      <span className="text-muted-foreground">
                        {' · '}
                        {dayGroups.onThisDay.map(placeName).join(', ')}
                      </span>
                    </span>
                    <ChevronDown
                      aria-hidden="true"
                      className="transition-transform duration-[var(--motion-standard)] group-data-[panel-open]/on:rotate-180 motion-reduce:transition-none"
                    />
                  </CollapsibleTrigger>
                  <CollapsiblePanel>{panel(dayGroups.onThisDay, 'px-3.5')}</CollapsiblePanel>
                </Collapsible>
              ) : null}
              {dayGroups.near.length ? (
                <section aria-labelledby="trip-places-near">
                  <h3
                    className="px-5 pb-1 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase"
                    id="trip-places-near"
                  >
                    {t('nearDay', { number: dayContext.dayNumber })}
                  </h3>
                  {panel(dayGroups.near)}
                </section>
              ) : null}
              {dayGroups.far.length ? (
                <section aria-labelledby="trip-places-far">
                  <h3
                    className="px-5 pb-1 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase"
                    id="trip-places-far"
                  >
                    {t('furtherFromDay', { number: dayContext.dayNumber })}
                  </h3>
                  {panel(dayGroups.far)}
                </section>
              ) : null}
            </div>
          ) : view.visible.length ? (
            panel(view.visible)
          ) : null}

          {/* A search here only reads the trip. The rest of the world is one
              tap further, carrying what was typed. */}
          {searching && view.visible.length ? (
            <div className="px-5 pt-3">
              <Button
                className="h-auto min-h-12 w-full justify-start gap-3 rounded-[var(--radius-lg)] border-dashed px-4 py-2 text-left whitespace-normal"
                onClick={() => setAddQuery(view.query.trim())}
                type="button"
                variant="outline"
              >
                <Search aria-hidden="true" className="text-brand" />
                {t('searchBeyondTrip', { query: view.query.trim() })}
              </Button>
            </div>
          ) : null}

          {places.status === 'idle' ? (
            <div className="px-5 pt-5">
              <SavedPlacesForTrip onAdded={placeAdded} tripId={tripId} tripPlaces={places.places} />
            </div>
          ) : null}
        </div>
      </SheetContent>

      {addQuery !== null ? (
        <AddTripPlaceSheet
          finalFocus={() => collectionFocus(null)}
          initialQuery={addQuery}
          onAdded={placeAdded}
          onOpenChange={(open) => !open && setAddQuery(null)}
          tripId={tripId}
          tripPlaces={places.places}
        />
      ) : null}

      <EditTripPlaceSheet
        finalFocus={() => collectionFocus(editedId.current)}
        onOpenChange={(open) => !open && setEditPlace(null)}
        onRefresh={places.refresh}
        onSave={places.savePlace}
        tripPlace={editPlace}
      />

      <RemoveTripPlaceDialog
        finalFocus={() => collectionFocus(removedId.current)}
        error={places.error}
        nameOf={placeName}
        onClose={() => {
          setRemovingPlace(null);
          places.clearError();
        }}
        onRemove={places.remove}
        placeUse={placeUse}
        tripPlace={removingPlace}
      />
    </Sheet>
  );
}
