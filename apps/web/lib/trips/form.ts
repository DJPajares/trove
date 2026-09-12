import type { Trip } from './api';

/** Below this a name is still being typed, not yet a subject worth asking about. */
export const MIN_EDITORIAL_SUBJECT_LENGTH = 3;

/** Long enough that typing a city name settles into one request, short enough to feel immediate. */
export const EDITORIAL_PREVIEW_DEBOUNCE_MS = 500;

/**
 * Whether an existing trip carries anything in its optional half.
 *
 * Anything a traveller set themselves must never become something they have to
 * go looking for, so a trip that already holds any of these opens the panel
 * rather than hiding them behind a control the traveller never closed. The
 * description is deliberately absent: it is asked for in the form's main body
 * now, so it never lands behind this disclosure.
 */
export function hasOptionalTripDetails(trip: Trip | null) {
  if (!trip) return false;

  return Boolean(
    trip.startingLocationOverride?.trim() ||
    trip.referenceTimeZoneSource === 'explicit' ||
    trip.partySize > 1 ||
    trip.planningReadiness === 'ready',
  );
}

/**
 * The party-size rule, in one place.
 *
 * It lives here rather than inline in the validator because the form now has to
 * ask the same question twice: once to reject a submission, and once to decide
 * whether to open the panel the offending field is hidden inside. Two copies of
 * this predicate would eventually disagree.
 */
export function isValidPartySize(value: string) {
  const partySize = Number(value);

  return Number.isInteger(partySize) && partySize >= 1 && partySize <= 99;
}

/**
 * Whether a trip has named where in the world it goes.
 *
 * A trip must declare at least one country. It lives beside the party-size rule
 * for the same reason: the form asks this twice - once to reject a submission
 * and once to say which field to put the cursor in - and two copies of the
 * question would eventually answer it differently.
 *
 * Blank codes are not countries. The picker cannot produce one, but form state
 * is rehydrated from a trip that predates the field, so the guard is real.
 */
export function hasTripCountries(countries: readonly string[]) {
  return countries.some((code) => code.trim().length > 0);
}

/**
 * What a half-typed form should ask a photograph for, or nothing yet.
 *
 * Only a destination is asked about. A trip's name is whatever the traveller
 * felt like calling it - "Mum's 60th", "Round two" - and a photography search
 * answers those literally: naming a trip after anything but a place produces a
 * picture of that thing, offered under a caption promising a travel photograph
 * of it. The library may still fall back to a trip's name for a thumbnail, but
 * a form that says "a travel photograph of {name}" has made a specific claim,
 * and it should only make it about somewhere.
 */
export function editorialCoverSubjectName(destinations: readonly string[]) {
  const candidate = destinations.map((entry) => entry.trim()).find(Boolean) ?? '';

  return candidate.length >= MIN_EDITORIAL_SUBJECT_LENGTH ? candidate : '';
}

const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * The same trip, starting on a different day.
 *
 * The start date says when a trip is; the end date says how long it is. So
 * moving the start carries the end along with it, and the plan inside keeps the
 * shape it already had. Editing the end date is the other question - how long -
 * and is left alone.
 *
 * A range that cannot be read is not guessed at: the new start stands and the
 * end is left for the form's own validation to object to.
 */
export function moveTripRange(
  range: Readonly<{ endDate: string; startDate: string }>,
  nextStartDate: string,
) {
  const from = Date.parse(`${range.startDate}T00:00:00.000Z`);
  const to = Date.parse(`${nextStartDate}T00:00:00.000Z`);
  const end = Date.parse(`${range.endDate}T00:00:00.000Z`);

  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(end) || end < from) {
    return { endDate: range.endDate, startDate: nextStartDate };
  }

  return shiftTripDates(range, Math.round((to - from) / DAY_MS));
}

/**
 * The whole trip, however many days over.
 *
 * Both ends move together, so the trip keeps its length and the plan inside it
 * keeps its shape - which is what makes this a move rather than a resize, and
 * what lets the server carry the itinerary across without asking anything.
 *
 * The arithmetic is done at UTC midnight, where a day is always a day. Doing it
 * in the reader's own zone would lose or gain an hour twice a year and land the
 * trip on the wrong date for it.
 */
export function shiftTripDates(
  range: Readonly<{ endDate: string; startDate: string }>,
  days: number,
) {
  const start = Date.parse(`${range.startDate}T00:00:00.000Z`);
  const end = Date.parse(`${range.endDate}T00:00:00.000Z`);

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { endDate: range.endDate, startDate: range.startDate };
  }

  return {
    endDate: new Date(end + days * DAY_MS).toISOString().slice(0, 10),
    startDate: new Date(start + days * DAY_MS).toISOString().slice(0, 10),
  };
}
