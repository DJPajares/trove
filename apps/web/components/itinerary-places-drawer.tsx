'use client';

import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { AddTripPlaceSheet } from '@/components/add-trip-place-sheet';
import { EditTripPlaceSheet } from '@/components/edit-trip-place-sheet';
import { PageState } from '@/components/page-state';
import { RemoveTripPlaceDialog } from '@/components/remove-trip-place-dialog';
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
import type { ScheduledPlaceUse } from '@/lib/itinerary/places';
import type { Coordinate } from '@/lib/maps/haversine';
import type { TripPlace } from '@/lib/trip-places/api';
import { resolveTripPlaceName } from '@/lib/trip-places/place-name';
import { tripPlaceDaySorts } from '@/lib/trip-places/signals';
import { useTripPlaces } from '@/lib/trip-places/use-trip-places';
import { useTripPlacesView } from '@/lib/trip-places/use-trip-places-view';
import * as Icons from '@/lib/icons';

type ItineraryPlacesDrawerProps = {
  /** The located stops (and base) of the day being planned, for "nearest to this day". */
  anchors: readonly Coordinate[];
  /** The day being planned, `YYYY-MM-DD`, so each place can say whether it is open then. */
  date: string;
  /** Optional custom name for the day currently being planned. */
  dayName: string | null;
  /** 1-based number of the day currently being planned. */
  dayNumber: number;
  onAddToDay: (tripPlace: TripPlace) => Promise<boolean>;
  onTripPlaceAdded: (tripPlace: TripPlace) => void;
  onOpenChange: (open: boolean) => void;
  placeUse: Record<string, ScheduledPlaceUse>;
  tripId: string;
};

const NOTHING_ADDING: ReadonlySet<string> = new Set();

/**
 * The trip's Places, beside the day being planned rather than a page away. Mounted
 * only while open, so the itinerary does not pay for a collection nobody asked to see.
 *
 * It says which day it is planning, because that is the day every row's add
 * button means; the search, filter and order sit above the list and stay put
 * while it scrolls.
 */
export function ItineraryPlacesDrawer({
  anchors,
  date,
  dayName,
  dayNumber,
  onAddToDay,
  onOpenChange,
  onTripPlaceAdded,
  placeUse,
  tripId,
}: Readonly<ItineraryPlacesDrawerProps>) {
  const locale = useLocale();
  const t = useTranslations('tripPlaces');
  const places = useTripPlaces(tripId);
  const [editPlace, setEditPlace] = useState<TripPlace | null>(null);
  const [removingPlace, setRemovingPlace] = useState<TripPlace | null>(null);
  const [addingIds, setAddingIds] = useState<ReadonlySet<string>>(NOTHING_ADDING);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [addFailed, setAddFailed] = useState(false);
  /** What the Add sheet opens with: null while it is closed, a search when one is carried over. */
  const [addQuery, setAddQuery] = useState<string | null>(null);
  const { distanceOf, hoursOf, signalsFor } = useTripPlaceSignals(tripId, { anchors, date });

  const placeName = (tripPlace: TripPlace) =>
    resolveTripPlaceName(tripPlace, {
      custom: t('customPlace'),
      provider: t('providerPlace'),
    });

  const view = useTripPlacesView(places.places, {
    dayContext: { distanceOf, hoursOf },
    nameOf: placeName,
    placeUse,
    sorts: tripPlaceDaySorts,
  });

  const dayDate = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
        weekday: 'short',
      }).format(new Date(`${date}T00:00:00Z`)),
    [date, locale],
  );

  async function addToDay(tripPlace: TripPlace) {
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

  const hasPlaces = places.status === 'idle' && places.places.length > 0;
  const errorMessage = addFailed
    ? t('addToDayError')
    : places.error && !removingPlace
      ? t(places.error.key, places.error.values)
      : null;

  return (
    <>
      <Sheet onOpenChange={onOpenChange} open>
        {/* Pinned to its full height on a phone, so a search or filter narrowing
            the list never pulls the sheet down under the traveller's thumb. */}
        <SheetContent
          className="gap-0 max-md:h-[90dvh] md:data-[side=right]:w-[min(28rem,calc(100%-0.5rem))]"
          closeLabel={t('close')}
          side="right"
        >
          <SheetHeader>
            <SheetTitle>{t('placesDrawerTitle')}</SheetTitle>
            <SheetDescription>
              {dayName
                ? t('planningNamedDay', { date: dayDate, name: dayName, number: dayNumber })
                : t('planningDay', { date: dayDate, number: dayNumber })}
            </SheetDescription>
          </SheetHeader>

          {hasPlaces ? (
            <TripPlacesToolbar
              action={
                <Button
                  className="shrink-0"
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

            {places.status === 'idle' && !places.places.length ? (
              <PageState
                actions={
                  <Button onClick={() => setAddQuery('')} type="button">
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
                day={{ date, number: dayNumber }}
                justAddedIds={view.kept}
                onAddToDay={(tripPlace) => void addToDay(tripPlace)}
                onEditPlace={setEditPlace}
                onPlaceLocated={places.placeLocated}
                onPriorityChange={(tripPlace, priority) =>
                  void places.setPriority(tripPlace, priority)
                }
                onRemove={setRemovingPlace}
                placeUse={placeUse}
                rowClassName="px-5"
                signalsFor={signalsFor}
                tripId={tripId}
                tripPlaces={view.visible}
              />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      {addQuery !== null ? (
        <AddTripPlaceSheet
          initialQuery={addQuery}
          onAdded={(tripPlace) => {
            places.setPlaces((current) =>
              current.some((entry) => entry.id === tripPlace.id)
                ? current
                : [...current, tripPlace],
            );
            onTripPlaceAdded(tripPlace);
          }}
          onOpenChange={(open) => !open && setAddQuery(null)}
          tripId={tripId}
          tripPlaces={places.places}
        />
      ) : null}

      <EditTripPlaceSheet
        onOpenChange={(open) => !open && setEditPlace(null)}
        onRefresh={places.refresh}
        onSave={places.savePlace}
        tripPlace={editPlace}
      />

      <RemoveTripPlaceDialog
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
    </>
  );
}
