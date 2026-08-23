import type { Trip } from './api';

/** Below this a name is still being typed, not yet a subject worth asking about. */
export const MIN_EDITORIAL_SUBJECT_LENGTH = 3;

/** Long enough that typing a city name settles into one request, short enough to feel immediate. */
export const EDITORIAL_PREVIEW_DEBOUNCE_MS = 500;

/**
 * Whether an existing trip carries anything in its optional half.
 *
 * A traveller's own notes must never become something they have to go looking
 * for, so a trip that already holds any of these opens the panel rather than
 * hiding them behind a control the traveller never closed.
 */
export function hasOptionalTripDetails(trip: Trip | null) {
  if (!trip) return false;

  return Boolean(
    trip.notes?.trim() ||
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
 * What a half-typed form should ask a photograph for, or nothing yet.
 *
 * The precedence matches `tripEditorialSubject`, so the cover a traveller is
 * shown while creating a trip is the cover the library will show afterwards.
 */
export function editorialCoverSubjectName(destinations: readonly string[], name: string) {
  const candidate = destinations.map((entry) => entry.trim()).find(Boolean) ?? name.trim();

  return candidate.length >= MIN_EDITORIAL_SUBJECT_LENGTH ? candidate : '';
}
