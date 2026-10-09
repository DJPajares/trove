import type { Trip } from '@/lib/trips/api';
import { calendarDayDistance, getLocalDate, selectPrimaryTrip } from '@/lib/trips/lifecycle';

/** How many trips Home lists after the one it leads with. The rest live in Trips. */
export const HOME_COMING_UP_LIMIT = 3;

/**
 * How near a past trip's dates have to fall to today's for Home to call it an
 * anniversary. A week either side reads as "this week" without stretching it.
 */
const ANNIVERSARY_WINDOW_DAYS = 7;

export type HomeJourney =
  { kind: 'anniversary'; trip: Trip; years: number } | { kind: 'latest'; trip: Trip };

export type HomeMoment = {
  /** Trips still ahead after the lead, soonest first, capped. */
  comingUp: Trip[];
  /** A finished trip worth returning to, never the lead itself. */
  journey: HomeJourney | null;
  /**
   * The trip Home is about: the one under way, the next one being planned, or
   * one the traveller is just back from (PRD 9.2-9.4). Null when there is
   * nothing current, which is a state of its own rather than a gap.
   */
  lead: Trip | null;
};

/**
 * How far apart two dates sit on the calendar, ignoring the year - 28 December
 * and 2 January are five days apart, not three hundred and sixty.
 */
function dayOfYearDistance(left: string, right: string) {
  const year = left.slice(0, 4);
  const distance = Math.abs(calendarDayDistance(left, `${year}${right.slice(4)}`));

  return Math.min(distance, 365 - distance);
}

/**
 * The past trip Home offers as something to return to.
 *
 * A trip taken this week in an earlier year leads, because a date coming round
 * again is the one reason to look back that the traveller did not have to
 * think of. Otherwise it is simply the most recent finished trip. The lead is
 * never offered twice on one screen.
 */
function resolveJourney(past: Trip[], today: string, leadId: string | null): HomeJourney | null {
  const candidates = past.filter((trip) => trip.id !== leadId);
  const year = Number(today.slice(0, 4));

  const anniversary = candidates
    .filter((trip) => Number(trip.startDate.slice(0, 4)) < year)
    .map((trip) => ({ distance: dayOfYearDistance(today, trip.startDate), trip }))
    .filter((entry) => entry.distance <= ANNIVERSARY_WINDOW_DAYS)
    // The nearest date wins; between two as near, the more recent trip.
    .toSorted(
      (left, right) =>
        left.distance - right.distance || right.trip.startDate.localeCompare(left.trip.startDate),
    )[0];

  if (anniversary) {
    return {
      kind: 'anniversary',
      trip: anniversary.trip,
      years: year - Number(anniversary.trip.startDate.slice(0, 4)),
    };
  }

  const latest = candidates[0];
  return latest ? { kind: 'latest', trip: latest } : null;
}

/**
 * What Home should be about right now.
 *
 * The lead follows the traveller's own attention, exactly as before - the trip
 * they are on, then the one they are getting ready for, then one they just got
 * back from - so Home and the Trips library agree about which trip matters.
 * `today` is the traveller's own date, because an anniversary is felt where
 * they are standing, not in the zone a past trip happened in.
 */
export function resolveHomeMoment(
  trips: readonly Trip[],
  now = new Date(),
  today = getLocalDate(now, Intl.DateTimeFormat().resolvedOptions().timeZone),
): HomeMoment {
  const lead = selectPrimaryTrip([...trips], now);

  const comingUp = trips
    .filter((trip) => trip.id !== lead?.id && trip.lifecycle !== 'completed')
    .toSorted((left, right) => {
      if (left.lifecycle !== right.lifecycle) return left.lifecycle === 'active' ? -1 : 1;
      return left.startDate.localeCompare(right.startDate);
    })
    .slice(0, HOME_COMING_UP_LIMIT);

  const past = trips
    .filter((trip) => trip.lifecycle === 'completed')
    .toSorted((left, right) => right.endDate.localeCompare(left.endDate));

  return { comingUp, journey: resolveJourney(past, today, lead?.id ?? null), lead };
}
