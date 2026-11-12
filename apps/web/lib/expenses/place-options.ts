import type { ExpensePlace, ExpensesResponse } from '@/lib/expenses/api';
import { placeLabel } from '@/lib/expenses/labels';

/**
 * The places an expense can link to, A to Z. A dated expense offers the places
 * planned as stops that day; an undated one, or a day with no place stops,
 * offers every trip place. The place already linked always stays in the list,
 * so editing never silently drops it.
 */
export function expensePlaceOptions(input: {
  days: ReadonlyArray<Pick<ExpensesResponse['days'][number], 'date' | 'id'>>;
  fallbackLabel: string;
  itineraryItems: ExpensesResponse['itineraryItems'];
  locale: string;
  localDate: string;
  selectedId: string;
  tripPlaces: readonly ExpensePlace[];
}): ExpensePlace[] {
  const dayId = input.localDate
    ? input.days.find((day) => day.date === input.localDate)?.id
    : undefined;
  const dayPlaceIds = new Set(
    dayId
      ? input.itineraryItems.flatMap((item) =>
          item.itineraryDayId === dayId && item.place ? [item.place.id] : [],
        )
      : [],
  );
  const places = dayPlaceIds.size
    ? input.tripPlaces.filter((place) => dayPlaceIds.has(place.id) || place.id === input.selectedId)
    : [...input.tripPlaces];
  const collator = new Intl.Collator(input.locale, { sensitivity: 'base' });
  const label = (place: ExpensePlace) => placeLabel(place, input.fallbackLabel);

  return places.toSorted((a, b) => collator.compare(label(a), label(b)));
}
