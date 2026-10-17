import { getPrismaClient, type Prisma } from '@trove/db';

/**
 * A Trip Place the trip already treats as somewhere to stay - its Stay, a
 * day's start or end, an accommodation booking - is recorded as one, so the
 * Stay picker offers it even when its provider only knows it as an address.
 *
 * A Custom Place records it on itself, since it belongs to its owner; a
 * provider Place is shared, so the trip records it instead. Adds, never
 * removes, and is a no-op for a place already marked.
 */
export async function markTripPlacesAsStay(
  tripId: string,
  tripPlaceIds: ReadonlyArray<string | null | undefined>,
  db: Prisma.TransactionClient = getPrismaClient(),
) {
  const ids = [...new Set(tripPlaceIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return;
  const tripPlaces = await db.tripPlace.findMany({
    where: { id: { in: ids }, tripId },
    select: {
      categories: true,
      id: true,
      place: { select: { categories: true, id: true, kind: true } },
    },
  });
  for (const tripPlace of tripPlaces) {
    if (tripPlace.place.kind === 'CUSTOM') {
      if (!tripPlace.place.categories.includes('STAY'))
        await db.place.update({
          where: { id: tripPlace.place.id },
          data: { categories: { push: 'STAY' } },
        });
    } else if (!tripPlace.categories.includes('STAY')) {
      await db.tripPlace.update({
        where: { id: tripPlace.id },
        data: { categories: { push: 'STAY' } },
      });
    }
  }
}
