import { MAX_EDITORIAL_IMAGE_SUBJECTS, type EditorialSubject } from '@/lib/media/editorial-images';

import type { Trip } from './api';
import type { TripLibraryGroups } from './lifecycle';

/** The trip's destinations as one line, or null when it has none yet. */
export function tripDestinationSummary(trip: Trip) {
  const names = trip.destinations.map((destination) => destination.name).filter(Boolean);

  return names.length ? names.join(', ') : null;
}

/**
 * What a trip should ask a photograph for, or null when it needs none.
 *
 * A trip the traveller gave a cover to is already answered, so it is dropped
 * here rather than at each call site: this is the single place that decides a
 * screen's editorial batch, and keeping it small is what keeps a list of trips
 * to one request. A trip without a destination falls back to its own name,
 * which is the only other thing it can honestly be pictured by.
 */
export function tripEditorialSubject(trip: Trip): EditorialSubject | null {
  if (trip.coverPhotoUrl) return null;

  const destinationName = trip.destinations[0]?.name.trim();
  const name = destinationName || trip.name.trim();
  if (!name) return null;

  // The destination's Place travels with its name, never without it. It keys the
  // subject to that one Place - so two cities can never share a photograph - and
  // it is what lets the resolver reach the address, types and language it has
  // already cached, which is most of the difference between a picture of the
  // city and a picture of nothing in particular. A trip falling back to its own
  // name carries no Place: the two would describe different things.
  return {
    category: 'destination',
    name,
    ...(destinationName ? { placeId: trip.destinations[0]?.placeId } : {}),
    tripId: trip.id,
  };
}

/**
 * The photographs a whole library asks for, in one request.
 *
 * The order is what the ceiling bites into: the trip the library leads with and
 * the trips already on screen are answered before the tail of an archive the
 * traveller may never scroll to, and everything past the cap simply renders the
 * branded fallback - which is what the fallback is for. The resolver enforces
 * the same ceiling, so the slice here is about which trips get a photograph
 * rather than about how many requests the screen costs.
 *
 * Subjects come from every trip rather than from the rows currently mounted:
 * the archive's tail is behind a disclosure, and asking again when it opens
 * would be a second request for the same screen.
 */
export function libraryEditorialSubjects(groups: TripLibraryGroups): EditorialSubject[] {
  return [groups.featured, ...groups.upcomingReady, ...groups.upcomingInProgress, ...groups.past]
    .flatMap((trip) => (trip ? (tripEditorialSubject(trip) ?? []) : []))
    .slice(0, MAX_EDITORIAL_IMAGE_SUBJECTS);
}
