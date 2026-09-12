import { MAX_EDITORIAL_IMAGE_SUBJECTS, type EditorialSubject } from '@/lib/media/editorial-images';
import { isKnownCountry, namedCountryLine } from '@/lib/trips/countries';

import type { Trip } from './api';
import type { TripLibraryGroups } from './lifecycle';

/** The trip's destinations as one line, or null when it has none yet. */
export function tripDestinationSummary(trip: Trip) {
  const names = trip.destinations.map((destination) => destination.name).filter(Boolean);

  return names.length ? names.join(', ') : null;
}

/**
 * Where a trip goes, as one line - "🇯🇵 Japan · Kyoto, Tokyo".
 *
 * The country leads because it is what the traveller declared, and every trip
 * has one; the destinations follow because they say where inside that country
 * rather than somewhere else. A trip from before the field existed shows its
 * destinations alone, and one with neither returns null so the surface renders
 * no line at all - an empty "where" is the "Destination still open" mistake
 * again.
 */
export function tripWhereLine(trip: Trip, locale: string): string | null {
  const countries = namedCountryLine(trip.countries, locale);
  const destinations = tripDestinationSummary(trip);

  if (!countries) return destinations;

  return destinations ? `${countries} · ${destinations}` : countries;
}

/**
 * The English name of a country code, for asking a photograph about it.
 *
 * English rather than the reader's locale on purpose: the subject is matched
 * server-side against English names, so a French reader and an English one must
 * ask the same question and get the same photograph. `Intl.DisplayNames` owns
 * the name, so no country list is hard-coded here.
 */
function countryEditorialName(code: string | undefined): string | null {
  // A code Trove does not know is dropped before `Intl.DisplayNames` sees it,
  // which would otherwise ask for a photograph of "Unknown Region".
  if (!isKnownCountry(code)) return null;

  try {
    const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(code);

    return name && name !== code ? name : null;
  } catch {
    return null;
  }
}

/**
 * What a trip should ask a photograph for, or null when it needs none.
 *
 * A trip the traveller gave a cover to is already answered, so it is dropped
 * here rather than at each call site: this is the single place that decides a
 * screen's editorial batch, and keeping it small is what keeps a list of trips
 * to one request.
 *
 * Without a destination the trip is pictured by the country it declares, and
 * only then by its own name - a name is the weakest rung, because a trip called
 * "Mum's 60th" gets a literal photograph of that under a caption promising
 * travel, while a trip to Japan can always be pictured by Japan.
 */
export function tripEditorialSubject(trip: Trip): EditorialSubject | null {
  if (trip.coverPhotoUrl) return null;

  const destinationName = trip.destinations[0]?.name.trim();
  const name = destinationName || countryEditorialName(trip.countries?.[0]) || trip.name.trim();
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
