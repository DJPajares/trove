import type { Itinerary } from './api';

export type ScheduledPlaceUse = {
  /** ISO dates, in itinerary order, where this Place appears. */
  dayDates: string[];
  /** Day numbers, 1-based and in itinerary order, this Place already appears on. */
  dayNumbers: number[];
  itemCount: number;
  unscheduledCount: number;
};

/** Undefined means unscheduled; null means several visits cannot identify one day. */
export function placeVisitDate(
  use: ScheduledPlaceUse | undefined,
  viewedDate?: string | null,
): string | null | undefined {
  const dates = use?.dayDates ?? [];
  if (viewedDate && dates.includes(viewedDate)) return viewedDate;
  if (dates.length === 1) return dates[0];
  return dates.length > 1 ? null : undefined;
}

/**
 * Where a trip's Places have already landed in the plan. The Places drawer shows
 * this so a traveller can tell at a glance what is already accounted for, rather
 * than adding the same Place to a day twice without noticing.
 */
export function scheduledPlaceUse(itinerary: Itinerary): Record<string, ScheduledPlaceUse> {
  const uses: Record<string, ScheduledPlaceUse> = {};

  const entry = (tripPlaceId: string) => {
    uses[tripPlaceId] ??= { dayDates: [], dayNumbers: [], itemCount: 0, unscheduledCount: 0 };
    return uses[tripPlaceId];
  };

  for (const [index, day] of itinerary.days.entries()) {
    const recordDay = (tripPlaceId: string) => {
      const use = entry(tripPlaceId);
      if (!use.dayNumbers.includes(index + 1)) {
        use.dayNumbers.push(index + 1);
        use.dayDates.push(day.date);
      }
      return use;
    };
    // Explicit daily bases are scheduled visits even without a separate item.
    for (const tripPlaceId of [day.dailyBaseTripPlaceId, day.dailyBaseDepartureTripPlaceId]) {
      if (tripPlaceId) recordDay(tripPlaceId);
    }
    for (const item of day.items) {
      if (!item.tripPlace) continue;
      const use = recordDay(item.tripPlace.id);
      use.itemCount += 1;
    }
  }

  // An idea parked in Unscheduled is accounted for, but not yet on any day.
  for (const item of itinerary.unscheduledItems) {
    if (!item.tripPlace) continue;
    const use = entry(item.tripPlace.id);
    use.itemCount += 1;
    use.unscheduledCount += 1;
  }

  return uses;
}
