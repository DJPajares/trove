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
