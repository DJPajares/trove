import { derivedPlanInstant } from './itinerary-local-timing.js';
import { PLAN_SCORE_TRIP_INCLUDE } from './plan-score-trip-query.js';
import { createHash } from 'node:crypto';
import { getPrismaClient, type Prisma } from '@trove/db';
import type {
  ItineraryDayTimeSuggestions,
  SchedulingOutcome,
  TimingRepairOptions,
} from '@trove/types';
import {
  buildItineraryRoutePlan,
  createSummary,
  type RoutePoint,
  type ItineraryRouteSegment,
} from './itinerary-route-reader.js';
import { durationMinutesUntilLocalEnd, parseLocalTime } from './itinerary-rules.js';
import {
  ItineraryConflictError,
  ItineraryNotFoundError,
  ItineraryValidationError,
} from './itineraries.js';
import {
  DEFAULT_DAY_START_MINUTE,
  type SuggestedTimeWindow,
} from './itinerary-time-suggestions-rules.js';
import {
  scheduleItinerary,
  suggestScheduledTarget,
  type SchedulingInput,
  type SchedulingItem,
  type SchedulingResult,
} from './itinerary-scheduling-rules.js';
import { estimateLegMinutes } from './plan-score-estimates.js';
import { placeProfile } from './plan-score-place-types.js';
import { planningMinute, planningTime, planningLocalDateTime } from './planning-clock.js';
import { dayPartWindow } from './day-part-windows.js';
import { resolveDayStay, toStayAccommodations } from './day-stay.js';
import {
  buildScoringDay,
  discardExpiredCurrentHours,
  loadPlaceEvidence,
  mergeScoringPlaceIdentity,
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
export const TIMING_TRIP_INCLUDE = {
  ...PLAN_SCORE_TRIP_INCLUDE,
  startingPlace: { include: { providerRefs: true } },
  itineraryItems: {
    where: { itineraryDayId: null },
    include: { _count: { select: { reservations: true } } },
    orderBy: { position: 'asc' },
  },
} satisfies Prisma.TripInclude;
export type TimingTrip = Prisma.TripGetPayload<{ include: typeof TIMING_TRIP_INCLUDE }>;

export async function assessDay(
  userId: string,
  tripId: string,
  dayId: string,
  options: TimingSuggestionOptions,
  prisma: Prisma.TransactionClient,
  now: Date,
  reconcile = false,
  movement?: { trip: TimingTrip; targetIds?: ReadonlySet<string>; validateOnly?: boolean },
) {
  const trip =
    movement?.trip ??
    (await prisma.trip.findFirst({
      where: { id: tripId, ownerId: userId },
      include: TIMING_TRIP_INCLUDE,
    }));
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
        dayPart:
          options.schedule !== undefined
            ? dayParts[options.schedule]
            : item.localStartTime
              ? null
              : item.dayPart,
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
    trip,
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
    // Like scoring, exact slots supersede retained coarse intent. Reapplying
    // that intent as a hard window after a move makes a valid slot look broken.
    const intent = !item.fixed && !item.start ? dayPartWindow(original.dayPart) : null;
    const startWindow = intent
      ? {
          earliestMinute: intent.startMinute,
          latestMinute: intent.endMinute,
          source: 'ESTIMATED' as const,
        }
      : item.startWindow;
    const duration =
      item.duration ?? (typical ? { minutes: typical, source: 'ESTIMATED' as const } : null);
    let preferredWindows =
      profile &&
      Array.isArray(profile.windows) &&
      (profile.windowKind === 'EXPERIENCE' || item.openingHours.status !== 'KNOWN')
        ? (profile.windows as SuggestedTimeWindow[])
        : null;
    const preferredTime =
      options.localTime ??
      (original.id === targetId
        ? storedDay.items
            .find((i) => i.id === targetId)
            ?.localStartTime?.toISOString()
            .slice(11, 16)
        : undefined);
    if (item.id === targetId && preferredTime && duration) {
      const preferred = planningMinute(preferredTime);
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
      protected: protectedItem(original) || Boolean(movement?.validateOnly && item.start),
      preferredWindows,
    };
  });
  const returnLeg = segments.find((s) => s.destination.kind === 'daily_base');
  const returnTravel = {
    required: Boolean(returnLeg && scoring.availability),
    minutes: returnLeg?.durationSeconds == null ? null : returnLeg.durationSeconds / 60,
    estimated: returnLeg?.estimated,
  };
  const schedulingInput: SchedulingInput = {
    items,
    commitments: scoring.commitments,
    availability: scoring.availability,
    dayStartMinute: DEFAULT_DAY_START_MINUTE,
    dayEndMinute: 1440,
    returnTravel,
    targetIds: movement?.targetIds ?? (reconcile ? new Set(targetId ? [targetId] : []) : targets),
    allowDayPartAdjustment: reconcile,
  };
  const result =
    targetId && targetId !== CANDIDATE_ITEM_ID && !reconcile
      ? suggestScheduledTarget(schedulingInput, targetId)
      : scheduleItinerary(schedulingInput);
  for (const issue of result.issues) {
    if (issue.code !== 'FIXED_CONFLICT' || issue.references.length !== 1) continue;
    const conflict = result.orderConflicts.get(issue.itemId);
    if (!conflict) continue;
    issue.orderConflict = {
      previousItemId: conflict.previousItemId,
      earliestStartLocal: planningLocalDateTime(day.date, Math.ceil(conflict.earliest)),
      scheduledStartLocal: planningLocalDateTime(day.date, conflict.scheduled),
    };
  }
  for (const item of day.items) {
    const linked = trip.reservations.filter((r) => r.itineraryItemId === item.id);
    if (
      item.localStartTime &&
      linked.some((r) => {
        const localTime =
          r.flightDepartureLocalTime ?? r.transportDepartureLocalTime ?? r.localTime;
        return (
          localTime &&
          (localTime.getUTCHours() !== item.localStartTime!.getUTCHours() ||
            localTime.getUTCMinutes() !== item.localStartTime!.getUTCMinutes())
        );
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
  const suggestionFor = (itemId: string, result: SchedulingResult) => {
    const slot = result.slots.get(itemId);
    const item = day.items.find((i) => i.id === itemId)!;
    const timeZone =
      item.timeZone ??
      (item.tripPlaceId && evidence.hours.get(item.tripPlaceId)?.timeZone) ??
      day.timeZone;
    const issues = result.issues.filter(
      (issue) => issue.itemId === itemId || issue.references.includes(itemId),
    );
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
    const original = storedDay.items.find((row) => row.id === itemId);
    const repair: TimingRepairOptions = {
      schedule:
        itemId === targetId && options.schedule !== undefined
          ? options.schedule
          : original?.localStartTime
            ? 'exact'
            : ((original?.dayPart?.toLowerCase() as RequestedSchedule) ?? 'none'),
      ...(item.durationMinutes !== null ? { durationMinutes: item.durationMinutes } : {}),
      ...(itemId === targetId && options.localTime
        ? { localTime: options.localTime }
        : original?.localStartTime
          ? { localTime: original.localStartTime.toISOString().slice(11, 16) }
          : {}),
      ...(itemId === targetId && options.localEndTime
        ? { localEndTime: options.localEndTime }
        : {}),
    };
    return {
      itemId,
      affectedItemIds,
      ...(slot && original && affectedItemIds.length
        ? {
            review: {
              itineraryDayId: dayId,
              scheduleRevision: revision,
              targetItemId: itemId,
              repair,
            },
          }
        : {}),
      localTime: slot ? planningTime(slot.startMinute) : null,
      localEndTime: slot ? planningTime(slot.endMinute) : null,
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
      ...(slot
        ? { status: 'ok' as const, ...slot }
        : missing.length
          ? { status: 'insufficient_evidence' as const, missing }
          : { status: 'no_feasible_time' as const, blockedBy: issues.map((i) => i.code) }),
    };
  };
  const suggestions = [...targets].map((id) => suggestionFor(id, result));
  const repairs = new Map<string, SchedulingResult>();
  for (const issue of result.issues) {
    if (issue.severity !== 'conflict' || items.find((item) => item.id === issue.itemId)?.protected)
      continue;
    let repair = repairs.get(issue.itemId);
    if (!repair)
      repairs.set(issue.itemId, (repair = suggestScheduledTarget(schedulingInput, issue.itemId)));
    issue.suggestion = suggestionFor(issue.itemId, repair);
  }
  return {
    response: {
      generatedAt: now.toISOString(),
      itineraryDayId: dayId,
      scheduleRevision: revision,
      suggestions,
      issues: result.issues,
    } satisfies ItineraryDayTimeSuggestions,
    result,
    originalDay: storedDay,
    returnTravel,
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

async function planItineraryTiming(
  transaction: Prisma.TransactionClient,
  userId: string,
  tripId: string,
  dayId: string,
  targetId?: string,
  repair?: TimingRepairOptions,
) {
  if (repair && !targetId) throw new ItineraryValidationError('invalid_itinerary_item');
  const assessment = await assessDay(
    userId,
    tripId,
    dayId,
    { ...repair, itemId: targetId },
    transaction,
    new Date(),
    !repair,
  );
  const writes = new Map<string, Prisma.ItineraryItemUpdateInput>();
  const outcome: SchedulingOutcome = { changes: [], issues: assessment.result.issues };
  const sourceDay = repair ? assessment.originalDay : assessment.day;
  for (const item of sourceDay.items) {
    const normalized = assessment.items.find((i) => i.id === item.id)!;
    if (repair && !assessment.result.slots.has(targetId!)) continue;
    if (
      (!repair && normalized.fixed) ||
      normalized.protected ||
      (!item.localStartTime && item.id !== targetId)
    )
      continue;
    const slot = assessment.result.slots.get(item.id);
    const clear = !repair && item.id === targetId && !slot && item.localStartTime;
    if (!slot && !clear) {
      if (item.id === targetId && item.durationMinutes === null && normalized.duration)
        writes.set(item.id, {
          durationMinutes: normalized.duration.minutes,
          durationProvenance: 'APP_ESTIMATED',
        });
      continue;
    }
    const timeZone = item.timeZone ?? assessment.day.timeZone;
    const localTime = slot ? planningTime(slot.startMinute) : null;
    const localEndTime = slot ? planningTime(slot.endMinute) : null;
    const instant = localTime ? derivedPlanInstant(sourceDay.date, localTime, timeZone) : null;
    const before = {
      localTime: item.localStartTime
        ? `${item.localStartTime.getUTCHours().toString().padStart(2, '0')}:${item.localStartTime.getUTCMinutes().toString().padStart(2, '0')}`
        : null,
      localEndTime: null as string | null,
    };
    if (before.localTime === localTime && item.durationMinutes === slot?.durationMinutes) continue;
    writes.set(item.id, {
      localStartTime: localTime ? parseLocalTime(localTime) : null,
      localEndTime: null,
      startInstant: instant,
      timeSemantics: localTime ? 'FLOATING_LOCAL' : null,
      ...(localTime
        ? {
            timeZone,
            timeZoneResolvedAt: new Date(),
            ...(item.timeZoneSource
              ? { timeZoneSource: item.timeZoneSource as 'PLACE' | 'EXPLICIT' | 'DAY_DEFAULT' }
              : !item.timeZone
                ? { timeZoneSource: 'DAY_DEFAULT' as const }
                : {}),
          }
        : {}),
      timingFlexibility: repair
        ? ((item.timingFlexibility as 'FIXED' | 'FLEXIBLE' | null) ??
          (['AI_ESTIMATED', 'APP_ESTIMATED'].includes(item.timeProvenance ?? '')
            ? 'FLEXIBLE'
            : 'FIXED'))
        : 'FLEXIBLE',
      timeProvenance: localTime ? 'APP_ESTIMATED' : null,
      ...(slot &&
      (item.durationMinutes === null || (repair && item.durationMinutes !== slot.durationMinutes))
        ? {
            durationMinutes: slot.durationMinutes,
            durationProvenance: item.durationMinutes === null ? 'APP_ESTIMATED' : 'USER_OWNED',
          }
        : {}),
    });
    if (before.localTime && item.durationMinutes !== null)
      before.localEndTime = planningTime(planningMinute(before.localTime) + item.durationMinutes);
    outcome.changes.push({
      itemId: item.id,
      itineraryDayId: dayId,
      before,
      after: { localTime, localEndTime },
    });
  }
  const reviewRevision = createHash('sha256')
    .update(
      JSON.stringify({
        revision: assessment.response.scheduleRevision,
        targetItemId: targetId ?? null,
        repair,
        changes: outcome.changes,
      }),
    )
    .digest('hex');
  return { outcome, writes, reviewRevision };
}

/** Legacy callers may reconcile immediately; review callers receive a read-only proposal. */
export async function reconcileItineraryTiming(
  transaction: Prisma.TransactionClient,
  userId: string,
  tripId: string,
  dayId: string,
  targetId?: string,
  review = false,
  repair?: TimingRepairOptions,
): Promise<SchedulingOutcome> {
  const { outcome, writes, reviewRevision } = await planItineraryTiming(
    transaction,
    userId,
    tripId,
    dayId,
    targetId,
    repair,
  );
  if (review)
    return {
      ...outcome,
      proposals: [
        {
          itineraryDayId: dayId,
          scheduleRevision: reviewRevision,
          targetItemId: targetId ?? null,
          ...(repair ? { repair } : {}),
        },
      ],
    };
  for (const [id, data] of writes) await transaction.itineraryItem.update({ where: { id }, data });
  return outcome;
}

export async function getItineraryTimingReview(
  userId: string,
  tripId: string,
  dayId: string,
  targetId?: string,
  repair?: TimingRepairOptions,
) {
  return reconcileItineraryTiming(getPrismaClient(), userId, tripId, dayId, targetId, true, repair);
}

/** Applies only the reviewed rows, atomically; dependent rows require explicit group acceptance. */
export async function applyItineraryTimingReview(
  userId: string,
  tripId: string,
  dayId: string,
  input: {
    scheduleRevision: string;
    itemIds: string[];
    targetItemId?: string | null;
    repair?: TimingRepairOptions;
  },
) {
  return getPrismaClient().$transaction(
    async (transaction) => {
      const target = input.targetItemId ?? undefined;
      const { outcome, writes, reviewRevision } = await planItineraryTiming(
        transaction,
        userId,
        tripId,
        dayId,
        target,
        input.repair,
      );
      const selected = new Set(input.itemIds);
      if (
        reviewRevision !== input.scheduleRevision ||
        !selected.size ||
        selected.size !== input.itemIds.length ||
        input.itemIds.some((id) => !outcome.changes.some((change) => change.itemId === id))
      )
        throw new ItineraryConflictError('itinerary_schedule_conflict');
      if (
        input.repair &&
        (selected.size !== outcome.changes.length ||
          outcome.changes.some((change) => !selected.has(change.itemId)))
      )
        throw new ItineraryConflictError('itinerary_timing_group_required');
      for (const id of selected)
        await transaction.itineraryItem.update({ where: { id }, data: writes.get(id)! });
      // Pin every remaining exact slot while checking this selection. Never save
      // unreviewed neighbor changes to make an individual suggestion succeed.
      const trip = await transaction.trip.findFirst({
        where: { id: tripId, ownerId: userId },
        include: TIMING_TRIP_INCLUDE,
      });
      if (!trip) throw new ItineraryNotFoundError('trip_not_found');
      const validated = await assessDay(userId, tripId, dayId, {}, transaction, new Date(), false, {
        trip,
        validateOnly: true,
      });
      const related = (issue: import('@trove/types').TimingIssue) =>
        selected.has(issue.itemId) || issue.references.some((id) => selected.has(id));
      if (validated.result.issues.some((issue) => issue.severity === 'conflict' && related(issue)))
        throw new ItineraryConflictError('itinerary_timing_group_required');
      const scheduling = await reconcileItineraryTiming(
        transaction,
        userId,
        tripId,
        dayId,
        target,
        true,
        input.repair,
      );
      return {
        scheduling,
        applied: outcome.changes.filter((change) => selected.has(change.itemId)),
      };
    },
    { isolationLevel: 'Serializable' },
  );
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
            startInstant: derivedPlanInstant(
              current.day.date,
              suggestion.localTime!,
              suggestion.timeZone,
            ),
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
