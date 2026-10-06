'use client';

import { useCallback, useState } from 'react';

import type { PlaceHoursStatus } from '@/lib/itinerary/api';
import type { ScheduledPlaceUse } from '@/lib/itinerary/places';
import type { TripPlace } from '@/lib/trip-places/api';
import { countTripPlaces, filterTripPlaces, type TripPlaceShow } from '@/lib/trip-places/list-view';
import { resolveProviderPlaceName } from '@/lib/trip-places/place-name';
import { isDaySort, sortForDay, type TripPlaceDaySort } from '@/lib/trip-places/signals';
import { sortTripPlaces } from '@/lib/trip-places/sort';

const NOTHING_KEPT: ReadonlySet<string> = new Set();

/**
 * What a list of the trip's places is showing right now: the search, the
 * "not on a day" filter and the order, all held for this visit only. Both the
 * Places page and the itinerary's drawer read the collection through this, so
 * a search behaves the same in either.
 *
 * Searching is local. It reads the names and addresses Trove already holds and
 * never asks a provider, however long the collection grows.
 */
export function useTripPlacesView(
  places: readonly TripPlace[],
  options: {
    /** Only a day can be near or open, so only the drawer passes this. */
    dayContext?: {
      distanceOf: (tripPlace: TripPlace) => number | null;
      hoursOf: (tripPlace: TripPlace) => PlaceHoursStatus['status'] | null;
    };
    nameOf: (tripPlace: TripPlace) => string;
    placeUse?: Readonly<Record<string, ScheduledPlaceUse>>;
    sorts: readonly TripPlaceDaySort[];
  },
) {
  const [query, setQueryValue] = useState('');
  const [show, setShowValue] = useState<TripPlaceShow>('all');
  const [sort, setSort] = useState<TripPlaceDaySort>('name');
  const [kept, setKept] = useState<ReadonlySet<string>>(NOTHING_KEPT);

  // A place added to a day stays in view until the traveller changes what the
  // list is showing; after that the filter means exactly what it says again.
  const setQuery = useCallback((value: string) => {
    setQueryValue(value);
    setKept(NOTHING_KEPT);
  }, []);
  const setShow = useCallback((value: TripPlaceShow) => {
    setShowValue(value);
    setKept(NOTHING_KEPT);
  }, []);
  const keepVisible = useCallback((tripPlaceId: string) => {
    setKept((current) => new Set([...current, tripPlaceId]));
  }, []);

  const { dayContext, nameOf, placeUse, sorts } = options;
  const filtered = filterTripPlaces(places, {
    fieldsOf: (tripPlace) => [
      nameOf(tripPlace),
      resolveProviderPlaceName(tripPlace),
      tripPlace.place.snapshot?.address,
      tripPlace.place.providerAddress,
      tripPlace.place.note,
      tripPlace.note,
    ],
    keep: kept,
    placeUse,
    query,
    show,
  });
  const visible =
    isDaySort(sort) && dayContext
      ? sortForDay(filtered, sort, nameOf, dayContext)
      : sortTripPlaces(filtered, isDaySort(sort) ? 'name' : sort, nameOf);

  return {
    counts: countTripPlaces(places, placeUse),
    filtering: query.trim() !== '' || show !== 'all',
    keepVisible,
    kept,
    query,
    setQuery,
    setShow,
    setSort,
    show,
    sort,
    sorts,
    visible,
  };
}

export type TripPlacesView = ReturnType<typeof useTripPlacesView>;
