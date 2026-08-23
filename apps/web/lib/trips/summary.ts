import type { EditorialSubject } from '@/lib/media/editorial-images';

import type { Trip } from './api';

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

  const name = trip.destinations[0]?.name.trim() || trip.name.trim();
  if (!name) return null;

  return { category: 'destination', name, tripId: trip.id };
}
