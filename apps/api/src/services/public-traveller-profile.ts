import { getPrismaClient } from '@trove/db';

import { formatDateOnly } from './trip-rules.js';

/**
 * No such traveller. One error for an unknown id and a malformed one, so the
 * endpoint answers every miss the same way.
 */
export class PublicTravellerNotFoundError extends Error {
  constructor() {
    super('traveller_not_found');
    this.name = 'PublicTravellerNotFoundError';
  }
}

export type PublicTravellerTrip = {
  /** ISO 3166-1 alpha-2, in the order the traveller picked them. */
  countries: string[];
  endDate: string;
  id: string;
  name: string;
  startDate: string;
};

export type PublicTravellerProfile = {
  traveller: {
    id: string;
    /** Null where they have not set one; the reader supplies its own wording. */
    name: string | null;
  };
  trips: PublicTravellerTrip[];
};

/**
 * A traveller as a stranger sees them (PRD 8.3): a name and the Public trips they
 * have listed, and nothing else from their profile.
 *
 * Each trip carries only fields the trip's own read-only link already shows, so
 * the list can never say more about a trip than opening it would. It reads
 * Trove's database and nothing else - no Place, no image, no provider.
 *
 * A trip is listed only when it is Public *and* stamped `publicListedAt`, which is
 * set when its owner chose Public under the current disclosure. Private trips are
 * filtered out in the query itself, so neither they nor their count ever reach
 * this process's response.
 */
export async function readPublicTravellerProfile(
  travellerId: string,
): Promise<PublicTravellerProfile> {
  const prisma = getPrismaClient();
  const profile = await prisma.profile.findUnique({
    where: { id: travellerId },
    select: {
      displayName: true,
      id: true,
      ownedTrips: {
        where: { archivedAt: null, publicListedAt: { not: null }, visibility: 'PUBLIC' },
        select: { countries: true, endDate: true, id: true, name: true, startDate: true },
        orderBy: [{ startDate: 'desc' }, { id: 'asc' }],
      },
    },
  });
  if (!profile) throw new PublicTravellerNotFoundError();

  return {
    traveller: { id: profile.id, name: profile.displayName?.trim() || null },
    trips: profile.ownedTrips.map((trip) => ({
      countries: trip.countries,
      endDate: formatDateOnly(trip.endDate),
      id: trip.id,
      name: trip.name,
      startDate: formatDateOnly(trip.startDate),
    })),
  };
}
