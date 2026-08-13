import { getPrismaClient, type Prisma } from '@trove/db';

import {
  floatingLocalTimeToInstant,
  formatLocalTime,
  parseLocalTime,
  resolveDayTimeZone,
  resolveItemTimeZone,
} from './itinerary-rules.js';
import { unlinkItineraryItemReferences } from './itinerary-item-deletion.js';
import { formatDateOnly, isValidIanaTimeZone } from './trip-rules.js';

export type ItineraryScheduleInput =
  | { kind: 'none' }
  | { dayPart: 'afternoon' | 'anytime' | 'evening' | 'morning'; kind: 'day_part' }
  | { kind: 'exact'; localTime: string };

export type ItineraryItemInput = {
  customLabel?: string | null;
  customLocation?: { label: string; timeZone?: string | null } | null;
  durationMinutes?: number | null;
  itineraryDayId?: string;
  notes?: string | null;
  plannedCost?: { amount: string; currencyCode: string } | null;
  priority?: 'interested' | 'maybe' | 'must_go' | null;
  schedule?: ItineraryScheduleInput;
  tripPlaceId?: string | null;
};

export class ItineraryNotFoundError extends Error {
  constructor(code: 'itinerary_day_not_found' | 'itinerary_item_not_found' | 'trip_not_found') {
    super(code);
  }
}

export class ItineraryValidationError extends Error {
  constructor(
    public readonly code:
      | 'invalid_itinerary_item'
      | 'invalid_local_time'
      | 'invalid_time_zone'
      | 'trip_place_not_found',
  ) {
    super(code);
  }
}

export const itineraryItemInclude = {
  itineraryDay: { select: { date: true, defaultTimeZone: true } },
  tripPlace: {
    include: {
      place: { include: { providerRefs: true } },
    },
  },
} as const;

type ItineraryItemRecord = Prisma.ItineraryItemGetPayload<{
  include: typeof itineraryItemInclude;
}>;

function mapDayPart(value: string | null) {
  const values: Record<string, 'afternoon' | 'anytime' | 'evening' | 'morning'> = {
    AFTERNOON: 'afternoon',
    ANYTIME: 'anytime',
    EVENING: 'evening',
    MORNING: 'morning',
  };
  return value ? (values[value] ?? null) : null;
}

function mapDayPartInput(value: 'afternoon' | 'anytime' | 'evening' | 'morning') {
  const values = {
    afternoon: 'AFTERNOON',
    anytime: 'ANYTIME',
    evening: 'EVENING',
    morning: 'MORNING',
  } as const;
  return values[value];
}

function mapPriority(value: string | null) {
  const values: Record<string, 'interested' | 'maybe' | 'must_go'> = {
    INTERESTED: 'interested',
    MAYBE: 'maybe',
    MUST_GO: 'must_go',
  };
  return value ? (values[value] ?? null) : null;
}

function mapPriorityInput(value: 'interested' | 'maybe' | 'must_go' | null) {
  const values = {
    interested: 'INTERESTED',
    maybe: 'MAYBE',
    must_go: 'MUST_GO',
  } as const;
  return value ? values[value] : null;
}

function mapTravelMode(value: string) {
  if (value === 'TRANSIT') return 'transit' as const;
  if (value === 'WALK') return 'walk' as const;
  return 'drive' as const;
}

function mapTravelStatus(value: string) {
  if (value === 'COMPLETED') return 'completed' as const;
  if (value === 'SKIPPED') return 'skipped' as const;
  return 'upcoming' as const;
}

function mapDayTimeZoneSource(value: string) {
  const values: Record<string, string> = {
    ACCOMMODATION: 'accommodation',
    EXPLICIT_DAILY_BASE: 'explicit_daily_base',
    FIRST_LOCATED_ITEM: 'first_located_item',
    TRIP_REFERENCE: 'trip_reference',
  };
  return values[value] ?? 'trip_reference';
}

function mapItemTimeZoneSource(value: string | null) {
  const values: Record<string, string> = {
    DAY_DEFAULT: 'day_default',
    EXPLICIT: 'explicit',
    PLACE: 'place',
  };
  return value ? (values[value] ?? null) : null;
}

function serializeTripPlace(tripPlace: NonNullable<ItineraryItemRecord['tripPlace']>) {
  const place = tripPlace.place;
  return {
    id: tripPlace.id,
    place: {
      id: place.id,
      kind: place.kind === 'CUSTOM' ? ('custom' as const) : ('provider' as const),
      location:
        place.customLatitude === null || place.customLongitude === null
          ? null
          : {
              latitude: place.customLatitude.toNumber(),
              longitude: place.customLongitude.toNumber(),
              timeZone: place.customTimeZone,
            },
      name: place.customName,
      note: place.customNote,
      providerRefs: place.providerRefs.map((reference) => ({
        externalPlaceId: reference.externalPlaceId,
        provider: 'google' as const,
      })),
      timeZone: place.customTimeZone,
    },
  };
}

export function serializeItineraryItem(item: ItineraryItemRecord) {
  return {
    createdAt: item.createdAt.toISOString(),
    customLabel: item.customLabel,
    customLocation: item.customLocation
      ? { label: item.customLocation, timeZone: item.customLocationTimeZone }
      : null,
    dayPart: mapDayPart(item.dayPart),
    durationMinutes: item.durationMinutes,
    id: item.id,
    itineraryDayId: item.itineraryDayId,
    localStartTime: formatLocalTime(item.localStartTime),
    notes: item.notes,
    plannedCost:
      item.plannedCostAmount && item.plannedCostCurrencyCode
        ? {
            amount: item.plannedCostAmount.toFixed(2),
            currencyCode: item.plannedCostCurrencyCode.trim(),
          }
        : null,
    position: item.position,
    priority: mapPriority(item.priority),
    startInstant: item.startInstant?.toISOString() ?? null,
    timeSemantics:
      item.timeSemantics === 'AUTHORITATIVE_INSTANT'
        ? ('authoritative_instant' as const)
        : item.timeSemantics === 'FLOATING_LOCAL'
          ? ('floating_local' as const)
          : null,
    timeZone: item.timeZone,
    timeZoneSource: mapItemTimeZoneSource(item.timeZoneSource),
    travelModeToNext: mapTravelMode(item.travelModeToNext),
    travelStatus: mapTravelStatus(item.travelStatus),
    tripPlace: item.tripPlace ? serializeTripPlace(item.tripPlace) : null,
    updatedAt: item.updatedAt.toISOString(),
  };
}

async function findOwnedTrip(
  transaction: Prisma.TransactionClient,
  userId: string,
  tripId: string,
) {
  const trip = await transaction.trip.findFirst({
    where: { id: tripId, ownerId: userId },
    select: {
      endDate: true,
      id: true,
      name: true,
      referenceTimeZone: true,
      startDate: true,
    },
  });
  if (!trip) throw new ItineraryNotFoundError('trip_not_found');
  return trip;
}

async function findDay(
  transaction: Prisma.TransactionClient,
  tripId: string,
  itineraryDayId: string,
) {
  const day = await transaction.itineraryDay.findFirst({
    where: { id: itineraryDayId, tripId },
    select: { date: true, defaultTimeZone: true, id: true },
  });
  if (!day) throw new ItineraryNotFoundError('itinerary_day_not_found');
  return day;
}

async function findTripPlace(
  transaction: Prisma.TransactionClient,
  tripId: string,
  tripPlaceId: string | null,
) {
  if (!tripPlaceId) return null;
  const tripPlace = await transaction.tripPlace.findFirst({
    where: { id: tripPlaceId, tripId },
    include: { place: true },
  });
  if (!tripPlace) throw new ItineraryValidationError('trip_place_not_found');
  return tripPlace;
}

function normalizeLocation(value: ItineraryItemInput['customLocation']) {
  if (!value) return { label: null, timeZone: null };
  const label = value.label.trim();
  const timeZone = value.timeZone?.trim() || null;
  if (!label) throw new ItineraryValidationError('invalid_itinerary_item');
  if (timeZone && !isValidIanaTimeZone(timeZone)) {
    throw new ItineraryValidationError('invalid_time_zone');
  }
  return { label, timeZone };
}

function normalizeContent(customLabel: string | null | undefined, tripPlaceId: string | null) {
  const label = customLabel?.trim() || null;
  if (!label && !tripPlaceId) throw new ItineraryValidationError('invalid_itinerary_item');
  return label;
}

function scheduleData(schedule: ItineraryScheduleInput, date: string, timeZone: string) {
  if (schedule.kind === 'none') {
    return {
      dayPart: null,
      localStartTime: null,
      startInstant: null,
      timeSemantics: null,
    };
  }
  if (schedule.kind === 'day_part') {
    return {
      dayPart: mapDayPartInput(schedule.dayPart),
      localStartTime: null,
      startInstant: null,
      timeSemantics: null,
    };
  }

  try {
    return {
      dayPart: null,
      localStartTime: parseLocalTime(schedule.localTime),
      startInstant: floatingLocalTimeToInstant(date, schedule.localTime, timeZone),
      timeSemantics: 'FLOATING_LOCAL' as const,
    };
  } catch {
    throw new ItineraryValidationError('invalid_local_time');
  }
}

export async function refreshDayDefaultTimeZone(
  transaction: Prisma.TransactionClient,
  tripId: string,
  itineraryDayId: string,
  excludeItemId?: string,
) {
  const day = await transaction.itineraryDay.findFirst({
    where: { id: itineraryDayId, tripId },
    include: {
      dailyBaseTripPlace: { include: { place: true } },
      items: {
        where: excludeItemId ? { id: { not: excludeItemId } } : undefined,
        include: { tripPlace: { include: { place: true } } },
        orderBy: { position: 'asc' },
      },
      accommodationReservations: {
        include: {
          reservation: {
            include: { tripPlace: { include: { place: true } } },
          },
        },
      },
      trip: { select: { referenceTimeZone: true } },
    },
  });
  if (!day) throw new ItineraryNotFoundError('itinerary_day_not_found');

  const resolution = resolveDayTimeZone({
    accommodations: day.accommodationReservations.map(({ reservation }) => ({
      timeZone: reservation.tripPlace?.place.customTimeZone ?? null,
      tripPlaceId: reservation.tripPlaceId,
    })),
    dailyBase: day.dailyBaseTripPlace
      ? {
          timeZone: day.dailyBaseTripPlace.place.customTimeZone,
          tripPlaceId: day.dailyBaseTripPlace.id,
        }
      : null,
    items: day.items.map((item) => ({
      customLocationTimeZone: item.customLocationTimeZone,
      id: item.id,
      tripPlaceId: item.tripPlaceId,
      tripPlaceTimeZone: item.tripPlace?.place.customTimeZone ?? null,
    })),
    tripTimeZone: day.trip.referenceTimeZone,
  });

  if (
    day.defaultTimeZone !== resolution.timeZone ||
    day.defaultTimeZoneSource !== resolution.source ||
    day.defaultTimeZoneSourceItemId !== resolution.sourceItemId ||
    day.defaultTimeZoneSourceTripPlaceId !== resolution.sourceTripPlaceId
  ) {
    await transaction.itineraryDay.update({
      where: { id: day.id },
      data: {
        defaultTimeZone: resolution.timeZone,
        defaultTimeZoneResolvedAt: new Date(),
        defaultTimeZoneSource: resolution.source,
        defaultTimeZoneSourceItemId: resolution.sourceItemId,
        defaultTimeZoneSourceTripPlaceId: resolution.sourceTripPlaceId,
      },
    });
  }
}

export async function listItinerary(userId: string, tripId: string) {
  const prisma = getPrismaClient();
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, ownerId: userId },
    select: {
      endDate: true,
      id: true,
      name: true,
      referenceTimeZone: true,
      startDate: true,
      itineraryDays: {
        include: {
          dailyBaseTripPlace: true,
          items: { include: itineraryItemInclude, orderBy: { position: 'asc' } },
        },
        orderBy: { date: 'asc' },
      },
      itineraryItems: {
        where: { itineraryDayId: null },
        include: itineraryItemInclude,
        orderBy: { position: 'asc' },
      },
      tripPlaces: {
        include: { place: { include: { providerRefs: true } } },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      },
    },
  });
  if (!trip) throw new ItineraryNotFoundError('trip_not_found');

  return {
    days: trip.itineraryDays.map((day) => ({
      date: formatDateOnly(day.date),
      defaultTimeZone: day.defaultTimeZone,
      defaultTimeZoneSource: mapDayTimeZoneSource(day.defaultTimeZoneSource),
      defaultTimeZoneSourceTripPlaceId: day.defaultTimeZoneSourceTripPlaceId,
      dailyBaseTripPlaceId: day.dailyBaseTripPlaceId,
      id: day.id,
      items: day.items.map(serializeItineraryItem),
      notes: day.notes,
      routeStartTravelMode: mapTravelMode(day.routeStartTravelMode),
    })),
    trip: {
      endDate: formatDateOnly(trip.endDate),
      id: trip.id,
      name: trip.name,
      referenceTimeZone: trip.referenceTimeZone,
      startDate: formatDateOnly(trip.startDate),
    },
    tripPlaces: trip.tripPlaces.map((tripPlace) => serializeTripPlace(tripPlace)),
    unscheduledItems: trip.itineraryItems.map(serializeItineraryItem),
  };
}

export async function organizeItineraryItem(
  userId: string,
  tripId: string,
  itemId: string,
  input: { itineraryDayId: string | null; position: number },
) {
  const prisma = getPrismaClient();
  await prisma.$transaction(async (transaction) => {
    await findOwnedTrip(transaction, userId, tripId);
    const current = await transaction.itineraryItem.findFirst({
      where: { id: itemId, tripId },
      include: itineraryItemInclude,
    });
    if (!current) throw new ItineraryNotFoundError('itinerary_item_not_found');
    const targetDay = input.itineraryDayId
      ? await findDay(transaction, tripId, input.itineraryDayId)
      : null;
    const siblings = await transaction.itineraryItem.findMany({
      where: {
        id: { not: itemId },
        itineraryDayId: input.itineraryDayId,
        tripId,
      },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    const position = Math.min(Math.max(input.position, 0), siblings.length);
    siblings.splice(position, 0, { id: itemId });
    await Promise.all(
      siblings.map((item, index) =>
        transaction.itineraryItem.update({ where: { id: item.id }, data: { position: index } }),
      ),
    );

    const movingDay = current.itineraryDayId !== input.itineraryDayId;
    const targetTripPlace = movingDay
      ? await findTripPlace(transaction, tripId, current.tripPlaceId)
      : null;
    const timeZone = targetDay
      ? resolveItemTimeZone({
          customLocationTimeZone: current.customLocationTimeZone,
          dayTimeZone: targetDay.defaultTimeZone,
          tripPlaceTimeZone: targetTripPlace?.place.customTimeZone ?? null,
        })
      : null;
    const schedule =
      targetDay && current.localStartTime && current.timeSemantics === 'FLOATING_LOCAL' && timeZone
        ? scheduleData(
            { kind: 'exact', localTime: formatLocalTime(current.localStartTime) ?? '' },
            formatDateOnly(targetDay.date),
            timeZone.timeZone,
          )
        : null;
    await transaction.itineraryItem.update({
      where: { id: itemId },
      data: {
        itineraryDayId: input.itineraryDayId,
        position,
        ...(timeZone
          ? {
              startInstant: schedule?.startInstant ?? current.startInstant,
              timeZone: timeZone.timeZone,
              timeZoneResolvedAt: new Date(),
              timeZoneSource: timeZone.source,
            }
          : {}),
      },
    });
    if (current.itineraryDayId)
      await refreshDayDefaultTimeZone(transaction, tripId, current.itineraryDayId);
    if (targetDay && targetDay.id !== current.itineraryDayId) {
      await refreshDayDefaultTimeZone(transaction, tripId, targetDay.id);
    }
  });
}

export async function duplicateItineraryItem(userId: string, tripId: string, itemId: string) {
  const prisma = getPrismaClient();
  await prisma.$transaction(async (transaction) => {
    await findOwnedTrip(transaction, userId, tripId);
    const current = await transaction.itineraryItem.findFirst({ where: { id: itemId, tripId } });
    if (!current) throw new ItineraryNotFoundError('itinerary_item_not_found');
    const maxPosition = await transaction.itineraryItem.aggregate({
      where: { itineraryDayId: current.itineraryDayId, tripId },
      _max: { position: true },
    });
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...copy } = current;
    await transaction.itineraryItem.create({
      data: {
        ...copy,
        position: (maxPosition._max.position ?? -1) + 1,
        travelStatus: 'UPCOMING',
      },
    });
  });
}

export async function setItineraryDayBase(
  userId: string,
  tripId: string,
  itineraryDayId: string,
  tripPlaceId: string | null,
) {
  const prisma = getPrismaClient();
  await prisma.$transaction(async (transaction) => {
    await findOwnedTrip(transaction, userId, tripId);
    await findDay(transaction, tripId, itineraryDayId);
    await findTripPlace(transaction, tripId, tripPlaceId);
    await transaction.itineraryDay.update({
      where: { id: itineraryDayId },
      data: { dailyBaseTripPlaceId: tripPlaceId },
    });
    await refreshDayDefaultTimeZone(transaction, tripId, itineraryDayId);
  });
}

export async function updateItineraryDayNote(
  userId: string,
  tripId: string,
  itineraryDayId: string,
  note: string | null,
) {
  const prisma = getPrismaClient();
  const result = await prisma.$transaction(async (transaction) => {
    await findOwnedTrip(transaction, userId, tripId);
    const day = await findDay(transaction, tripId, itineraryDayId);
    return transaction.itineraryDay.update({
      where: { id: day.id },
      data: { notes: note?.trim() || null },
      select: { id: true, notes: true },
    });
  });
  return { id: result.id, notes: result.notes };
}

export async function createItineraryItem(
  userId: string,
  tripId: string,
  input: ItineraryItemInput & { itineraryDayId: string; schedule: ItineraryScheduleInput },
) {
  const prisma = getPrismaClient();
  const itemId = await prisma.$transaction(async (transaction) => {
    await findOwnedTrip(transaction, userId, tripId);
    const day = await findDay(transaction, tripId, input.itineraryDayId);
    const tripPlace = await findTripPlace(transaction, tripId, input.tripPlaceId ?? null);
    const customLabel = normalizeContent(input.customLabel, tripPlace?.id ?? null);
    const customLocation = normalizeLocation(input.customLocation);
    const timeZone = resolveItemTimeZone({
      customLocationTimeZone: customLocation.timeZone,
      dayTimeZone: day.defaultTimeZone,
      tripPlaceTimeZone: tripPlace?.place.customTimeZone ?? null,
    });
    const position =
      (
        await transaction.itineraryItem.aggregate({
          where: { itineraryDayId: day.id, tripId },
          _max: { position: true },
        })
      )._max.position ?? -1;
    const schedule = scheduleData(input.schedule, formatDateOnly(day.date), timeZone.timeZone);
    const item = await transaction.itineraryItem.create({
      data: {
        customLabel,
        customLocation: customLocation.label,
        customLocationTimeZone: customLocation.timeZone,
        dayPart: schedule.dayPart,
        durationMinutes: input.durationMinutes ?? null,
        itineraryDayId: day.id,
        localStartTime: schedule.localStartTime,
        notes: input.notes?.trim() || null,
        plannedCostAmount: input.plannedCost?.amount ?? null,
        plannedCostCurrencyCode: input.plannedCost?.currencyCode ?? null,
        position: position + 1,
        priority: mapPriorityInput(input.priority ?? null),
        startInstant: schedule.startInstant,
        timeSemantics: schedule.timeSemantics,
        timeZone: timeZone.timeZone,
        timeZoneResolvedAt: new Date(),
        timeZoneSource: timeZone.source,
        tripId,
        tripPlaceId: tripPlace?.id ?? null,
      },
    });
    await refreshDayDefaultTimeZone(transaction, tripId, day.id);
    return item.id;
  });

  const item = await prisma.itineraryItem.findFirst({
    where: { id: itemId, trip: { ownerId: userId }, tripId },
    include: itineraryItemInclude,
  });
  if (!item) throw new ItineraryNotFoundError('itinerary_item_not_found');
  return serializeItineraryItem(item);
}

export async function updateItineraryItem(
  userId: string,
  tripId: string,
  itemId: string,
  input: ItineraryItemInput,
) {
  const prisma = getPrismaClient();
  const result = await prisma.$transaction(async (transaction) => {
    await findOwnedTrip(transaction, userId, tripId);
    const current = await transaction.itineraryItem.findFirst({
      where: { id: itemId, tripId },
      include: itineraryItemInclude,
    });
    if (!current || !current.itineraryDayId || !current.itineraryDay) {
      throw new ItineraryNotFoundError('itinerary_item_not_found');
    }

    const tripPlaceId = input.tripPlaceId === undefined ? current.tripPlaceId : input.tripPlaceId;
    const tripPlace = await findTripPlace(transaction, tripId, tripPlaceId);
    const customLabel = normalizeContent(
      input.customLabel === undefined ? current.customLabel : input.customLabel,
      tripPlace?.id ?? null,
    );
    const customLocation =
      input.customLocation === undefined
        ? {
            label: current.customLocation,
            timeZone: current.customLocationTimeZone,
          }
        : normalizeLocation(input.customLocation);
    const previousLocalTime = formatLocalTime(current.localStartTime);
    const nextLocalTime =
      input.schedule?.kind === 'exact'
        ? input.schedule.localTime
        : input.schedule
          ? null
          : previousLocalTime;
    const shouldResolveTimeZone =
      tripPlaceId !== current.tripPlaceId ||
      customLocation.label !== current.customLocation ||
      customLocation.timeZone !== current.customLocationTimeZone ||
      nextLocalTime !== previousLocalTime;
    const timeZone = shouldResolveTimeZone
      ? resolveItemTimeZone({
          customLocationTimeZone: customLocation.timeZone,
          dayTimeZone: current.itineraryDay.defaultTimeZone,
          tripPlaceTimeZone: tripPlace?.place.customTimeZone ?? null,
        })
      : {
          source: current.timeZoneSource ?? ('DAY_DEFAULT' as const),
          timeZone: current.timeZone ?? current.itineraryDay.defaultTimeZone,
        };
    const schedule = input.schedule
      ? scheduleData(input.schedule, formatDateOnly(current.itineraryDay.date), timeZone.timeZone)
      : current.localStartTime && current.timeSemantics === 'FLOATING_LOCAL'
        ? scheduleData(
            { kind: 'exact', localTime: formatLocalTime(current.localStartTime) ?? '' },
            formatDateOnly(current.itineraryDay.date),
            timeZone.timeZone,
          )
        : {
            dayPart: current.dayPart,
            localStartTime: current.localStartTime,
            startInstant: current.startInstant,
            timeSemantics: current.timeSemantics,
          };

    const updated = await transaction.itineraryItem.update({
      where: { id: itemId },
      data: {
        customLabel,
        customLocation: customLocation.label,
        customLocationTimeZone: customLocation.timeZone,
        dayPart: schedule.dayPart,
        ...(input.durationMinutes !== undefined ? { durationMinutes: input.durationMinutes } : {}),
        localStartTime: schedule.localStartTime,
        ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
        ...(input.plannedCost !== undefined
          ? {
              plannedCostAmount: input.plannedCost?.amount ?? null,
              plannedCostCurrencyCode: input.plannedCost?.currencyCode ?? null,
            }
          : {}),
        ...(input.priority !== undefined ? { priority: mapPriorityInput(input.priority) } : {}),
        startInstant: schedule.startInstant,
        timeSemantics: schedule.timeSemantics,
        ...(shouldResolveTimeZone || !current.timeZone
          ? {
              timeZone: timeZone.timeZone,
              timeZoneResolvedAt: new Date(),
              timeZoneSource: timeZone.source,
            }
          : {}),
        tripPlaceId: tripPlace?.id ?? null,
      },
      include: itineraryItemInclude,
    });
    await refreshDayDefaultTimeZone(transaction, tripId, current.itineraryDayId);

    const previousInstant = current.startInstant?.toISOString() ?? null;
    const nextInstant = updated.startInstant?.toISOString() ?? null;
    return {
      item: serializeItineraryItem(updated),
      timeZoneConsequence:
        previousInstant && nextInstant && previousInstant !== nextInstant
          ? {
              kind: 'derived_instant_changed' as const,
              previousStartInstant: previousInstant,
              startInstant: nextInstant,
            }
          : null,
    };
  });

  return result;
}

export async function deleteItineraryItem(userId: string, tripId: string, itemId: string) {
  const prisma = getPrismaClient();
  await prisma.$transaction(async (transaction) => {
    await findOwnedTrip(transaction, userId, tripId);
    const item = await transaction.itineraryItem.findFirst({
      where: { id: itemId, tripId },
      select: { id: true, itineraryDayId: true },
    });
    if (!item) throw new ItineraryNotFoundError('itinerary_item_not_found');
    if (item.itineraryDayId) {
      await refreshDayDefaultTimeZone(transaction, tripId, item.itineraryDayId, item.id);
    }
    await unlinkItineraryItemReferences(transaction, tripId, item.id);
    await transaction.itineraryItem.delete({ where: { id: item.id } });
  });
}
