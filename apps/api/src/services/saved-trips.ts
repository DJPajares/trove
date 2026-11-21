import { getPrismaClient } from '@trove/db';

import { formatDateOnly } from './trip-rules.js';

/**
 * No Public trip by that id. One error for a missing, Private, and malformed
 * trip alike, so keeping a trip never tells anyone which of those it was.
 */
export class SavedTripNotFoundError extends Error {
  constructor() {
    super('trip_not_found');
    this.name = 'SavedTripNotFoundError';
  }
}

/** A traveller keeping their own trip in Finds would only be keeping a second door to it. */
export class SavedTripOwnTripError extends Error {
  constructor() {
    super('own_trip');
    this.name = 'SavedTripOwnTripError';
  }
}

export type SavedTripSummary = {
  /** ISO 3166-1 alpha-2, in the order the trip's owner picked them. */
  countries: string[];
  endDate: string;
  id: string;
  name: string;
  /** Null where the owner has no display name; the reader supplies its own wording. */
  ownerName: string | null;
  savedAt: string;
  startDate: string;
};

/**
 * The trips a traveller has kept in Finds to read for ideas (PRD 8.4).
 *
 * Each is a live reference to someone else's Public trip, never a copy of it,
 * and carries only fields that trip's own read-only link shows. A trip whose
 * owner has since made it Private is filtered out in the query itself, so its
 * name never reaches this process; its row is kept, and the trip comes back if
 * it is made Public again.
 */
export async function listSavedTrips(userId: string): Promise<SavedTripSummary[]> {
  const rows = await getPrismaClient().savedTrip.findMany({
    where: { ownerId: userId, trip: { visibility: 'PUBLIC' } },
    select: {
      createdAt: true,
      trip: {
        select: {
          countries: true,
          endDate: true,
          id: true,
          name: true,
          owner: { select: { displayName: true } },
          startDate: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return rows.map(({ createdAt, trip }) => ({
    countries: trip.countries,
    endDate: formatDateOnly(trip.endDate),
    id: trip.id,
    name: trip.name,
    ownerName: trip.owner?.displayName?.trim() || null,
    savedAt: createdAt.toISOString(),
    startDate: formatDateOnly(trip.startDate),
  }));
}

export async function saveTrip(userId: string, tripId: string) {
  const prisma = getPrismaClient();
  const trip = await prisma.trip.findFirst({
    // The same test the read-only link applies: Public is the whole of it.
    where: { id: tripId, visibility: 'PUBLIC' },
    select: { id: true, ownerId: true },
  });
  if (!trip) throw new SavedTripNotFoundError();
  if (trip.ownerId === userId) throw new SavedTripOwnTripError();

  await prisma.profile.upsert({ where: { id: userId }, create: { id: userId }, update: {} });
  await prisma.savedTrip.upsert({
    where: { ownerId_tripId: { ownerId: userId, tripId: trip.id } },
    create: { ownerId: userId, tripId: trip.id },
    update: {},
  });
}

/** Letting go of a trip that was never kept is not an error: the outcome is the same. */
export async function unsaveTrip(userId: string, tripId: string) {
  await getPrismaClient().savedTrip.deleteMany({ where: { ownerId: userId, tripId } });
}
