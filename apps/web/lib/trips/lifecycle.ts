import type { Trip } from './api';

/**
 * How long after a trip ends it still counts as the traveller's current
 * concern. PRD section 9.4 gives Home a "recently completed" state; this is
 * the window that state covers.
 */
const RECENTLY_COMPLETED_DAYS = 30;

/**
 * How much of the archive the library shows before offering the rest.
 *
 * Four rows is one comfortable section: enough that a traveller sees the trips
 * they most recently took, few enough that where they have been never
 * out-weighs where they are going.
 */
export const PAST_TRIPS_PREVIEW_COUNT = 4;

/**
 * The calendar date in a given zone, as `YYYY-MM-DD`.
 *
 * This deliberately mirrors `getLocalDate` in
 * `apps/api/src/services/trip-rules.ts`, which is what actually derives
 * `trip.lifecycle`. The web app cannot import from `apps/api`, so the rule is
 * duplicated - but named and tested here rather than inlined in a component,
 * so the two copies can at least be compared.
 */
export function getLocalDate(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  return `${value('year')}-${value('month')}-${value('day')}`;
}

/**
 * Whole calendar days from one `YYYY-MM-DD` to another.
 *
 * Both ends are read as UTC midnight so the arithmetic counts dates rather
 * than elapsed time: a daylight-saving shift moves the clock, not the day.
 */
export function calendarDayDistance(startDate: string, endDate: string) {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);

  return Math.round((end - start) / 86_400_000);
}

/**
 * Days until departure, never negative. A trip that has already started
 * counts as zero rather than as a negative countdown.
 */
export function daysUntilTripStart(trip: Trip, now = new Date()) {
  return Math.max(
    0,
    calendarDayDistance(getLocalDate(now, trip.referenceTimeZone), trip.startDate),
  );
}

/** Whether a finished trip is recent enough to still lead Home. */
export function isRecentlyCompleted(trip: Trip, now = new Date()) {
  const daysSinceEnd = calendarDayDistance(trip.endDate, getLocalDate(now, trip.referenceTimeZone));

  return daysSinceEnd >= 0 && daysSinceEnd <= RECENTLY_COMPLETED_DAYS;
}

type SelectPrimaryTripOptions = {
  /**
   * Whether a just-finished trip may still be the primary one. Home says yes -
   * the trip a traveller got back from last week is the one they want. The
   * Trips library says no: there a finished trip belongs in the archive.
   */
  includeRecentlyCompleted?: boolean;
};

/**
 * The one trip a surface should lead with.
 *
 * The order is the traveller's own attention: the trip they are on, then the
 * one they are getting ready for, then the one they just finished.
 */
export function selectPrimaryTrip(
  trips: Trip[],
  now = new Date(),
  { includeRecentlyCompleted = true }: SelectPrimaryTripOptions = {},
): Trip | null {
  const active = trips
    .filter((trip) => trip.lifecycle === 'active')
    .toSorted((left, right) => left.endDate.localeCompare(right.endDate));
  if (active[0]) return active[0];

  const planning = trips
    .filter((trip) => trip.lifecycle === 'planning')
    .toSorted((left, right) => left.startDate.localeCompare(right.startDate));
  if (planning[0]) return planning[0];

  if (!includeRecentlyCompleted) return null;

  const completed = trips
    .filter((trip) => trip.lifecycle === 'completed' && isRecentlyCompleted(trip, now))
    .toSorted((left, right) => right.endDate.localeCompare(left.endDate));

  return completed[0] ?? null;
}

export type TripLibraryGroups = {
  /** The trip the library leads with, or null when everything is finished. */
  featured: Trip | null;
  /** Finished trips, most recent first. */
  past: Trip[];
  /** Everything still ahead that the featured trip did not take. */
  upcoming: Trip[];
};

/**
 * How the Trips library divides a traveller's trips.
 *
 * `featured` reuses `selectPrimaryTrip` so the library and Home agree about
 * which trip matters - but without the recently-completed rung, because a
 * finished trip belongs in the archive here even if it ended yesterday.
 */
export function groupTripsForLibrary(trips: Trip[], now = new Date()): TripLibraryGroups {
  const featured = selectPrimaryTrip(trips, now, { includeRecentlyCompleted: false });

  const upcoming = trips
    .filter((trip) => trip.id !== featured?.id && trip.lifecycle !== 'completed')
    .toSorted((left, right) => {
      // An active trip outranks a planned one however the dates fall.
      if (left.lifecycle !== right.lifecycle) return left.lifecycle === 'active' ? -1 : 1;
      return left.startDate.localeCompare(right.startDate);
    });

  const past = trips
    .filter((trip) => trip.lifecycle === 'completed')
    .toSorted((left, right) => right.endDate.localeCompare(left.endDate));

  return { featured, past, upcoming };
}
