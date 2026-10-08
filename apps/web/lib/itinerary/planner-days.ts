import type { TripPlanScoreDay } from '@trove/types';

import { dayNeedsAttention } from '@/lib/plan-score/attention';

import type { ItineraryDay, ItineraryTripPlace } from './api';
import { dayTown } from './day-place';

export type PlannerDay = {
  /** A verified problem on this day is worth a look; never a score of its own. */
  attention: boolean;
  date: string;
  id: string;
  isToday: boolean;
  name: string | null;
  /** One-based, in the order the trip's days run. */
  number: number;
  stopCount: number;
  town: string | null;
};

/**
 * The trip's days as the ribbon shows them: each day's number, its name and
 * town, how much is planned on it, and whether its plan has a verified problem.
 * Everything here is read from data the planner already holds - the itinerary
 * and the trip's one Plan Score - so the ribbon costs nothing to draw.
 */
export function plannerDays(input: {
  days: readonly ItineraryDay[];
  planScoreDays?: readonly TripPlanScoreDay[] | null;
  today: string | null;
  tripPlaces: readonly ItineraryTripPlace[];
}): PlannerDay[] {
  const scoreDays = new Map((input.planScoreDays ?? []).map((day) => [day.dayId, day]));

  return input.days.map((day, index) => ({
    attention: dayNeedsAttention(scoreDays.get(day.id)),
    date: day.date,
    id: day.id,
    isToday: day.date === input.today,
    name: day.name?.trim() || null,
    number: index + 1,
    stopCount: day.items.length,
    town: dayTown(day, input.tripPlaces),
  }));
}
