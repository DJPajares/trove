import { getPrismaClient } from '@trove/db';

import type { KnownPlace } from './ai-place-grounding.js';
import { PLACE_CACHE_TTL_MS } from './cached-places.js';

/**
 * The traveller's own Saved Places, for the AI planner to prefer (PRD 7.6).
 *
 * Only places Trove can already name and place - a Google reference with a
 * stored identity inside its 30 days - are offered, because the point is that a
 * chosen one needs no search to ground it. Newest first and capped, so a large
 * collection cannot crowd the prompt. Read from storage only.
 */

/** Enough for any one destination without swamping the prompt. */
export const AI_PLANNER_SAVED_PLACE_LIMIT = 40;
const ADDRESS_LIMIT = 90;

export type PlannerSavedPlace = { area: string; name: string };

export async function loadSavedPlacesForPlanner(ownerId: string, now: Date): Promise<KnownPlace[]> {
  const rows = await getPrismaClient().savedPlace.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      place: {
        select: {
          id: true,
          providerRefs: {
            select: {
              cachedAt: true,
              cachedFormattedAddress: true,
              cachedLatitude: true,
              cachedLongitude: true,
              cachedName: true,
              cachedTypes: true,
              externalPlaceId: true,
            },
            where: { provider: 'GOOGLE' },
          },
        },
      },
    },
    where: { ownerId },
  });

  const known: KnownPlace[] = [];
  for (const row of rows) {
    const reference = row.place.providerRefs[0];
    if (
      !reference?.cachedAt ||
      now.getTime() - reference.cachedAt.getTime() > PLACE_CACHE_TTL_MS ||
      !reference.cachedName?.trim() ||
      !reference.cachedFormattedAddress ||
      reference.cachedLatitude === null ||
      reference.cachedLongitude === null
    )
      continue;
    known.push({
      checkedAt: reference.cachedAt,
      externalPlaceId: reference.externalPlaceId,
      formattedAddress: reference.cachedFormattedAddress,
      location: {
        latitude: Number(reference.cachedLatitude),
        longitude: Number(reference.cachedLongitude),
      },
      name: reference.cachedName.trim(),
      placeId: row.place.id,
      rawTypes: reference.cachedTypes,
    });
    if (known.length >= AI_PLANNER_SAVED_PLACE_LIMIT) break;
  }
  return known;
}

/** What the model is told about each one: its name and roughly where it is. */
export function plannerSavedPlaces(known: readonly KnownPlace[]): PlannerSavedPlace[] {
  return known.map((place) => ({
    area: (place.formattedAddress ?? '').slice(0, ADDRESS_LIMIT),
    name: place.name,
  }));
}
