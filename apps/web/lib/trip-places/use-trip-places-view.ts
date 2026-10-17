'use client';

import { useCallback, useState } from 'react';

import type { PlaceHoursStatus } from '@/lib/itinerary/api';
import type { ScheduledPlaceUse } from '@/lib/itinerary/places';
import type { TripPlace } from '@/lib/trip-places/api';
import { countTripPlaces, filterTripPlaces, type TripPlaceShow } from '@/lib/trip-places/list-view';
import { resolveProviderPlaceName } from '@/lib/trip-places/place-name';
import { isDaySort, sortForDay, type TripPlaceDaySort } from '@/lib/trip-places/signals';
import { placeCategories } from '@/lib/trip-places/categories';
import type { TrovePlaceCategory } from '@/lib/place-categories';

/** The categories a list can be narrowed to, in the order they are offered. */
const PLACE_FILTER_CATEGORIES = [
  'stay',
  'food_and_drink',
  'things_to_do',
  'shopping',
  'transport',
  'destination',
] as const satisfies readonly TrovePlaceCategory[];
import { sortTripPlaces } from '@/lib/trip-places/sort';

const NOTHING_KEPT: ReadonlySet<string> = new Set();

/**
 * What a list of the trip's places is showing right now: the search, the
 * "not on a day" filter and the order, all held for this visit only. Every
 * contextual drawer reads the collection through this, so a search behaves
 * the same at every entry point.
 *
 * Searching is local. It reads the names and addresses Trove already holds and
 * never asks a provider, however long the collection grows.
 */
export function useTripPlacesView(
  places: readonly TripPlace[],
  options: {
    /** Only an active planner day can supply nearby and open-on-day sorts. */
    dayContext?: {
      distanceOf: (tripPlace: TripPlace) => number | null;
      hoursOf: (tripPlace: TripPlace) => PlaceHoursStatus['status'] | null;
    };
    /** Where the order starts: beside a day that is "nearest", elsewhere the name. */
    initialSort?: TripPlaceDaySort;
    nameOf: (tripPlace: TripPlace) => string;
    placeUse?: Readonly<Record<string, ScheduledPlaceUse>>;
    sorts: readonly TripPlaceDaySort[];
  },
) {
  const [query, setQueryValue] = useState('');
  const [show, setShowValue] = useState<TripPlaceShow>('all');
  const [sort, setSort] = useState<TripPlaceDaySort>(options.initialSort ?? 'name');
  const [kept, setKept] = useState<ReadonlySet<string>>(NOTHING_KEPT);
  const [category, setCategoryValue] = useState<TrovePlaceCategory | 'all'>('all');
  const setCategory = useCallback((value: TrovePlaceCategory | 'all') => {
    setCategoryValue(value);
    setKept(NOTHING_KEPT);
  }, []);
  // Only the kinds of place this trip actually holds are worth filtering by.
  const categoriesPresent: TrovePlaceCategory[] = PLACE_FILTER_CATEGORIES.filter((entry) =>
    places.some((tripPlace) => placeCategories(tripPlace).includes(entry)),
  );
  const activeCategory =
    category !== 'all' && categoriesPresent.includes(category) ? category : 'all';

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
  const activeSort = sorts.includes(sort) ? sort : 'name';
  const filtered = filterTripPlaces(
    activeCategory === 'all'
      ? places
      : places.filter(
          (tripPlace) =>
            kept.has(tripPlace.id) || placeCategories(tripPlace).includes(activeCategory),
        ),
    {
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
    },
  );
  const visible =
    isDaySort(activeSort) && dayContext
      ? sortForDay(filtered, activeSort, nameOf, dayContext)
      : sortTripPlaces(filtered, isDaySort(activeSort) ? 'name' : activeSort, nameOf);

  return {
    categoriesPresent,
    category: activeCategory,
    counts: countTripPlaces(places, placeUse),
    filtering: query.trim() !== '' || show !== 'all' || activeCategory !== 'all',
    keepVisible,
    kept,
    query,
    setCategory,
    setQuery,
    setShow,
    setSort,
    show,
    sort: activeSort,
    sorts,
    visible,
  };
}

export type TripPlacesView = ReturnType<typeof useTripPlacesView>;
