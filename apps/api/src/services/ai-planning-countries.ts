import type { AiPlannerDraft } from '@trove/types';
import { timeZoneForCountry } from '@trove/types/countries';
import type { Prisma } from '@trove/db';

import { resolvedPlaceTimeZone } from './place-data.js';
import {
  resolveCountryPrimaryTimeZone,
  resolveDestinationCountryCode,
  resolveTripTimeZone,
} from './trip-rules.js';

/** Suggestions come only from country names in the immutable destination labels. */
export function suggestedDraftCountries(draft: AiPlannerDraft): string[] {
  const places = new Map(draft.places.map((place) => [place.id, place]));
  return [
    ...new Set(
      draft.trip.destinations.flatMap((destination) => {
        const name = places.get(destination.placeRefId)?.name;
        const code = name ? resolveDestinationCountryCode(name) : null;
        return code ? [code] : [];
      }),
    ),
  ];
}

export function normalizeReviewedCountries(input: readonly string[]): string[] | null {
  if (input.length < 1 || input.length > 20) return null;
  const codes = input.map((code) => code.trim().toUpperCase());
  if (codes.some((code) => !/^[A-Z]{2}$/.test(code) || !timeZoneForCountry(code))) return null;
  return [...new Set(codes)];
}

/** Uses Apply's place and fallback precedence without creating Places or calling providers. */
export async function countryCorrectionChangesTimeContext(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  draft: AiPlannerDraft,
  reviewedCountries: readonly string[],
) {
  const suggestedCountries = suggestedDraftCountries(draft);
  if (suggestedCountries.join(',') === reviewedCountries.join(',')) return false;

  const verifiedIds = [
    ...new Set(
      draft.places.flatMap((place) => (place.resolution === 'verified' ? [place.placeId] : [])),
    ),
  ];
  const [storedPlaces, profile] = await Promise.all([
    transaction.place.findMany({
      where: { id: { in: verifiedIds } },
      select: {
        customTimeZone: true,
        id: true,
        kind: true,
        providerAddress: true,
        providerRefs: true,
      },
    }),
    transaction.profile.findUnique({ where: { id: ownerId }, select: { homeTimeZone: true } }),
  ]);
  const stored = new Map(storedPlaces.map((place) => [place.id, place]));
  const zones = new Map(
    draft.places.map((place) => {
      const provider = place.resolution === 'verified' ? stored.get(place.placeId) : null;
      return [
        place.id,
        (provider ? resolvedPlaceTimeZone(provider) : null) ??
          resolveCountryPrimaryTimeZone(provider?.providerAddress ?? '') ??
          resolveCountryPrimaryTimeZone(place.name),
      ] as const;
    }),
  );
  const destinations = draft.trip.destinations.map((destination) => ({
    placeId: null,
    timeZone: zones.get(destination.placeRefId) ?? null,
  }));
  const reference = (countries: readonly string[]) =>
    resolveTripTimeZone({
      countries,
      destinations,
      deviceTimeZone: 'UTC',
      profileHome: profile?.homeTimeZone ? { placeId: null, timeZone: profile.homeTimeZone } : null,
      startingLocation: null,
    });
  const before = reference(suggestedCountries);
  const after = reference(reviewedCountries);
  if (before.timeZone === after.timeZone && before.source !== 'DEVICE_FALLBACK') return false;

  for (const day of draft.days) {
    const firstLocatedItem = day.items.find(
      (item) => item.placeRefId && zones.get(item.placeRefId),
    );
    const dayZone = day.dailyBasePlaceRefId ? zones.get(day.dailyBasePlaceRefId) : null;
    const firstZone = firstLocatedItem?.placeRefId ? zones.get(firstLocatedItem.placeRefId) : null;
    if (dayZone || firstZone) continue;
    // Day scoring reads the default timezone even when no stop has an exact time.
    return true;
  }
  return false;
}
