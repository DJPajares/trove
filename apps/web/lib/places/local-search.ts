import type { TrovePlaceCategory } from '@/lib/place-categories';
import type { ProviderSuggestion } from '@/lib/saved/api';
import { PROVIDER_SEARCH_RESULT_LIMIT } from '@/lib/saved/search-results';
import { isAccommodation } from '@/lib/trip-places/categories';
import { matchesPlaceQuery } from '@/lib/trip-places/list-view';

/** Each group stays a glance; a longer query narrows it further. */
const LOCAL_GROUP_LIMIT = 8;

/** Just enough of a Place to name it, place it and match it. */
export type LocalPlaceRecord = {
  categories?: TrovePlaceCategory[];
  id: string;
  kind: 'custom' | 'provider';
  name: string | null;
  note?: string | null;
  providerAddress: string | null;
  providerLabel: string | null;
  providerRefs: ReadonlyArray<{ externalPlaceId: string }>;
  snapshot?: { address?: string | null; category: TrovePlaceCategory; name?: string | null } | null;
};

/** A Trip Place, Saved Place or known Place: a Place, perhaps renamed by the traveller. */
export type LocalPlaceEntry = {
  categories?: TrovePlaceCategory[];
  place: LocalPlaceRecord;
};

/** The traveller's own name first, then the Place's, then what the provider called it. */
export function localPlaceName(place: LocalPlaceRecord, customName?: string | null) {
  return (
    customName ??
    (place.kind === 'custom' ? place.name : (place.snapshot?.name ?? place.providerLabel)) ??
    null
  );
}

export function localPlaceAddress(place: LocalPlaceRecord) {
  return place.kind === 'custom'
    ? (place.note ?? null)
    : (place.snapshot?.address ?? place.providerAddress ?? null);
}

/** Somewhere to sleep first, otherwise in the order given. */
function stayFirst<T>(entries: readonly T[], isStay: (entry: T) => boolean): T[] {
  return [...entries.filter(isStay), ...entries.filter((entry) => !isStay(entry))];
}

/**
 * What Trove already knows that matches the query, in the three places it
 * knows it from: this trip, the traveller's Saved Places, and their other
 * trips. A Place appears once, in the first group that has it. Nothing here
 * asks a provider - it is the answer a picker gives while the traveller types.
 */
export function matchLocalPlaces<
  Trip extends LocalPlaceEntry & { customName?: string | null },
  Saved extends LocalPlaceEntry,
  Known extends LocalPlaceEntry & { tripName?: string | null },
>(
  query: string,
  sources: Readonly<{ known?: readonly Known[]; saved?: readonly Saved[]; trip?: readonly Trip[] }>,
  options: Readonly<{ stay?: boolean }> = {},
) {
  const typed = query.trim();
  const seenPlaces = new Set<string>();
  const seenExternal = new Set<string>();

  function pick<T extends LocalPlaceEntry>(
    entries: readonly T[] | undefined,
    fields: (entry: T) => readonly (string | null | undefined)[],
  ): T[] {
    if (!typed || !entries) return [];
    const matched = entries.filter(
      (entry) =>
        !seenPlaces.has(entry.place.id) &&
        !entry.place.providerRefs.some((reference) =>
          seenExternal.has(reference.externalPlaceId),
        ) &&
        matchesPlaceQuery(fields(entry), typed),
    );
    const ordered = (options.stay ? stayFirst(matched, isAccommodation) : matched).slice(
      0,
      LOCAL_GROUP_LIMIT,
    );
    // Everything in a group is claimed, shown or not, so a Place cut from one
    // group never turns up again in the next.
    entries.forEach((entry) => {
      if (!matched.includes(entry)) return;
      seenPlaces.add(entry.place.id);
      entry.place.providerRefs.forEach((reference) => seenExternal.add(reference.externalPlaceId));
    });
    return ordered;
  }

  const trip = pick(sources.trip, (entry) => [
    localPlaceName(entry.place, entry.customName),
    localPlaceName(entry.place),
    localPlaceAddress(entry.place),
  ]);
  const saved = pick(sources.saved, (entry) => [
    localPlaceName(entry.place),
    localPlaceAddress(entry.place),
  ]);
  const known = pick(sources.known, (entry) => [
    entry.tripName,
    localPlaceName(entry.place),
    localPlaceAddress(entry.place),
  ]);
  return { known, saved, total: trip.length + saved.length + known.length, trip };
}

/** Every Google reference among these Places, to leave out of Google's answer. */
export function knownExternalIds(...groups: ReadonlyArray<readonly LocalPlaceEntry[] | undefined>) {
  return new Set(
    groups.flatMap((group) =>
      (group ?? []).flatMap((entry) =>
        entry.place.providerRefs.map((reference) => reference.externalPlaceId),
      ),
    ),
  );
}

/**
 * Google's answer, less what Trove already offered, with somewhere to stay
 * first when the traveller is looking for one.
 */
export function providerResults(
  suggestions: readonly ProviderSuggestion[],
  known: ReadonlySet<string>,
  options: Readonly<{ stay?: boolean }> = {},
) {
  const fresh = suggestions.filter((suggestion) => !known.has(suggestion.externalPlaceId));
  return (
    options.stay ? stayFirst(fresh, (suggestion) => suggestion.category === 'stay') : fresh
  ).slice(0, PROVIDER_SEARCH_RESULT_LIMIT);
}
