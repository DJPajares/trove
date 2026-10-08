import type { ItineraryDay, ItineraryDayRoutes, ItineraryItem } from './api';

/**
 * What a day is called, said once. A name the traveller gave it comes first;
 * then the town it happens in; and only a day with neither is headed by its
 * date - in which case the date is the title, and is not repeated beneath it.
 */
export function dayHeading(
  day: Pick<ItineraryDay, 'name'>,
  town: string | null,
): { source: 'date' } | { source: 'name' | 'town'; title: string } {
  const name = day.name?.trim();
  if (name) return { source: 'name', title: name };
  if (town) return { source: 'town', title: town };
  return { source: 'date' };
}

export type DayTravel =
  | { kind: 'none' }
  | { kind: 'unavailable' }
  | { kind: 'long_distance_only' }
  | {
      distanceMeters: number | null;
      durationSeconds: number;
      kind: 'known';
      /** Some legs could not be measured, so these are the known part only. */
      partial: boolean;
    };

export type DayFacts = {
  /**
   * Time planned at the stops themselves, only when every stop says how long
   * it takes. A total over some of them would read as the whole day.
   */
  planned: { approximate: boolean; minutes: number } | null;
  stopCount: number;
  travel: DayTravel | null;
};

/** How long a stop is planned to take: its own times first, else its duration. */
export function plannedStopMinutes(
  item: Pick<ItineraryItem, 'durationMinutes' | 'localEndTime' | 'localStartTime'>,
) {
  if (item.localStartTime && item.localEndTime) {
    const [startHour = 0, startMinute = 0] = item.localStartTime.split(':').map(Number);
    const [endHour = 0, endMinute = 0] = item.localEndTime.split(':').map(Number);
    const span = endHour * 60 + endMinute - (startHour * 60 + startMinute);
    return span > 0 ? span : span + 24 * 60;
  }
  return item.durationMinutes && item.durationMinutes > 0 ? item.durationMinutes : null;
}

/**
 * A day in a line: how many stops, how long they are planned to take, and how
 * much travel joins them.
 *
 * Travel comes from the legs the day already has - the routes the planner
 * fetched for the day on screen - and says what it does not know: a day only
 * crossing long distance has no local travel to total, and a day whose legs
 * could only partly be measured says the total is partial. `routes` is null
 * while the legs are still on their way, which is no travel fact at all.
 */
export function dayFacts(
  day: Pick<ItineraryDay, 'items'>,
  routes: Pick<ItineraryDayRoutes, 'summary'> | null,
): DayFacts {
  const durations = day.items.map(plannedStopMinutes);
  const planned =
    day.items.length > 0 && durations.every((minutes) => minutes !== null)
      ? {
          approximate: day.items.some((item) => item.durationProvenance === 'ai_estimated'),
          minutes: durations.reduce<number>((total, minutes) => total + (minutes ?? 0), 0),
        }
      : null;

  return { planned, stopCount: day.items.length, travel: routes ? dayTravel(routes) : null };
}

function dayTravel({ summary }: Pick<ItineraryDayRoutes, 'summary'>): DayTravel {
  if (summary.totalSegmentCount === 0) return { kind: 'none' };
  if (summary.localSegmentCount === 0) return { kind: 'long_distance_only' };
  if (summary.durationSeconds === null || summary.status === 'unavailable') {
    return { kind: 'unavailable' };
  }
  return {
    distanceMeters: summary.distanceMeters,
    durationSeconds: summary.durationSeconds,
    kind: 'known',
    partial: summary.status === 'partial',
  };
}
