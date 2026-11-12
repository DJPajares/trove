/**
 * The trip pages a prepared trip keeps for offline use.
 *
 * Shared by the service worker, which serves them from cache when the network
 * fails, and by trip preparation, which warms them - so the two can never
 * disagree about which pages open offline. `''` is the trip hub itself.
 */
export const OFFLINE_TRIP_PAGE_PATHS = [
  '',
  'expenses',
  'info',
  'itinerary',
  'memories',
  'mode',
  'mode/map',
  'mode/trip',
  'mode/today',
  'places',
  'reservations',
  'tasks',
] as const;

/** `/trips/archived` and `/trips/ai/…` sit beside trip ids; neither is a trip. */
const offlineTripPagePath =
  /^\/trips\/(?!(?:archived|ai)(?:\/|$))[^/]+(?:\/(?:expenses|info|itinerary|memories|mode(?:\/[^/]+)?|places|reservations|tasks))?\/?$/;

export function isOfflineTripPagePath(pathname: string) {
  return offlineTripPagePath.test(pathname);
}

export function offlineTripPageUrls(tripId: string) {
  return OFFLINE_TRIP_PAGE_PATHS.map((path) =>
    path ? `/trips/${tripId}/${path}` : `/trips/${tripId}`,
  );
}

type ColdStartTrip = {
  archivedAt?: string | null;
  endDate: string;
  id: string;
  referenceTimeZone?: string | null;
  startDate: string;
};

function localDate(now: Date, timeZone: string | null | undefined) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      month: '2-digit',
      timeZone: timeZone ?? undefined,
      year: 'numeric',
    }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(now);
  }
}

/**
 * The one prepared trip an offline launch should open straight into, if any.
 *
 * Only when exactly one is under way today, judged in the trip's own time zone:
 * with two, or none, choosing for the traveller would be a guess.
 */
export function pickColdStartTrip(trips: readonly ColdStartTrip[], now = new Date()) {
  const underWay = trips.filter((trip) => {
    if (trip.archivedAt) return false;
    const today = localDate(now, trip.referenceTimeZone);
    return trip.startDate <= today && today <= trip.endDate;
  });
  return underWay.length === 1 ? (underWay[0]?.id ?? null) : null;
}
