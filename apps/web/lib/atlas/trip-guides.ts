import type { AtlasLinkedDestination } from '@trove/types';

/** A guide a trip leads to: its country's, or one of the destinations that guide links. */
export type TripAtlasGuide = {
  countryCode: string;
  href: string;
  kind: 'country' | 'destination';
  name: string;
};

/** Only a trip's declared countries are read; a trip rarely names more. */
export const TRIP_ATLAS_MAX_COUNTRIES = 3;

export function foldAtlasName(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .split(',')[0]!
    .trim()
    .toLocaleLowerCase();
}

/**
 * The destination guide for a town, matched by name within the trip's own
 * countries. Never a near miss: a town with no exact guide links nowhere.
 */
export function townAtlasGuide(
  town: string,
  guides: ReadonlyArray<{ countryCode: string; destinations: readonly AtlasLinkedDestination[] }>,
): TripAtlasGuide | null {
  const needle = foldAtlasName(town);
  if (!needle) return null;
  for (const guide of guides) {
    const match = guide.destinations.find(
      (destination) => foldAtlasName(destination.name) === needle,
    );
    if (match) {
      return {
        countryCode: guide.countryCode,
        href: `/atlas/${guide.countryCode}/${match.slug}`,
        kind: 'destination',
        name: match.name,
      };
    }
  }
  return null;
}
