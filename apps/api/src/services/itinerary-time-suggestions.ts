import { createHash } from 'node:crypto';
import { getPrismaClient, type Prisma } from '@trove/db';
import type { ItineraryDayTimeSuggestions, SchedulingOutcome } from '@trove/types';
import {
  buildItineraryRoutePlan,
  createSummary,
  type RoutePoint,
  type ItineraryRouteSegment,
} from './itinerary-route-reader.js';
import {
  durationMinutesUntilLocalEnd,
  floatingLocalTimeToInstant,
  formatInstantInTimeZone,
  parseLocalTime,
} from './itinerary-rules.js';
import {
  ItineraryConflictError,
  ItineraryNotFoundError,
  ItineraryValidationError,
} from './itineraries.js';
import {
  DEFAULT_DAY_START_MINUTE,
  type SuggestedTimeWindow,
} from './itinerary-time-suggestions-rules.js';
import { scheduleItinerary, type SchedulingItem } from './itinerary-scheduling-rules.js';
import { estimateLegMinutes } from './plan-score-estimates.js';
import { placeProfile } from './plan-score-place-types.js';
import { elapsedLocalMinute } from './plan-score-normalization.js';
import { dayPartWindow } from './day-part-windows.js';
import { resolveDayStay, toStayAccommodations } from './day-stay.js';
import {
  buildScoringDay,
  discardExpiredCurrentHours,
  loadPlaceEvidence,
  mergeScoringPlaceIdentity,
  PLAN_SCORE_TRIP_INCLUDE,
  readPlanScoreInputs,
  type PlanScoreTripRecord,
} from './plan-score.js';
import { readCachedPlaceEvidence } from './place-evidence-cache.js';
import { readCachedRoute } from './route-evidence-cache.js';
import { timeZoneAtCoordinates } from './coordinate-time-zone.js';

export type { ItineraryDayTimeSuggestion, ItineraryDayTimeSuggestions } from '@trove/types';
export type RequestedSchedule = 'afternoon' | 'anytime' | 'evening' | 'exact' | 'morning' | 'none';
export type CandidateStop = {
  durationMinutes: number | null;
  tripPlaceId: string | null;
  position?: number;
};
export const CANDIDATE_ITEM_ID = 'candidate';
export type TimingSuggestionOptions = {
  candidate?: CandidateStop;
  itemId?: string;
  schedule?: RequestedSchedule;
  durationMinutes?: number | null;
  localTime?: string;
  localEndTime?: string;
};
const dayParts: Record<RequestedSchedule, string | null> = {
  afternoon: 'AFTERNOON',
  anytime: 'ANYTIME',
  evening: 'EVENING',
  exact: null,
  morning: 'MORNING',
  none: null,
};
const mode = (value: string) => value.toLowerCase() as ItineraryRouteSegment['mode'];
const protectedItem = (item: {
  reservationCount: number;
  timeSemantics: string | null;
  travelStatus?: string;
}) =>
  item.reservationCount > 0 ||
  item.timeSemantics === 'AUTHORITATIVE_INSTANT' ||
  ['COMPLETED', 'SKIPPED'].includes(item.travelStatus ?? '');

/** Stored evidence only. Virtual chains are rebuilt, never borrowed from a different order. */
async function assessDay(
  userId: string,
  tripId: string,
  dayId: string,
  options: TimingSuggestionOptions,
  prisma: Prisma.TransactionClient,
  now: Date,
  reconcile = false,
) {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, ownerId: userId },
    include: { ...PLAN_SCORE_TRIP_INCLUDE, startingPlace: { include: { providerRefs: true } } },
  });
  if (!trip) throw new ItineraryNotFoundError('trip_not_found');
  const dayRow = trip.itineraryDays.find((day) => day.id === dayId);
  const storedInputs = readPlanScoreInputs(trip, now);
  const storedDay = storedInputs.days.find((day) => day.id === dayId);
  if (!storedDay || !dayRow) throw new ItineraryNotFoundError('itinerary_day_not_found');
  if (options.itemId && !storedDay.items.some((item) => item.id === options.itemId))
    throw new ItineraryNotFoundError('itinerary_item_not_found');
  const targetId = options.candidate ? CANDIDATE_ITEM_ID : options.itemId;
  const day = {
    ...storedDay,
    items: storedDay.items.map((item) => {
      if (item.id !== targetId || reconcile || protectedItem(item)) return { ...item };
      const duration =
        options.durationMinutes !== undefined ? options.durationMinutes : item.durationMinutes;
      return {
        ...item,
        durationMinutes: duration,
        durationProvenance:
          options.durationMinutes != null && options.durationMinutes !== item.durationMinutes
            ? 'USER_OWNED'
            : item.durationProvenance,
        dayPart: options.schedule !== undefined ? dayParts[options.schedule] : item.dayPart,
        localStartTime: null,
        startInstant: null,
        timeProvenance: null,
        timingFlexibility: 'FLEXIBLE',
        timeSemantics: null,
      };
    }),
  };
  if (options.candidate) {
    const candidate = options.candidate;
    day.items.splice(Math.min(candidate.position ?? day.items.length, day.items.length), 0, {
      blockType: null,
      dayPart: options.schedule ? dayParts[options.schedule] : null,
      durationMinutes: options.durationMinutes ?? candidate.durationMinutes,
      durationProvenance: 'USER_OWNED',
      id: CANDIDATE_ITEM_ID,
      localStartTime: null,
      reservationCount: 0,
      startInstant: null,
      timeSemantics: null,
      timeProvenance: null,
      timingFlexibility: 'FLEXIBLE',
      timeZone: null,
      tripPlaceId: trip.tripPlaces.some((row) => row.id === candidate.tripPlaceId)
        ? candidate.tripPlaceId
        : null,
    });
  }
  const places = [
    ...trip.tripPlaces.map((row) => ({ id: row.id, place: row.place })),
    ...(trip.startingPlace ? [{ id: trip.startingPlace.id, place: trip.startingPlace }] : []),
  ];
  const evidence = await loadPlaceEvidence(
    places.map((row) => ({
      id: row.id,
      externalPlaceId:
        row.place.providerRefs.find((ref) => ref.provider === 'GOOGLE')?.externalPlaceId ?? null,
    })),
    now,
    (request, at) =>
      readCachedPlaceEvidence(request, at, { languageIndependent: true, client: prisma }),
  );
  for (const row of places) {
    const merged = mergeScoringPlaceIdentity(row.id, row.place, evidence.places.get(row.id), now);
    evidence.places.set(row.id, merged.place);
    const hours = evidence.hours.get(row.id);
    if (hours && !hours.timeZone && merged.place.coordinates)
      hours.timeZone = timeZoneAtCoordinates(merged.place.coordinates);
  }
  discardExpiredCurrentHours(evidence.hours, now);
  for (const item of day.items)
    if (item.id === CANDIDATE_ITEM_ID && item.tripPlaceId) {
      const coordinates = evidence.places.get(item.tripPlaceId)?.coordinates;
      item.timeZone = coordinates ? timeZoneAtCoordinates(coordinates) : day.timeZone;
    }
  if (targetId && options.localTime && options.localEndTime) {
    const target = day.items.find((item) => item.id === targetId)!;
    try {
      target.durationProvenance = 'USER_OWNED';
      target.durationMinutes = durationMinutesUntilLocalEnd(
        options.localTime,
        options.localEndTime,
        { date: day.date, timeZone: target.timeZone ?? day.timeZone },
      );
    } catch {
      throw new ItineraryValidationError('invalid_local_end_time');
    }
  }
  const point = (id: string, kind: RoutePoint['kind'], placeId: string | null): RoutePoint => ({
    id,
    kind,
    label: null,
    coordinates: (placeId && evidence.places.get(placeId)?.coordinates) || {
      latitude: NaN,
      longitude: NaN,
    },
  });
  const stay = resolveDayStay(
    {
      ...dayRow,
      dailyBaseTripPlace: trip.tripPlaces.find((p) => p.id === dayRow.dailyBaseTripPlaceId) ?? null,
      dailyBaseDepartureTripPlace:
        trip.tripPlaces.find((p) => p.id === dayRow.dailyBaseDepartureTripPlaceId) ?? null,
    },
    toStayAccommodations(
      trip.reservations
        .filter((r) => r.type === 'ACCOMMODATION')
        .map((r) => ({
          ...r,
          tripPlace: trip.tripPlaces.find((p) => p.id === r.tripPlaceId) ?? null,
        })),
    ),
  );
  const routeContext = {
    arrivalBase: stay.start ? point(stay.start.place.id, 'daily_base', stay.start.place.id) : null,
    departureBase: stay.end ? point(stay.end.place.id, 'daily_base', stay.end.place.id) : null,
    dayId,
    dayStartMode: mode(dayRow.routeStartTravelMode),
    startingLocation:
      !stay.start && dayRow.date.getTime() === trip.startDate.getTime() && trip.startingPlace
        ? point(trip.startingPlace.id, 'starting_location', trip.startingPlace.id)
        : null,
  };
  const routeItems = (items: typeof day.items) =>
    items.map((item) => ({
      point: point(item.id, 'itinerary_item', item.tripPlaceId),
      mode: mode(dayRow.items.find((row) => row.id === item.id)?.travelModeToNext ?? 'DRIVE'),
    }));
  const plans = buildItineraryRoutePlan({ ...routeContext, items: routeItems(day.items) });
  const baselinePlans = options.candidate
    ? buildItineraryRoutePlan({ ...routeContext, items: routeItems(storedDay.items) })
    : plans;
  const cacheReads = new Map<string, Promise<Awaited<ReturnType<typeof readCachedRoute>> | null>>();
  const cachedRoute = (plan: (typeof plans)[number]) => {
    const request = {
      origin: plan.origin.coordinates,
      destination: plan.destination.coordinates,
      mode: plan.mode,
    };
    if (
      plan.mode === 'flight' ||
      ![
        request.origin.latitude,
        request.origin.longitude,
        request.destination.latitude,
        request.destination.longitude,
      ].every(Number.isFinite)
    )
      return Promise.resolve(null);
    const cacheKey = JSON.stringify(request);
    let read = cacheReads.get(cacheKey);
    if (!read) {
      read = readCachedRoute({ ...request, mode: plan.mode }, now, prisma);
      cacheReads.set(cacheKey, read);
    }
    return read;
  };

  const segments = await Promise.all(
    plans.map(async (plan): Promise<ItineraryRouteSegment> => {
      const local = plan.mode !== 'flight';
      const located = [
        plan.origin.coordinates.latitude,
        plan.origin.coordinates.longitude,
        plan.destination.coordinates.latitude,
        plan.destination.coordinates.longitude,
      ].every(Number.isFinite);
      const cached = await cachedRoute(plan);
      const route = cached?.kind === 'hit' && cached.result.status === 'ok' ? cached.result : null;
      const estimate =
        !route && local && located
          ? estimateLegMinutes(plan.origin.coordinates, plan.destination.coordinates, plan.mode)
          : null;
      const { coordinates: _from, ...origin } = plan.origin;
      const { coordinates: _to, ...destination } = plan.destination;
      return {
        id: `${origin.kind}:${origin.id}:${destination.kind}:${destination.id}`,
        origin,
        destination,
        mode: plan.mode,
        modeOwner: plan.modeOwner,
        scope: local ? 'local' : 'long_distance',
        status: route ? 'ok' : local ? 'unavailable' : 'not_estimated',
        durationSeconds:
          route?.estimate.durationSeconds ?? (estimate === null ? null : estimate * 60),
        distanceMeters: route?.estimate.distanceMeters ?? null,
        encodedPolyline: null,
        provider: route ? 'google' : null,
        reason: null,
        ...(estimate !== null ? { estimated: true } : {}),
        ...(route ? { evidenceAsOf: route.freshness.fetchedAt } : {}),
      };
    }),
  );
  const routes = {
    generatedAt: now.toISOString(),
    segments,
    summary: createSummary(segments, day.items.length, false),
  };
  const record: PlanScoreTripRecord = {
    days: [day],
    hours: evidence.hours,
    mustGoTripPlaceIds: [],
    places: evidence.places,
    preferences: trip.planningPreferences,
    ratings: evidence.ratings,
    routes: new Map([[day.id, routes]]),
  };
  const scoring = buildScoringDay(day, record, {});
  const targets = new Set(
    targetId
      ? [targetId]
      : scoring.items.filter((item) => !item.start && !item.fixed).map((item) => item.id),
  );
  const items: SchedulingItem[] = scoring.items.map((item, index) => {
    const original = day.items[index]!;
    const profile = placeProfile(item.placeId ? evidence.places.get(item.placeId)?.types : null);
    const typical =
      !item.blockType || item.blockType === 'activity' ? profile?.visit?.typical : null;
    const intent = !item.fixed ? dayPartWindow(original.dayPart) : null;
    const startWindow = intent
      ? {
          earliestMinute: elapsedLocalMinute(
            day.date,
            original.timeZone ?? day.timeZone,
            intent.startMinute,
            scoring.origin,
          ),
          latestMinute: elapsedLocalMinute(
            day.date,
            original.timeZone ?? day.timeZone,
            intent.endMinute,
            scoring.origin,
          ),
          source: 'ESTIMATED' as const,
        }
      : item.startWindow;
    const duration =
      item.duration ?? (typical ? { minutes: typical, source: 'ESTIMATED' as const } : null);
    let preferredWindows =
      profile &&
      Array.isArray(profile.windows) &&
      (profile.windowKind === 'EXPERIENCE' || item.openingHours.status !== 'KNOWN')
        ? (profile.windows as SuggestedTimeWindow[]).map((window) => ({
            ...window,
            startMinute: elapsedLocalMinute(
              day.date,
              original.timeZone ?? day.timeZone,
              window.startMinute,
              scoring.origin,
            ),
            endMinute: elapsedLocalMinute(
              day.date,
              original.timeZone ?? day.timeZone,
              window.endMinute,
              scoring.origin,
            ),
            ...(window.typicalMinute !== undefined
              ? {
                  typicalMinute: elapsedLocalMinute(
                    day.date,
                    original.timeZone ?? day.timeZone,
                    window.typicalMinute,
                    scoring.origin,
                  ),
                }
              : {}),
          }))
        : null;
    if (item.id === targetId && options.localTime && duration) {
      const preferred =
        (floatingLocalTimeToInstant(
          day.date,
          options.localTime,
          original.timeZone ?? day.timeZone,
        ).getTime() -
          scoring.origin) /
        60_000;
      preferredWindows = [
        {
          startMinute: preferred,
          endMinute: preferred + duration.minutes,
          typicalMinute: preferred,
        },
        ...(preferredWindows ?? []),
      ];
    }
    return {
      ...item,
      inboundRequired:
        item.inboundRequired ||
        segments.some(
          (segment) => segment.destination.id === item.id && segment.scope === 'long_distance',
        ),
      duration,
      startWindow,
      protected: protectedItem(original),
      preferredWindows,
    };
  });
  const returnLeg = segments.find((s) => s.destination.kind === 'daily_base');
  const result = scheduleItinerary({
    items,
    commitments: scoring.commitments,
    availability: scoring.availability,
    dayStartMinute: elapsedLocalMinute(
      day.date,
      day.timeZone,
      DEFAULT_DAY_START_MINUTE,
      scoring.origin,
    ),
    dayEndMinute: elapsedLocalMinute(day.date, day.timeZone, 1440, scoring.origin),
    returnTravel: {
      required: Boolean(returnLeg && scoring.availability),
      minutes: returnLeg?.durationSeconds == null ? null : returnLeg.durationSeconds / 60,
      estimated: returnLeg?.estimated,
    },
    targetIds: reconcile ? new Set(targetId ? [targetId] : []) : targets,
  });
  for (const item of day.items) {
    const linked = trip.reservations.filter((r) => r.itineraryItemId === item.id);
    if (
      item.startInstant &&
      linked.some((r) => {
        const departure = r.flightDepartureInstant ?? r.transportDepartureInstant;
        const localTime = r.localTime;
        return departure
          ? departure.getTime() !== item.startInstant!.getTime()
          : r.localDate?.toISOString().slice(0, 10) === day.date &&
              localTime &&
              (localTime.getUTCHours() !== item.localStartTime?.getUTCHours() ||
                localTime.getUTCMinutes() !== item.localStartTime?.getUTCMinutes());
      })
    )
      result.issues.push({
        itemId: item.id,
        code: 'FIXED_CONFLICT',
        references: linked.map((r) => r.id),
        severity: 'conflict',
      });
    if (
      linked.some((r) =>
        [r.localDate, r.transportDepartureLocalDate, r.flightDepartureLocalDate].some(
          (date) => date && date.toISOString().slice(0, 10) !== day.date,
        ),
      )
    )
      result.issues.push({
        itemId: item.id,
        code: 'BOOKING_DATE',
        references: linked.map((r) => r.id),
        severity: 'conflict',
      });
  }
  const routeEvidence = await Promise.all(baselinePlans.map(cachedRoute));
  const revision = createHash('sha256')
    .update(
      JSON.stringify({
        schedule: storedInputs.revision,
        routeEvidence,
        hours: [...evidence.hours],
        places: [...evidence.places],
      }),
    )
    .digest('hex');
  const suggestions = [...targets].map((itemId) => {
    const slot = result.slots.get(itemId);
    const item = day.items.find((i) => i.id === itemId)!;
    const timeZone =
      item.timeZone ??
      (item.tripPlaceId && evidence.hours.get(item.tripPlaceId)?.timeZone) ??
      day.timeZone;
    const startInstant = slot ? new Date(scoring.origin + slot.startMinute * 60000) : null;
    const endInstant = slot ? new Date(scoring.origin + slot.endMinute * 60000) : null;
    const issues = result.issues.filter((issue) => issue.itemId === itemId);
    const missing = issues
      .filter((issue) => issue.severity === 'review')
      .map((issue) => issue.code);
    const affectedItemIds = [...result.slots]
      .filter(
        ([id, slot]) =>
          id !== itemId &&
          scoring.items.find((i) => i.id === id)?.start &&
          scoring.items.find((i) => i.id === id)?.start?.minutes !== slot.startMinute,
      )
      .map(([id]) => id);
    return {
      itemId,
      affectedItemIds,
      localTime: startInstant ? formatInstantInTimeZone(startInstant, timeZone).time : null,
      localEndTime: endInstant ? formatInstantInTimeZone(endInstant, timeZone).time : null,
      durationMinutes:
        slot?.durationMinutes ??
        items.find((candidate) => candidate.id === itemId)?.duration?.minutes ??
        item.durationMinutes,
      durationProvenance:
        item.durationMinutes === null
          ? ('app_estimated' as const)
          : ['AI_ESTIMATED', 'APP_ESTIMATED'].includes(item.durationProvenance ?? '')
            ? (item.durationProvenance!.toLowerCase() as 'ai_estimated' | 'app_estimated')
            : ('user_owned' as const),
      timeZone,
      startInstant: startInstant?.toISOString() ?? null,
      endInstant: endInstant?.toISOString() ?? null,
      ...(slot
        ? { status: 'ok' as const, ...slot }
        : missing.length
          ? { status: 'insufficient_evidence' as const, missing }
          : { status: 'no_feasible_time' as const, blockedBy: issues.map((i) => i.code) }),
    };
  });
  return {
    response: {
      generatedAt: now.toISOString(),
      itineraryDayId: dayId,
      scheduleRevision: revision,
      suggestions,
      issues: result.issues,
    } satisfies ItineraryDayTimeSuggestions,
    result,
    day,
    scoring,
    items,
  };
}

export async function getItineraryDayTimeSuggestions(
  userId: string,
  tripId: string,
  dayId: string,
  options: TimingSuggestionOptions = {},
  services: { now?: Date; transaction?: Prisma.TransactionClient } = {},
): Promise<ItineraryDayTimeSuggestions> {
  return (
    await assessDay(
      userId,
      tripId,
      dayId,
      options,
      services.transaction ?? getPrismaClient(),
      services.now ?? new Date(),
    )
  ).response;
}

/** Called inside the structural edit's transaction. Unsolvable blocks never write neighbors. */
export async function reconcileItineraryTiming(
  transaction: Prisma.TransactionClient,
  userId: string,
  tripId: string,
  dayId: string,
  targetId?: string,
): Promise<SchedulingOutcome> {
  const assessment = await assessDay(
    userId,
    tripId,
    dayId,
    { itemId: targetId },
    transaction,
    new Date(),
    true,
  );
  const outcome: SchedulingOutcome = { changes: [], issues: assessment.result.issues };
  for (const item of assessment.day.items) {
    const normalized = assessment.items.find((i) => i.id === item.id)!;
    if (normalized.fixed || normalized.protected || (!item.localStartTime && item.id !== targetId))
      continue;
    const slot = assessment.result.slots.get(item.id);
    const clear = item.id === targetId && !slot && item.localStartTime;
    if (!slot && !clear) {
      if (item.id === targetId && item.durationMinutes === null && normalized.duration)
        await transaction.itineraryItem.update({
          where: { id: item.id },
          data: {
            durationMinutes: normalized.duration.minutes,
            durationProvenance: 'APP_ESTIMATED',
          },
        });
      continue;
    }
    const timeZone = item.timeZone ?? assessment.day.timeZone;
    const instant = slot ? new Date(assessment.scoring.origin + slot.startMinute * 60000) : null;
    const localTime = instant ? formatInstantInTimeZone(instant, timeZone).time : null;
    const localEndTime = slot
      ? formatInstantInTimeZone(
          new Date(assessment.scoring.origin + slot.endMinute * 60000),
          timeZone,
        ).time
      : null;
    const before = {
      localTime: item.localStartTime
        ? `${item.localStartTime.getUTCHours().toString().padStart(2, '0')}:${item.localStartTime.getUTCMinutes().toString().padStart(2, '0')}`
        : null,
      localEndTime: null as string | null,
    };
    if (before.localTime === localTime && item.durationMinutes === slot?.durationMinutes) continue;
    await transaction.itineraryItem.update({
      where: { id: item.id },
      data: {
        localStartTime: localTime ? parseLocalTime(localTime) : null,
        localEndTime: null,
        startInstant: instant,
        timeSemantics: localTime ? 'FLOATING_LOCAL' : null,
        ...(localTime
          ? {
              timeZone,
              timeZoneResolvedAt: new Date(),
              ...(!item.timeZone ? { timeZoneSource: 'DAY_DEFAULT' as const } : {}),
            }
          : {}),
        timingFlexibility: 'FLEXIBLE',
        timeProvenance: localTime ? 'APP_ESTIMATED' : null,
        ...(slot && item.durationMinutes === null
          ? { durationMinutes: slot.durationMinutes, durationProvenance: 'APP_ESTIMATED' }
          : {}),
      },
    });
    if (before.localTime && item.durationMinutes !== null)
      before.localEndTime = formatInstantInTimeZone(
        new Date(
          (item.startInstant?.getTime() ??
            assessment.scoring.origin + (normalized.start?.minutes ?? 0) * 60000) +
            item.durationMinutes * 60000,
        ),
        timeZone,
      ).time;
    outcome.changes.push({
      itemId: item.id,
      itineraryDayId: dayId,
      before,
      after: { localTime, localEndTime },
    });
  }
  return outcome;
}

export async function applyItineraryDayTiming(
  userId: string,
  tripId: string,
  dayId: string,
  input: { scheduleRevision: string; itemIds: string[] },
) {
  return getPrismaClient().$transaction(
    async (transaction) => {
      const current = await assessDay(userId, tripId, dayId, {}, transaction, new Date());
      if (current.response.scheduleRevision !== input.scheduleRevision)
        throw new ItineraryConflictError('itinerary_schedule_conflict');
      const selected = new Set(input.itemIds);
      if (
        selected.size !== input.itemIds.length ||
        input.itemIds.some(
          (id) => !current.response.suggestions.some((s) => s.itemId === id && s.status === 'ok'),
        )
      )
        throw new ItineraryConflictError('itinerary_schedule_conflict');
      // Resolve selected rows together; unselected untimed stops remain review barriers.
      for (const suggestion of current.response.suggestions) {
        if (!selected.has(suggestion.itemId)) continue;
        await transaction.itineraryItem.update({
          where: { id: suggestion.itemId },
          data: {
            localStartTime: parseLocalTime(suggestion.localTime!),
            startInstant: new Date(suggestion.startInstant!),
            localEndTime: null,
            durationMinutes: suggestion.durationMinutes,
            durationProvenance:
              suggestion.durationProvenance === 'app_estimated'
                ? 'APP_ESTIMATED'
                : suggestion.durationProvenance === 'ai_estimated'
                  ? 'AI_ESTIMATED'
                  : 'USER_OWNED',
            timeSemantics: 'FLOATING_LOCAL',
            timeProvenance: 'APP_ESTIMATED',
            timingFlexibility: 'FLEXIBLE',
            timeZone: suggestion.timeZone,
            timeZoneResolvedAt: new Date(),
            ...(!current.day.items.find((item) => item.id === suggestion.itemId)?.timeZone
              ? { timeZoneSource: 'DAY_DEFAULT' as const }
              : {}),
          },
        });
      }
      const adjusted = await reconcileItineraryTiming(transaction, userId, tripId, dayId);
      if (
        adjusted.issues.some((issue) => selected.has(issue.itemId) && issue.severity !== 'notice')
      )
        throw new ItineraryConflictError('itinerary_schedule_conflict');
      const changes = new Map(
        current.response.suggestions
          .filter((s) => selected.has(s.itemId))
          .map((s) => [
            s.itemId,
            {
              itemId: s.itemId,
              itineraryDayId: dayId,
              before: { localTime: null as string | null, localEndTime: null as string | null },
              after: { localTime: s.localTime, localEndTime: s.localEndTime ?? null },
            },
          ]),
      );
      for (const change of adjusted.changes)
        changes.set(change.itemId, {
          ...change,
          before: changes.get(change.itemId)?.before ?? change.before,
        });
      return { scheduling: { changes: [...changes.values()], issues: adjusted.issues } };
    },
    { isolationLevel: 'Serializable' },
  );
}
