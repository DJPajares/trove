import { getPrismaClient, Prisma } from '@trove/db';
import type { AiPlannerDraft, AiPlannerDraftItem, AiPlannerDraftPlace } from '@trove/types';

import { floatingLocalTimeToInstant, parseLocalTime } from './itinerary-rules.js';
import {
  AiPlanningSessionError,
  loadAiPlanningSessionForApplyInTransaction,
} from './ai-planning-sessions.js';
import {
  enumerateDateRange,
  isValidIanaTimeZone,
  parseDateOnly,
  resolveCountryPrimaryTimeZone,
  resolveTripTimeZone,
} from './trip-rules.js';

type ApplyPrisma = ReturnType<typeof getPrismaClient>;

type ApplyOptions = {
  now?: () => Date;
  prisma?: ApplyPrisma;
};

type AppliedPlace = {
  id: string;
  timeZone: string | null;
};

const priorityRank = { interested: 2, maybe: 1, must_go: 3 } as const;

function mapPriority(value: AiPlannerDraftItem['priority']) {
  const values = {
    interested: 'INTERESTED',
    maybe: 'MAYBE',
    must_go: 'MUST_GO',
  } as const;
  return value ? values[value] : null;
}

function mapDayPart(item: AiPlannerDraftItem) {
  if (item.schedule.kind !== 'day_part') return null;
  const values = {
    afternoon: 'AFTERNOON',
    anytime: 'ANYTIME',
    evening: 'EVENING',
    morning: 'MORNING',
  } as const;
  return values[item.schedule.dayPart];
}

function strongestPriority(items: readonly AiPlannerDraftItem[]) {
  const priority = items
    .map((item) => item.priority)
    .filter((value): value is NonNullable<AiPlannerDraftItem['priority']> => value !== null)
    .toSorted((left, right) => priorityRank[right] - priorityRank[left])[0];
  return mapPriority(priority ?? null);
}

function referencedPlaceIds(draft: AiPlannerDraft) {
  const ids = new Set(draft.trip.destinations.map((destination) => destination.placeRefId));
  for (const day of draft.days) {
    if (day.dailyBasePlaceRefId) ids.add(day.dailyBasePlaceRefId);
    if (day.dailyBaseDeparturePlaceRefId) ids.add(day.dailyBaseDeparturePlaceRefId);
    for (const item of day.items) if (item.placeRefId) ids.add(item.placeRefId);
  }
  for (const item of draft.unscheduledItems) if (item.placeRefId) ids.add(item.placeRefId);
  return ids;
}

function tripPlaceReferenceIds(draft: AiPlannerDraft) {
  const ids = new Set<string>();
  for (const day of draft.days) {
    if (day.dailyBasePlaceRefId) ids.add(day.dailyBasePlaceRefId);
    if (day.dailyBaseDeparturePlaceRefId) ids.add(day.dailyBaseDeparturePlaceRefId);
    for (const item of day.items) if (item.placeRefId) ids.add(item.placeRefId);
  }
  for (const item of draft.unscheduledItems) if (item.placeRefId) ids.add(item.placeRefId);
  return ids;
}

function placeTimeZone(input: {
  customTimeZone: string | null;
  draftPlace: AiPlannerDraftPlace;
  providerAddress: string | null;
}) {
  return (
    input.customTimeZone ??
    resolveCountryPrimaryTimeZone(input.providerAddress ?? '') ??
    resolveCountryPrimaryTimeZone(input.draftPlace.name)
  );
}

async function materializePlaces(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  draft: AiPlannerDraft,
) {
  const draftPlaces = new Map(draft.places.map((place) => [place.id, place]));
  const referencedIds = referencedPlaceIds(draft);
  const verified = [...referencedIds]
    .map((id) => draftPlaces.get(id))
    .filter(
      (place): place is Extract<AiPlannerDraftPlace, { resolution: 'verified' }> =>
        place?.resolution === 'verified',
    );
  const storedVerified = await transaction.place.findMany({
    where: { id: { in: [...new Set(verified.map((place) => place.placeId))] } },
    select: {
      customTimeZone: true,
      id: true,
      kind: true,
      ownerId: true,
      providerAddress: true,
    },
  });
  const storedById = new Map(storedVerified.map((place) => [place.id, place]));
  if (storedById.size !== new Set(verified.map((place) => place.placeId)).size) {
    throw new AiPlanningSessionError('draft_invalid', 409);
  }

  const places = new Map<string, AppliedPlace>();
  for (const refId of referencedIds) {
    const draftPlace = draftPlaces.get(refId);
    if (!draftPlace) throw new AiPlanningSessionError('draft_invalid', 409);

    if (draftPlace.resolution === 'verified') {
      const stored = storedById.get(draftPlace.placeId);
      if (!stored || stored.kind !== 'PROVIDER' || stored.ownerId !== null) {
        throw new AiPlanningSessionError('draft_invalid', 409);
      }
      places.set(refId, {
        id: stored.id,
        timeZone: placeTimeZone({
          customTimeZone: stored.customTimeZone,
          draftPlace,
          providerAddress: stored.providerAddress,
        }),
      });
      continue;
    }

    const timeZone = resolveCountryPrimaryTimeZone(draftPlace.name);
    const created = await transaction.place.create({
      data: {
        customName: draftPlace.name.trim(),
        customNote: draftPlace.note?.trim() || null,
        customTimeZone: timeZone,
        kind: 'CUSTOM',
        ownerId,
      },
      select: { id: true },
    });
    places.set(refId, { id: created.id, timeZone });
  }

  return places;
}

function requirePlace(places: Map<string, AppliedPlace>, referenceId: string) {
  const place = places.get(referenceId);
  if (!place) throw new AiPlanningSessionError('draft_invalid', 409);
  return place;
}

function itemTimeZone(
  item: AiPlannerDraftItem,
  places: Map<string, AppliedPlace>,
  fallback: string,
) {
  if (!item.placeRefId) return { source: 'DAY_DEFAULT' as const, timeZone: fallback };
  const place = requirePlace(places, item.placeRefId);
  return place.timeZone
    ? { source: 'PLACE' as const, timeZone: place.timeZone }
    : { source: 'DAY_DEFAULT' as const, timeZone: fallback };
}

function itemData(input: {
  dayDate: string | null;
  dayTimeZone: string;
  item: AiPlannerDraftItem;
  now: Date;
  places: Map<string, AppliedPlace>;
  position: number;
  tripId: string;
  tripPlaceIds: Map<string, string>;
}) {
  const { item } = input;
  const timeZone = itemTimeZone(item, input.places, input.dayTimeZone);
  const exactTime = item.schedule.kind === 'exact' ? item.schedule.localTime : null;
  try {
    return {
      customLabel: item.label.trim(),
      dayPart: mapDayPart(item),
      durationMinutes: item.durationMinutes,
      durationProvenance:
        item.durationProvenance === 'ai_estimated'
          ? ('AI_ESTIMATED' as const)
          : ('USER_OWNED' as const),
      localStartTime: exactTime ? parseLocalTime(exactTime) : null,
      notes: item.notes?.trim() || null,
      position: input.position,
      priority: mapPriority(item.priority),
      startInstant:
        exactTime && input.dayDate
          ? floatingLocalTimeToInstant(input.dayDate, exactTime, timeZone.timeZone)
          : null,
      timeSemantics: exactTime ? ('FLOATING_LOCAL' as const) : null,
      timeZone: timeZone.timeZone,
      timeZoneResolvedAt: input.now,
      timeZoneSource: timeZone.source,
      tripId: input.tripId,
      tripPlaceId: item.placeRefId ? (input.tripPlaceIds.get(item.placeRefId) ?? null) : null,
    };
  } catch {
    throw new AiPlanningSessionError('draft_invalid', 409);
  }
}

export async function applyAiPlanningSession(
  ownerId: string,
  sessionId: string,
  expectedRevision: number,
  deviceTimeZone = 'UTC',
  options: ApplyOptions = {},
) {
  if (!isValidIanaTimeZone(deviceTimeZone)) {
    throw new AiPlanningSessionError('invalid_time_zone', 400);
  }

  const prisma = options.prisma ?? getPrismaClient();
  const now = options.now?.() ?? new Date();

  const outcome = await prisma.$transaction(async (transaction) => {
    const loaded = await loadAiPlanningSessionForApplyInTransaction(
      transaction,
      ownerId,
      sessionId,
      expectedRevision,
      now,
    );
    if (typeof loaded === 'symbol') return { kind: 'expired' as const };
    if (loaded.kind === 'applied') {
      return { kind: 'applied' as const, tripId: loaded.tripId };
    }

    const { draft } = loaded;
    if (draft.warnings.some((warning) => warning.material) && !loaded.warningAcknowledged) {
      throw new AiPlanningSessionError('warnings_not_acknowledged', 409);
    }

    const profile = await transaction.profile.findUniqueOrThrow({
      where: { id: ownerId },
      include: { homePlace: true },
    });
    const places = await materializePlaces(transaction, ownerId, draft);
    const destinations = draft.trip.destinations.map((destination) => ({
      ...requirePlace(places, destination.placeRefId),
      referenceId: destination.placeRefId,
    }));
    if (new Set(destinations.map((place) => place.id)).size !== destinations.length) {
      throw new AiPlanningSessionError('draft_invalid', 409);
    }
    const tripTimeZone = resolveTripTimeZone({
      destinations: destinations.map((place) => ({ placeId: place.id, timeZone: place.timeZone })),
      deviceTimeZone,
      profileHome: profile.homePlace
        ? { placeId: profile.homePlace.id, timeZone: profile.homePlace.customTimeZone }
        : null,
      startingLocation: null,
    });
    const trip = await transaction.trip.create({
      data: {
        creatorId: ownerId,
        endDate: parseDateOnly(draft.trip.endDate),
        name: draft.trip.name.trim(),
        ownerId,
        partySize: draft.trip.partySize,
        planningReadiness: 'IN_PROGRESS',
        referenceTimeZone: tripTimeZone.timeZone,
        referenceTimeZoneSource: tripTimeZone.source,
        referenceTimeZoneSourcePlaceId: tripTimeZone.sourcePlaceId,
        startDate: parseDateOnly(draft.trip.startDate),
      },
      select: { id: true },
    });

    if (destinations.length) {
      await transaction.tripDestination.createMany({
        data: destinations.map((place, position) => ({
          placeId: place.id,
          position,
          timeZone: place.timeZone,
          timeZoneResolvedAt: place.timeZone ? now : null,
          tripId: trip.id,
        })),
      });
    }

    const allItems = [...draft.days.flatMap((day) => day.items), ...draft.unscheduledItems];
    const tripPlaceIds = new Map<string, string>();
    const tripPlaceIdsByPlace = new Map<string, string>();
    for (const referenceId of tripPlaceReferenceIds(draft)) {
      const place = requirePlace(places, referenceId);
      const existingId = tripPlaceIdsByPlace.get(place.id);
      if (existingId) {
        tripPlaceIds.set(referenceId, existingId);
        continue;
      }
      const created = await transaction.tripPlace.create({
        data: {
          placeId: place.id,
          priority: strongestPriority(
            allItems.filter(
              (item) => item.placeRefId && requirePlace(places, item.placeRefId).id === place.id,
            ),
          ),
          tripId: trip.id,
        },
        select: { id: true },
      });
      tripPlaceIdsByPlace.set(place.id, created.id);
      tripPlaceIds.set(referenceId, created.id);
    }

    const draftDays = new Map(draft.days.map((day) => [day.date, day]));
    for (const date of enumerateDateRange(draft.trip.startDate, draft.trip.endDate)) {
      const day = draftDays.get(date);
      if (!day) throw new AiPlanningSessionError('draft_invalid', 409);
      const dailyBase = day.dailyBasePlaceRefId
        ? requirePlace(places, day.dailyBasePlaceRefId)
        : null;
      const firstLocatedItem = day.items.find(
        (item) => item.placeRefId && requirePlace(places, item.placeRefId).timeZone,
      );
      const firstItemPlace = firstLocatedItem?.placeRefId
        ? requirePlace(places, firstLocatedItem.placeRefId)
        : null;
      const defaultTimeZone =
        dailyBase?.timeZone ?? firstItemPlace?.timeZone ?? tripTimeZone.timeZone;
      const defaultSource = dailyBase?.timeZone
        ? ('EXPLICIT_DAILY_BASE' as const)
        : firstItemPlace?.timeZone
          ? ('FIRST_LOCATED_ITEM' as const)
          : ('TRIP_REFERENCE' as const);
      const created = await transaction.itineraryDay.create({
        data: {
          dailyBaseDepartureTripPlaceId: day.dailyBaseDeparturePlaceRefId
            ? (tripPlaceIds.get(day.dailyBaseDeparturePlaceRefId) ?? null)
            : null,
          dailyBaseTripPlaceId: day.dailyBasePlaceRefId
            ? (tripPlaceIds.get(day.dailyBasePlaceRefId) ?? null)
            : null,
          date: parseDateOnly(date),
          defaultTimeZone,
          defaultTimeZoneResolvedAt: now,
          defaultTimeZoneSource: defaultSource,
          defaultTimeZoneSourceTripPlaceId:
            defaultSource === 'EXPLICIT_DAILY_BASE' && day.dailyBasePlaceRefId
              ? (tripPlaceIds.get(day.dailyBasePlaceRefId) ?? null)
              : null,
          tripId: trip.id,
        },
        select: { id: true },
      });
      for (const [position, item] of day.items.entries()) {
        const createdItem = await transaction.itineraryItem.create({
          data: {
            ...itemData({
              dayDate: date,
              dayTimeZone: defaultTimeZone,
              item,
              now,
              places,
              position,
              tripId: trip.id,
              tripPlaceIds,
            }),
            itineraryDayId: created.id,
          },
          select: { id: true },
        });
        if (defaultSource === 'FIRST_LOCATED_ITEM' && item.id === firstLocatedItem?.id) {
          await transaction.itineraryDay.update({
            where: { id: created.id },
            data: { defaultTimeZoneSourceItemId: createdItem.id },
          });
        }
      }
    }

    for (const [position, item] of draft.unscheduledItems.entries()) {
      await transaction.itineraryItem.create({
        data: itemData({
          dayDate: null,
          dayTimeZone: tripTimeZone.timeZone,
          item,
          now,
          places,
          position,
          tripId: trip.id,
          tripPlaceIds,
        }),
      });
    }

    const applied = await transaction.aiPlanningSession.updateMany({
      where: {
        appliedTripId: null,
        draftRevision: expectedRevision,
        id: sessionId,
        ownerId,
        status: 'REVIEWING',
      },
      data: {
        appliedTripId: trip.id,
        draft: Prisma.DbNull,
        lastErrorCode: null,
        rawPrompt: null,
        stage: 'COMPLETE',
        status: 'APPLIED',
        warningsAcknowledgedAt: null,
        warningsAcknowledgedRevision: null,
      },
    });
    if (applied.count !== 1) throw new AiPlanningSessionError('draft_conflict', 409);

    return { kind: 'applied' as const, tripId: trip.id };
  });

  if (outcome.kind === 'expired') throw new AiPlanningSessionError('session_expired', 410);
  return { tripId: outcome.tripId };
}
