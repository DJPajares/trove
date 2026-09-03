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
 * How close departure has to be before an unmarked plan is worth mentioning.
 *
 * A week is the point where a trip stops being an idea and starts being
 * logistics - early enough to still act on what is missing, late enough that
 * the traveller is not nagged about a trip they have months to finish.
 */
const READINESS_NUDGE_DAYS = 7;

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

export type ReadinessPromptKind = 'nudge' | 'suggest';

/**
 * What, if anything, to say to a traveller who has not marked a plan Ready.
 *
 * Trove only ever asks. Readiness is the traveller's own declaration - a full
 * itinerary is evidence that the plan looks finished, not permission to
 * declare it finished on their behalf (PRD section 6.2).
 *
 * A plan that looks complete gets the question rather than the reminder: being
 * told a trip is close when it is also clearly ready would be pointing at the
 * wrong thing.
 */
export function resolveReadinessPrompt(trip: Trip, now = new Date()): ReadinessPromptKind | null {
  if (trip.lifecycle !== 'planning' || trip.planningReadiness !== 'in_progress') return null;

  if (trip.itineraryCoverage?.percentage === 100) return 'suggest';
  if (daysUntilTripStart(trip, now) <= READINESS_NUDGE_DAYS) return 'nudge';

  return null;
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
  /** Trips still ahead whose plan the traveller has not yet called done. */
  upcomingInProgress: Trip[];
  /** Trips still ahead that the traveller has marked Ready. */
  upcomingReady: Trip[];
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

  // Readiness separates the list; it never reorders it. Partitioning an
  // already-sorted list keeps each group in departure order, so a marker can
  // never lift a trip above one that leaves sooner. An active trip stays with
  // the unmarked ones whatever its readiness says: Ready is a planning-phase
  // declaration, and that phase is over.
  const isMarkedReady = (trip: Trip) =>
    trip.lifecycle === 'planning' && trip.planningReadiness === 'ready';
  const upcomingReady = upcoming.filter(isMarkedReady);
  const upcomingInProgress = upcoming.filter((trip) => !isMarkedReady(trip));

  const past = trips
    .filter((trip) => trip.lifecycle === 'completed')
    .toSorted((left, right) => right.endDate.localeCompare(left.endDate));

  return { featured, past, upcomingInProgress, upcomingReady };
}
