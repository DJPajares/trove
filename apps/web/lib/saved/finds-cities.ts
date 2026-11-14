import { localityFromAddress, sameTown } from '@trove/types';

type FindLike = {
  createdAt: string;
  place: {
    providerAddress: string | null;
    snapshot?: { address?: string | null } | null;
  };
};

export type FindsCity<T> = {
  /** The town as the first of its places spells it. */
  name: string;
  places: T[];
  /** When the earliest of them was kept. */
  since: string;
};

/**
 * A traveller's finds, by the town each is in, read from its stored address
 * the way a planner day is named, and never guessed. One town spelled two ways
 * ("Đà Nẵng", "Da Nang") is one group. Places whose address names no town
 * safely are left out of every group and returned as `elsewhere`.
 *
 * Groups come largest first, so the towns with the most to plan lead. Places
 * keep the order they were given in.
 */
export function groupFindsByCity<T extends FindLike>(
  finds: readonly T[],
): { cities: FindsCity<T>[]; elsewhere: T[] } {
  const cities: FindsCity<T>[] = [];
  const elsewhere: T[] = [];
  for (const find of finds) {
    const town = localityFromAddress(find.place.snapshot?.address ?? find.place.providerAddress);
    if (!town) {
      elsewhere.push(find);
      continue;
    }
    const city = cities.find((entry) => sameTown(entry.name, town));
    if (city) {
      city.places.push(find);
      if (find.createdAt < city.since) city.since = find.createdAt;
    } else {
      cities.push({ name: town, places: [find], since: find.createdAt });
    }
  }
  cities.sort(
    (left, right) =>
      right.places.length - left.places.length || left.name.localeCompare(right.name),
  );
  return { cities, elsewhere };
}

/**
 * The towns the cover leads with: the ones whose finds have been kept longest,
 * because those are the ones most worth being reminded of.
 */
export function coverFindsCities<T>(cities: readonly FindsCity<T>[], limit = 3) {
  return cities.toSorted((left, right) => left.since.localeCompare(right.since)).slice(0, limit);
}

/** A stable anchor for a town's group on the page. */
export function findsCityAnchor(name: string) {
  const slug = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    // The one common letter that has no decomposed form.
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `finds-${slug || 'town'}`;
}
