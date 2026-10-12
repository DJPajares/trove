import type { AiPlannerDraft } from '@trove/types';
import { timeZoneForCountry } from '@trove/types/countries';
import type { Prisma } from '@trove/db';

import { resolvedPlaceTimeZone } from './place-data.js';
import {
  resolveCountryPrimaryTimeZone,
  resolveDestinationCountryCode,
  resolveTripTimeZone,
} from './trip-rules.js';

type StoredDestinationPlace = { id: string; providerAddress: string | null };

function visitedDayPlaceIds(day: AiPlannerDraft['days'][number]) {
  return [
    day.dailyBasePlaceRefId,
    day.dailyBaseDeparturePlaceRefId,
    ...day.items.filter((item) => item.blockType !== 'transport').map((item) => item.placeRefId),
  ].filter((id): id is string => Boolean(id));
}

/** Provider addresses already resolved for this draft take precedence over labels. */
export function suggestedDraftCountries(
  draft: AiPlannerDraft,
  storedPlaces: readonly StoredDestinationPlace[] = [],
): string[] {
  const places = new Map(draft.places.map((place) => [place.id, place]));
  const addresses = new Map(storedPlaces.map((place) => [place.id, place.providerAddress]));
  const providerCountry = (id: string) => {
    const place = places.get(id);
    if (place?.resolution !== 'verified') return null;
    if (place.countryCode && timeZoneForCountry(place.countryCode)) return place.countryCode;
    const address = addresses.get(place.placeId);
    return address ? resolveDestinationCountryCode(address) : null;
  };
  return [
    ...new Set(
      draft.trip.destinations.flatMap((destination) => {
        const place = places.get(destination.placeRefId);
        const code =
          providerCountry(destination.placeRefId) ??
          (place ? resolveDestinationCountryCode(place.name) : null);
        const visited = draft.days
          .filter((day) => day.destinationId === destination.id)
          .flatMap(visitedDayPlaceIds)
          .flatMap((id) => providerCountry(id) ?? []);
        return [...(code ? [code] : []), ...visited];
      }),
    ),
    ...draft.days
      .filter((day) => !day.destinationId)
      .flatMap(visitedDayPlaceIds)
      .flatMap((id) => providerCountry(id) ?? []),
  ].filter((code, index, all) => all.indexOf(code) === index);
}

/** Reads only already stored Place addresses; no provider lookup or draft mutation. */
export async function suggestedDraftCountriesFromStoredPlaces(
  draft: AiPlannerDraft,
  prisma: Pick<Prisma.TransactionClient, 'place'>,
): Promise<string[]> {
  const places = new Map(draft.places.map((place) => [place.id, place]));
  const ids = [
    ...new Set(
      [
        ...draft.trip.destinations.map((destination) => destination.placeRefId),
        ...draft.days.flatMap(visitedDayPlaceIds),
      ].flatMap((id) => {
        const place = places.get(id);
        return place?.resolution === 'verified' &&
          !(place.countryCode && timeZoneForCountry(place.countryCode))
          ? [place.placeId]
          : [];
      }),
    ),
  ];
  if (!ids.length) return suggestedDraftCountries(draft);
  try {
    const stored = await prisma.place.findMany({
      where: { id: { in: ids } },
      select: { id: true, providerAddress: true },
    });
    return suggestedDraftCountries(draft, stored);
  } catch {
    // Country selection remains available when the optional address read fails.
    return suggestedDraftCountries(draft);
  }
}

export function normalizeReviewedCountries(input: readonly string[]): string[] | null {
  if (input.length < 1 || input.length > 20) return null;
  const codes = input.map((code) => code.trim().toUpperCase());
  if (codes.some((code) => !/^[A-Z]{2}$/.test(code) || !timeZoneForCountry(code))) return null;
  return [...new Set(codes)];
}

/** Compare review's country fallback with the scorer's country-free timezone baseline. */
export async function countryCorrectionChangesTimeContext(
  transaction: Prisma.TransactionClient,
  _ownerId: string,
  draft: AiPlannerDraft,
  reviewedCountries: readonly string[],
) {
  const verifiedIds = [
    ...new Set(
      draft.places.flatMap((place) => (place.resolution === 'verified' ? [place.placeId] : [])),
    ),
  ];
  const storedPlaces = await transaction.place.findMany({
    where: { id: { in: verifiedIds } },
    select: {
      customTimeZone: true,
      id: true,
      kind: true,
      providerAddress: true,
      providerRefs: true,
    },
  });
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
      profileHome: null,
      startingLocation: null,
    });
  // readDraftPlanScore uses located places/destinations, then UTC. Suggestions
  // do not change those inputs, even when the traveller accepts the prefill.
  const before = reference([]);
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
