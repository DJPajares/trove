import { sameTown, type TripOverviewDay } from '@trove/types';

export type TripJourneyStop = {
  town: string;
  days: TripOverviewDay[];
  firstNumber: number;
  lastNumber: number;
  startDate: string;
  endDate: string;
  /** Days here with nothing planned yet. */
  openDays: number;
};

/**
 * The journey as places rather than dates: consecutive days in one town are
 * one stop. A day the planner cannot place - no stay, stops that scatter -
 * stays with the stop it sits in, so a quiet day never splits a town in two.
 *
 * Returns nothing when no day can be placed at all, so the caller falls back to
 * the trip's destinations instead of inventing a route.
 */
export function tripJourneyStops(days: readonly TripOverviewDay[]): TripJourneyStop[] {
  const groups: { town: string; days: TripOverviewDay[] }[] = [];
  const leading: TripOverviewDay[] = [];

  for (const day of days) {
    const current = groups.at(-1);
    if (!day.town) {
      if (current) current.days.push(day);
      else leading.push(day);
    } else if (current && sameTown(current.town, day.town)) {
      current.days.push(day);
    } else {
      groups.push({ town: day.town, days: [day] });
    }
  }
  groups[0]?.days.unshift(...leading);

  return groups.flatMap(({ town, days: stopDays }) => {
    const first = stopDays[0];
    const last = stopDays.at(-1);
    if (!first || !last) return [];
    return [
      {
        town,
        days: stopDays,
        firstNumber: first.number,
        lastNumber: last.number,
        startDate: first.date,
        endDate: last.date,
        openDays: stopDays.filter((day) => day.stopCount === 0).length,
      },
    ];
  });
}
