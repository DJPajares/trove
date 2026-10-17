import { getPrismaClient, type Prisma } from '@trove/db';
import type { DayStayUpdate, StayPlanUpdate } from '@trove/types';
import {
  refreshDayDefaultTimeZone,
  ItineraryConflictError,
  ItineraryNotFoundError,
  ItineraryValidationError,
} from './itineraries.js';
import { markTripPlacesAsStay } from './place-category-signals.js';
import { formatDateOnly, parseDateOnly } from './trip-rules.js';

/** CAS on the owning trip serializes all stay edits, including resetting day exceptions. */
async function claimRevision(
  tx: Prisma.TransactionClient,
  userId: string,
  tripId: string,
  revision: number,
) {
  const trip = await tx.trip.findFirst({ where: { id: tripId, ownerId: userId } });
  if (!trip) throw new ItineraryNotFoundError('trip_not_found');
  const claimed = await tx.trip.updateMany({
    where: { id: tripId, ownerId: userId, stayPlanRevision: revision },
    data: { stayPlanRevision: { increment: 1 } },
  });
  if (!claimed.count) throw new ItineraryConflictError('itinerary_day_conflict');
  return trip;
}

async function validatePlaces(tx: Prisma.TransactionClient, tripId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  const count = await tx.tripPlace.count({ where: { id: { in: unique }, tripId } });
  if (count !== unique.length) throw new ItineraryValidationError('trip_place_not_found');
}

export function validateStayRanges(input: StayPlanUpdate, startDate: string, endDate: string) {
  const ranges = [...input.ranges].sort((a, b) => a.startDate.localeCompare(b.startDate));
  for (const [index, range] of ranges.entries()) {
    if (
      range.startDate >= range.endDate ||
      range.startDate < startDate ||
      range.startDate > endDate ||
      range.endDate > endDate ||
      (index > 0 && ranges[index - 1]!.endDate > range.startDate)
    ) {
      throw new ItineraryValidationError('invalid_stay_plan');
    }
  }
  return ranges;
}

export async function updateTripStayPlan(userId: string, tripId: string, input: StayPlanUpdate) {
  return getPrismaClient().$transaction(
    async (tx) => {
      const trip = await claimRevision(tx, userId, tripId, input.expectedRevision);
      const ranges = validateStayRanges(
        input,
        formatDateOnly(trip.startDate),
        formatDateOnly(trip.endDate),
      );
      await validatePlaces(
        tx,
        tripId,
        [input.defaultTripPlaceId, ...ranges.map((r) => r.tripPlaceId)].filter(
          (id): id is string => id !== null,
        ),
      );
      await tx.trip.update({
        where: { id: tripId },
        data: { defaultStayTripPlaceId: input.defaultTripPlaceId },
      });
      await tx.tripStayRange.deleteMany({ where: { tripId } });
      if (ranges.length)
        await tx.tripStayRange.createMany({
          data: ranges.map((range) => ({
            tripId,
            tripPlaceId: range.tripPlaceId,
            startDate: parseDateOnly(range.startDate),
            endDate: parseDateOnly(range.endDate),
          })),
        });
      await markTripPlacesAsStay(
        tripId,
        [input.defaultTripPlaceId, ...ranges.map((range) => range.tripPlaceId)],
        tx,
      );
      if (input.resetDayOverrides)
        await tx.itineraryDay.updateMany({
          where: { tripId },
          data: {
            defaultTimeZoneSource: 'TRIP_REFERENCE',
            defaultTimeZoneSourceTripPlaceId: null,
            defaultTimeZoneSourceItemId: null,
            stayStartMode: 'INHERIT',
            stayEndMode: 'INHERIT',
            dailyBaseTripPlaceId: null,
            dailyBaseDepartureTripPlaceId: null,
          },
        });
      const days = await tx.itineraryDay.findMany({ where: { tripId }, select: { id: true } });
      for (const day of days) await refreshDayDefaultTimeZone(tx, tripId, day.id);
      return { revision: input.expectedRevision + 1 };
    },
    { timeout: 30_000 },
  );
}

export async function updateDayStay(
  userId: string,
  tripId: string,
  dayId: string,
  input: DayStayUpdate,
) {
  return getPrismaClient().$transaction(async (tx) => {
    await claimRevision(tx, userId, tripId, input.expectedRevision);
    const day = await tx.itineraryDay.findFirst({ where: { id: dayId, tripId } });
    if (!day) throw new ItineraryNotFoundError('itinerary_day_not_found');
    await validatePlaces(
      tx,
      tripId,
      [input.start, input.end].flatMap((end) => (end.mode === 'place' ? [end.tripPlaceId] : [])),
    );
    await tx.itineraryDay.update({
      where: { id: dayId },
      data: {
        defaultTimeZoneSource: 'TRIP_REFERENCE',
        defaultTimeZoneSourceTripPlaceId: null,
        defaultTimeZoneSourceItemId: null,
        stayStartMode: input.start.mode.toUpperCase() as 'INHERIT' | 'NONE' | 'PLACE',
        stayEndMode: input.end.mode.toUpperCase() as 'INHERIT' | 'NONE' | 'PLACE' | 'SAME_AS_START',
        dailyBaseTripPlaceId: input.start.mode === 'place' ? input.start.tripPlaceId : null,
        dailyBaseDepartureTripPlaceId: input.end.mode === 'place' ? input.end.tripPlaceId : null,
      },
    });
    await markTripPlacesAsStay(
      tripId,
      [input.start, input.end].map((end) => (end.mode === 'place' ? end.tripPlaceId : null)),
      tx,
    );
    await refreshDayDefaultTimeZone(tx, tripId, dayId);
    return { revision: input.expectedRevision + 1 };
  });
}
