import type { TrovePlaceCategory } from '@/lib/place-categories';

type Categorised = {
  categories?: TrovePlaceCategory[];
  place: { categories?: TrovePlaceCategory[]; snapshot?: { category: TrovePlaceCategory } | null };
};

/**
 * Everything a Trip Place is. A Place cached before categories existed still
 * says what its snapshot did, so nothing falls out of a list while the newer
 * answer is on its way.
 */
export function placeCategories(tripPlace: Categorised): TrovePlaceCategory[] {
  return (
    tripPlace.categories ??
    tripPlace.place.categories ??
    (tripPlace.place.snapshot ? [tripPlace.place.snapshot.category] : ['other'])
  );
}

/** Somewhere to sleep: what the Stay picker offers. */
export function isAccommodation(tripPlace: Categorised) {
  return placeCategories(tripPlace).includes('stay');
}

/**
 * The places a Stay can be set to: those that are somewhere to stay, plus any
 * already chosen - a Stay saved before categories existed never disappears
 * from its own picker.
 */
export function stayOptions<T extends Categorised & { id: string }>(
  tripPlaces: readonly T[],
  selectedIds: ReadonlyArray<string | null | undefined>,
): T[] {
  const selected = new Set(selectedIds.filter(Boolean));
  return tripPlaces.filter((tripPlace) => isAccommodation(tripPlace) || selected.has(tripPlace.id));
}
