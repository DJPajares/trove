import { getPrismaClient, type Prisma } from '@trove/db';
import {
  dayLocality,
  localityFromAddress,
  selectTripOverviewDay,
  type TripOverviewData,
  type TripOverviewStop,
} from '@trove/types';

import { resolveDayStay, stayAccommodationsInclude, toStayAccommodations } from './day-stay.js';

import { formatLocalTime, floatingLocalTimeToInstant } from './itinerary-rules.js';
import { placeProviderRefInclude, serializeCanonicalPlace } from './place-serializer.js';
import { itineraryItemInclude, serializeItineraryItem } from './itineraries.js';
import { resolveTripModeItemSelection, travellerItemStart } from './trip-mode-context.js';
import { createAuthenticatedSupabaseClient } from './supabase-auth.js';
import { selectTripMemoryPreview } from './trip-memory-preview.js';
import { createMemoryPreview, TripNotFoundError } from './trips.js';
import { deriveTripLifecycle, formatDateOnly, getLocalDate, shiftDateOnly } from './trip-rules.js';

const photoSelect = { id: true, path: true, contentType: true } as const;
type Item = Prisma.ItineraryItemGetPayload<{ include: typeof itineraryItemInclude }>;

function stop(
  item: Item,
  date: string,
  zone: string,
  kind: TripOverviewStop['kind'],
  now: Date,
): TripOverviewStop {
  const serialized = serializeItineraryItem(item, { now });
  const place = serialized.tripPlace;
  const instant = travellerItemStart(item, date, zone);
  return {
    id: item.id,
    // Never resurrect an expired provider label. Trove-owned labels and fresh snapshots only.
    label:
      item.customLabel ??
      place?.customName ??
      place?.place.name ??
      place?.place.snapshot?.name ??
      item.customLocation,
    localStartTime: formatLocalTime(item.localStartTime),
    startInstant: instant === null ? null : new Date(instant).toISOString(),
    kind,
  };
}

/** Some zones advance their clocks at midnight, skipping 00:00 entirely. */
function nextMidnight(zone: string, now: Date) {
  const date = shiftDateOnly(getLocalDate(now, zone), 1);
  for (const time of ['00:00', '01:00', '02:00']) {
    try {
      return floatingLocalTimeToInstant(date, time, zone).getTime();
    } catch {
      /* Try the first clock time that exists on the new date. */
    }
  }
  return now.getTime() + 60_000;
}

/**
 * Reads every day's shape, one selected day, three prints and three pinned
 * facts. No route or Place acquisition: towns are read from stored addresses.
 */
export async function getTripOverview(
  userId: string,
  accessToken: string,
  tripId: string,
  clockTimeZone: string,
  now = new Date(),
): Promise<TripOverviewData> {
  const prisma = getPrismaClient();
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, ownerId: userId },
    select: {
      startDate: true,
      endDate: true,
      referenceTimeZone: true,
      destinations: {
        orderBy: { position: 'asc' },
        include: { place: { include: placeProviderRefInclude } },
      },
      itineraryDays: {
        orderBy: { date: 'asc' },
        select: {
          id: true,
          name: true,
          date: true,
          dailyBaseTripPlaceId: true,
          dailyBaseDepartureTripPlaceId: true,
          items: { orderBy: { position: 'asc' }, select: { tripPlaceId: true } },
          _count: { select: { items: true } },
        },
      },
      tripPlaces: { select: { id: true, place: { include: placeProviderRefInclude } } },
      reservations: stayAccommodationsInclude({ select: { id: true } }),
      _count: { select: { tripPlaces: true } },
      tripInfoEntries: {
        where: { isPinned: true },
        orderBy: { updatedAt: 'desc' },
        take: 3,
        select: { id: true, label: true, value: true },
      },
    },
  });
  if (!trip) throw new TripNotFoundError();
  const lifecycle = deriveTripLifecycle(
    formatDateOnly(trip.startDate),
    formatDateOnly(trip.endDate),
    trip.referenceTimeZone,
    now,
  );
  const today = getLocalDate(now, clockTimeZone);
  // A day is named after the town it happens in, read the way the planner reads
  // it: its stay's address first, else the town most of its stops share.
  const addresses = new Map(
    trip.tripPlaces.map((row) => {
      const place = serializeCanonicalPlace(row.place, { now });
      return [row.id, place.snapshot?.address ?? place.providerAddress];
    }),
  );
  const accommodations = toStayAccommodations(trip.reservations);
  const dayTown = (day: (typeof trip.itineraryDays)[number]) => {
    const stay = resolveDayStay(
      {
        id: day.id,
        date: day.date,
        dailyBaseTripPlace: day.dailyBaseTripPlaceId ? { id: day.dailyBaseTripPlaceId } : null,
        dailyBaseDepartureTripPlace: day.dailyBaseDepartureTripPlaceId
          ? { id: day.dailyBaseDepartureTripPlaceId }
          : null,
      },
      accommodations,
    );
    const stayId = stay.end?.place.id ?? stay.start?.place.id ?? day.dailyBaseTripPlaceId;
    return (
      (stayId ? localityFromAddress(addresses.get(stayId)) : null) ??
      dayLocality(
        day.items.map((item) => (item.tripPlaceId ? addresses.get(item.tripPlaceId) : null)),
      )
    );
  };
  const days = trip.itineraryDays.map((day, index) => ({
    id: day.id,
    name: day.name,
    date: formatDateOnly(day.date),
    number: index + 1,
    stopCount: day._count.items,
    town: dayTown(day),
  }));
  const day = selectTripOverviewDay(days, lifecycle, today);
  const items = day
    ? await prisma.itineraryItem.findMany({
        where: { tripId, itineraryDayId: day.id },
        orderBy: { position: 'asc' },
        include: itineraryItemInclude,
      })
    : [];
  const open = items.filter((item) => item.travelStatus === 'UPCOMING');
  const selection =
    day && lifecycle === 'active'
      ? resolveTripModeItemSelection(open, day.date, clockTimeZone, now)
      : null;
  const current =
    selection?.currentOrRelevant && day
      ? stop(
          selection.currentOrRelevant.item,
          day.date,
          clockTimeZone,
          selection.currentOrRelevant.kind,
          now,
        )
      : null;
  const nextItem = lifecycle === 'planning' ? items[0] : selection?.nextItem;
  const next =
    nextItem && day
      ? stop(nextItem, day.date, clockTimeZone, lifecycle === 'planning' ? 'planned' : 'next', now)
      : null;
  const itemIds = [current?.id, next?.id].filter((id): id is string => Boolean(id));
  const taskWhere: Prisma.TaskWhereInput = {
    tripId,
    completedAt: null,
    ...(lifecycle === 'active'
      ? {
          OR: [
            ...(day ? [{ itineraryDayId: day.id }] : []),
            { itineraryItemId: { in: itemIds } },
            { dueDate: { lte: new Date(`${today}T00:00:00Z`) } },
          ],
        }
      : {}),
  };
  const [openCount, tasks, memories, note] = await Promise.all([
    lifecycle === 'completed' ? 0 : prisma.task.count({ where: taskWhere }),
    lifecycle === 'completed'
      ? []
      : prisma.task.findMany({
          where: taskWhere,
          orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
          take: 1,
          select: { id: true, label: true, dueDate: true },
        }),
    lifecycle === 'completed'
      ? prisma.trip.findFirst({
          where: { id: tripId, ownerId: userId },
          select: {
            storyCoverPhoto: { select: photoSelect },
            memories: {
              where: { photos: { some: {} } },
              orderBy: [
                { isHighlight: 'desc' },
                { highlightPosition: 'asc' },
                { capturedInstant: 'asc' },
              ],
              take: 4,
              select: { photos: { orderBy: { position: 'asc' }, take: 1, select: photoSelect } },
            },
          },
        })
      : null,
    lifecycle === 'completed'
      ? prisma.memory.findFirst({
          where: { tripId, note: { not: null } },
          orderBy: [{ isHighlight: 'desc' }, { capturedInstant: 'asc' }],
          select: { note: true },
        })
      : null,
  ]);
  // The lifecycle and device day can turn at different midnights. Refresh at both.
  const boundaries = [clockTimeZone, trip.referenceTimeZone].map((zone) => nextMidnight(zone, now));
  if (lifecycle === 'active' && day) {
    const starts = open
      .flatMap((item) => {
        const start = travellerItemStart(item, day.date, clockTimeZone);
        return start === null ? [] : [start];
      })
      .sort((a, b) => a - b);
    for (const item of open) {
      const start = travellerItemStart(item, day.date, clockTimeZone);
      if (start !== null)
        boundaries.push(
          start,
          start +
            (item.durationMinutes ??
              ((starts.find((candidate) => candidate > start) ?? start + 3_600_000) - start) /
                60_000) *
              60_000,
        );
    }
    for (const time of ['12:00', '17:00'])
      boundaries.push(floatingLocalTimeToInstant(today, time, clockTimeZone).getTime());
  }
  const refreshAt = new Date(
    Math.min(...boundaries.filter((at) => at > now.getTime())),
  ).toISOString();
  const firstTask = tasks[0];
  return {
    generatedAt: now.toISOString(),
    refreshAt,
    clockTimeZone,
    lifecycle,
    destinations: trip.destinations.map((destination) => {
      const place = serializeCanonicalPlace(destination.place, { now });
      return { id: destination.id, name: place.name ?? place.snapshot?.name ?? null };
    }),
    day: day
      ? {
          id: day.id,
          date: day.date,
          number: day.number,
          name: day.name,
          stopCount: day.stopCount,
          state:
            day.stopCount === 0
              ? 'empty'
              : lifecycle === 'active' && !current && !next
                ? 'finished'
                : 'planned',
          current,
          next,
        }
      : null,
    days,
    tripPlaceCount: trip._count.tripPlaces,
    tasks: {
      openCount,
      next: firstTask
        ? { ...firstTask, dueDate: firstTask.dueDate ? formatDateOnly(firstTask.dueDate) : null }
        : null,
    },
    memories: {
      photos: memories
        ? await createMemoryPreview(
            createAuthenticatedSupabaseClient(accessToken),
            selectTripMemoryPreview(memories.storyCoverPhoto, memories.memories),
          )
        : [],
      note: note?.note ?? null,
    },
    pinnedInfo: trip.tripInfoEntries,
  };
}
