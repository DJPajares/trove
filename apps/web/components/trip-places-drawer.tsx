'use client';

import { Plus } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';

import { AddTripPlaceSheet } from '@/components/add-trip-place-sheet';
import { EditTripPlaceSheet } from '@/components/edit-trip-place-sheet';
import { PageState } from '@/components/page-state';
import { RemoveTripPlaceDialog } from '@/components/remove-trip-place-dialog';
import { SavedPlacesForTrip } from '@/components/saved-places-for-trip';
import { TripPlacesPanel } from '@/components/trip-places-panel';
import { TripPlacesNoMatches, TripPlacesToolbar } from '@/components/trip-places-toolbar';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
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
import { resolveTripPlaceName } from '@/lib/trip-places/place-name';
import { tripPlaceDaySorts } from '@/lib/trip-places/signals';
import { tripPlaceSorts } from '@/lib/trip-places/sort';
import { useTripPlaces } from '@/lib/trip-places/use-trip-places';
import { useTripPlacesView } from '@/lib/trip-places/use-trip-places-view';
import * as Icons from '@/lib/icons';

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
    nameOf: placeName,
    placeUse,
    sorts: dayContext ? tripPlaceDaySorts : tripPlaceSorts,
  });

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
        className="gap-0 max-md:h-[90dvh] md:data-[side=right]:w-[min(28rem,calc(100%-0.5rem))]"
        closeLabel={t('close')}
        finalFocus={finalFocus}
        side="right"
      >
        <SheetHeader>
          <SheetTitle>{t('placesDrawerTitle')}</SheetTitle>
          <SheetDescription>
            {dayContext
              ? dayContext.dayName
                ? t('planningNamedDay', {
                    date: dayDate,
                    name: dayContext.dayName,
                    number: dayContext.dayNumber,
                  })
                : t('planningDay', { date: dayDate, number: dayContext.dayNumber })
              : t('description')}
          </SheetDescription>
        </SheetHeader>

        {hasPlaces ? (
          <TripPlacesToolbar
            action={
              <Button
                className="shrink-0"
                ref={addButton}
                onClick={() => setAddQuery('')}
                type="button"
                variant="outline"
              >
                <Plus aria-hidden="true" data-icon="inline-start" />
                {t('addPlace')}
              </Button>
            }
            className="px-5 pt-4 pb-3"
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

          {places.status === 'idle' ? (
            <div className="px-5 pt-3 pb-2">
              <SavedPlacesForTrip onAdded={placeAdded} tripId={tripId} tripPlaces={places.places} />
            </div>
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
            <TripPlacesNoMatches className="px-5" onAddQuery={setAddQuery} view={view} />
          ) : null}

          {view.visible.length ? (
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
              onPriorityChange={(tripPlace, priority) =>
                void places.setPriority(tripPlace, priority)
              }
              onRemove={(place) => {
                removedId.current = place.id;
                setRemovingPlace(place);
              }}
              placeUse={placeUse}
              returnFocusToPlace={collectionFocus}
              rowClassName="px-5"
              signalsFor={signalsFor}
              tripId={tripId}
              tripPlaces={view.visible}
            />
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
