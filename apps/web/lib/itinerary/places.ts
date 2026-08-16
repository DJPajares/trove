import type { Itinerary } from './api';

export type ScheduledPlaceUse = {
  /** Day numbers, 1-based and in itinerary order, this Place already appears on. */
  dayNumbers: number[];
  itemCount: number;
  unscheduledCount: number;
};

/**
 * Where a trip's Places have already landed in the plan. The Places drawer shows
 * this so a traveller can tell at a glance what is already accounted for, rather
 * than adding the same Place to a day twice without noticing.
 */
export function scheduledPlaceUse(itinerary: Itinerary): Record<string, ScheduledPlaceUse> {
  const uses: Record<string, ScheduledPlaceUse> = {};

  const entry = (tripPlaceId: string) => {
    uses[tripPlaceId] ??= { dayNumbers: [], itemCount: 0, unscheduledCount: 0 };
    return uses[tripPlaceId];
  };

  for (const [index, day] of itinerary.days.entries()) {
    for (const item of day.items) {
      if (!item.tripPlace) continue;
      const use = entry(item.tripPlace.id);
      use.itemCount += 1;
      // A Place visited twice in one day is still one day on the plan.
      if (!use.dayNumbers.includes(index + 1)) use.dayNumbers.push(index + 1);
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
