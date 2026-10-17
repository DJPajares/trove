import { resolvePlannedItemTiming } from './itinerary-local-timing.js';
import { resolveDayStay, toStayAccommodations } from './day-stay.js';
import { movementConnectionConflicts } from './itinerary-movement-constraints.js';
import { createHash } from 'node:crypto';
import { getPrismaClient, type Prisma } from '@trove/db';
import type {
  MovementInput,
  MovementApplyInput,
  MovementProposal,
  MovementSlot,
  TimingIssue,
} from '@trove/types';
import { assessDay, TIMING_TRIP_INCLUDE, type TimingTrip } from './itinerary-time-suggestions.js';
import {
  ItineraryConflictError,
  ItineraryNotFoundError,
  ItineraryValidationError,
  listItinerary,
} from './itineraries.js';
import {
  durationMinutesUntilLocalEnd,
  floatingLocalTimeToInstant,
  formatInstantInTimeZone,
  formatLocalTime,
  parseLocalTime,
  resolveDayTimeZone,
  resolveItemTimeZone,
} from './itinerary-rules.js';
import { resolvedPlaceTimeZone } from './place-data.js';

type Item = TimingTrip['itineraryDays'][number]['items'][number];
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const allItems = (trip: TimingTrip) => [
  ...trip.itineraryDays.flatMap((d) => d.items),
  ...trip.itineraryItems,
];
const protectedTiming = (item: Item) =>
  item._count.reservations > 0 ||
  item.timeSemantics === 'AUTHORITATIVE_INSTANT' ||
  ['COMPLETED', 'SKIPPED'].includes(item.travelStatus);
const flexible = (item: Item) =>
  item.timingFlexibility === 'FLEXIBLE' ||
  (!item.timingFlexibility &&
    ['APP_ESTIMATED', 'AI_ESTIMATED'].includes(item.timeProvenance ?? ''));
const dateOf = (trip: TimingTrip, id: string | null) =>
  trip.itineraryDays
    .find((d) => d.id === id)
    ?.date.toISOString()
    .slice(0, 10) ?? null;
function slot(trip: TimingTrip, item: Item): MovementSlot {
  const date = dateOf(trip, item.itineraryDayId);
  const timeZone =
    item.timeZone ??
    trip.itineraryDays.find((d) => d.id === item.itineraryDayId)?.defaultTimeZone ??
    null;
  const localTime = formatLocalTime(item.localStartTime);
  const explicitEnd = formatLocalTime(item.localEndTime);
  const duration =
    explicitEnd && localTime && date && timeZone
      ? durationMinutesUntilLocalEnd(localTime, explicitEnd, { date, timeZone })
      : item.durationMinutes;
  const start =
    item.startInstant ??
    (date && timeZone && localTime ? floatingLocalTimeToInstant(date, localTime, timeZone) : null);
  const end = start && duration != null ? new Date(start.getTime() + duration * 60000) : null;
  return {
    itineraryDayId: item.itineraryDayId,
    date,
    timeZone,
    localTime,
    localEndTime:
      explicitEnd ?? (end && timeZone ? formatInstantInTimeZone(end, timeZone).time : null),
    durationMinutes: duration,
    startInstant: start?.toISOString() ?? null,
    endInstant: end?.toISOString() ?? null,
  };
}
function cloneTrip(trip: TimingTrip): TimingTrip {
  return {
    ...trip,
    itineraryDays: trip.itineraryDays.map((d) => ({ ...d, items: d.items.map((i) => ({ ...i })) })),
    itineraryItems: trip.itineraryItems.map((i) => ({ ...i })),
  };
}
function project(trip: TimingTrip, input: MovementInput) {
  const affected = new Set<string | null>();
  const targets = new Set<string>();
  const rows = new Map(allItems(trip).map((i) => [i.id, i]));
  const list = (id: string | null) => {
    if (id === null) return trip.itineraryItems;
    const day = trip.itineraryDays.find((d) => d.id === id);
    if (!day) throw new ItineraryNotFoundError('itinerary_day_not_found');
    return day.items;
  };
  const item = (id: string) => {
    const row = rows.get(id);
    if (!row) throw new ItineraryNotFoundError('itinerary_item_not_found');
    return row;
  };
  const op = input.operation;
  if (op.kind === 'move') {
    const moving = item(op.itemId);
    affected.add(moving.itineraryDayId).add(op.itineraryDayId);
    const source = list(moving.itineraryDayId);
    source.splice(source.indexOf(moving), 1);
    const dest = list(op.itineraryDayId);
    dest.splice(Math.min(op.position, dest.length), 0, moving);
    targets.add(moving.id);
  } else if (op.kind === 'swap') {
    const a = item(op.itemId),
      b = item(op.otherItemId);
    if (a.id === b.id || !a.itineraryDayId || !b.itineraryDayId)
      throw new ItineraryValidationError('invalid_itinerary_item');
    affected.add(a.itineraryDayId).add(b.itineraryDayId);
    const left = list(a.itineraryDayId),
      right = list(b.itineraryDayId);
    const ai = left.indexOf(a),
      bi = right.indexOf(b);
    left[ai] = b;
    right[bi] = a;
    targets.add(a.id).add(b.id);
  } else if (op.kind === 'order') {
    const source = list(op.itineraryDayId);
    if (
      new Set(op.itemIds).size !== source.length ||
      op.itemIds.length !== source.length ||
      op.itemIds.some((id) => !source.some((i) => i.id === id))
    )
      throw new ItineraryValidationError('invalid_itinerary_item');
    affected.add(op.itineraryDayId);
    op.itemIds.forEach((id, index) => {
      if (source[index]?.id !== id) targets.add(id);
    });
    source.splice(0, source.length, ...op.itemIds.map(item));
  } else {
    if (op.sourceDayId === op.targetDayId)
      throw new ItineraryValidationError('invalid_itinerary_day_move');
    const source = list(op.sourceDayId),
      dest = list(op.targetDayId);
    const a = [...source],
      b = [...dest];
    if (!a.length) throw new ItineraryValidationError('invalid_itinerary_day_move');
    affected.add(op.sourceDayId).add(op.targetDayId);
    source.splice(0, source.length, ...(op.strategy === 'swap' ? b : []));
    dest.splice(0, dest.length, ...(op.strategy === 'swap' ? a : [...b, ...a]));
    a.forEach((i) => targets.add(i.id));
    if (op.strategy === 'swap') b.forEach((i) => targets.add(i.id));
    const sd = trip.itineraryDays.find((d) => d.id === op.sourceDayId)!;
    const td = trip.itineraryDays.find((d) => d.id === op.targetDayId)!;
    for (const key of ['stayStartMode', 'stayEndMode'] as const) {
      const old = sd[key];
      sd[key] = op.strategy === 'swap' ? td[key] : 'INHERIT';
      td[key] = old;
    }
    for (const key of ['dailyBaseTripPlaceId', 'dailyBaseDepartureTripPlaceId'] as const) {
      const old = sd[key];
      sd[key] = op.strategy === 'swap' ? td[key] : null;
      td[key] = old;
    }
  }
  for (const id of affected)
    list(id).forEach((i, position) => {
      i.itineraryDayId = id;
      i.position = position;
    });
  return { affected, targets };
}
function timingScope(
  original: TimingTrip,
  next: TimingTrip,
  affected: Set<string | null>,
  targets: Set<string>,
) {
  const scope = new Set(targets);
  for (const day of next.itineraryDays.filter((d) => affected.has(d.id))) {
    const before = original.itineraryDays.find((d) => d.id === day.id)!;
    const all =
      before.stayStartMode !== day.stayStartMode ||
      before.stayEndMode !== day.stayEndMode ||
      before.defaultTimeZone !== day.defaultTimeZone ||
      before.dailyBaseTripPlaceId !== day.dailyBaseTripPlaceId ||
      before.dailyBaseDepartureTripPlaceId !== day.dailyBaseDepartureTripPlaceId;
    for (const [index, i] of day.items.entries()) {
      const oldIndex = before.items.findIndex((old) => old.id === i.id);
      if (
        !all &&
        !targets.has(i.id) &&
        oldIndex >= 0 &&
        before.items[oldIndex - 1]?.id === day.items[index - 1]?.id &&
        before.items[oldIndex + 1]?.id === day.items[index + 1]?.id
      )
        continue;
      scope.add(i.id);
      for (const step of [-1, 1])
        for (let n = index + step; n >= 0 && n < day.items.length; n += step) {
          const adjacent = day.items[n]!;
          if (adjacent.localStartTime && (!flexible(adjacent) || protectedTiming(adjacent))) break;
          scope.add(adjacent.id);
        }
    }
  }
  return scope;
}
function resolveZones(
  trip: TimingTrip,
  affected: Set<string | null>,
  originals: Map<string, Item>,
) {
  const placeZone = (id: string | null) => {
    const place = trip.tripPlaces.find((p) => p.id === id)?.place;
    return place ? resolvedPlaceTimeZone(place) : null;
  };
  for (const day of trip.itineraryDays.filter((d) => affected.has(d.id))) {
    const stay = resolveDayStay(
      {
        ...day,
        dailyBaseTripPlace: day.dailyBaseTripPlaceId ? { id: day.dailyBaseTripPlaceId } : null,
        dailyBaseDepartureTripPlace: day.dailyBaseDepartureTripPlaceId
          ? { id: day.dailyBaseDepartureTripPlaceId }
          : null,
      },
      toStayAccommodations(
        trip.reservations
          .filter((r) => r.type === 'ACCOMMODATION')
          .map((r) => ({ ...r, tripPlace: r.tripPlaceId ? { id: r.tripPlaceId } : null })),
      ),
      trip,
    );
    const zone = resolveDayTimeZone({
      accommodations: [],
      dailyBase: stay.start
        ? { timeZone: placeZone(stay.start.place.id), tripPlaceId: stay.start.place.id }
        : null,
      items: day.items.map((i) => ({
        id: i.id,
        tripPlaceId: i.tripPlaceId,
        customLocationTimeZone: i.customLocationTimeZone,
        tripPlaceTimeZone: placeZone(i.tripPlaceId),
      })),
      tripTimeZone: trip.referenceTimeZone,
    });
    if (stay.start && zone.source === 'EXPLICIT_DAILY_BASE') {
      if (stay.start.source === 'accommodation') zone.source = 'ACCOMMODATION';
      if (stay.start.source === 'trip_default' || stay.start.source === 'stay_range')
        zone.source = 'STAY_PLAN';
    }
    day.defaultTimeZone = zone.timeZone;
    day.defaultTimeZoneSource = zone.source;
    day.defaultTimeZoneSourceItemId = zone.sourceItemId;
    day.defaultTimeZoneSourceTripPlaceId = zone.sourceTripPlaceId;
    for (const i of day.items) {
      if (protectedTiming(i) || originals.get(i.id)?.itineraryDayId === day.id) continue;
      const resolved = resolveItemTimeZone({
        customLocationTimeZone: i.customLocationTimeZone,
        dayTimeZone: day.defaultTimeZone,
        tripPlaceTimeZone: placeZone(i.tripPlaceId),
      });
      i.timeZone = resolved.timeZone;
      i.timeZoneSource = resolved.source;
      if (i.localStartTime)
        i.startInstant = floatingLocalTimeToInstant(
          day.date.toISOString().slice(0, 10),
          formatLocalTime(i.localStartTime)!,
          resolved.timeZone,
        );
    }
  }
}

// Constraint identity includes the actual connection and values; equal issue codes alone
// never grandfather a newly introduced or worsened conflict.
function issueKey(trip: TimingTrip, issue: TimingIssue) {
  const ids = new Set([issue.itemId, ...issue.references]);
  const days = trip.itineraryDays.filter((d) => d.items.some((i) => ids.has(i.id)));
  return hash({
    issue,
    days: days.map((d) => ({
      id: d.id,
      date: d.date,
      availability: d.planningContext,
      base: [
        d.dailyBaseTripPlaceId,
        d.dailyBaseDepartureTripPlaceId,
        d.stayStartMode,
        d.stayEndMode,
        trip.stayPlanRevision,
      ],
      rows: d.items
        .slice(
          Math.max(0, d.items.findIndex((i) => ids.has(i.id)) - 1),
          d.items.findLastIndex((i) => ids.has(i.id)) + 2,
        )
        .map((i) => ({ id: i.id, slot: slot(trip, i), travel: i.travelModeToNext })),
    })),
  });
}

async function calculate(
  userId: string,
  tripId: string,
  input: MovementInput,
  client: Prisma.TransactionClient,
) {
  const original = await client.trip.findFirst({
    where: { id: tripId, ownerId: userId },
    include: TIMING_TRIP_INCLUDE,
  });
  if (!original) throw new ItineraryNotFoundError('trip_not_found');
  // Interpret floating clocks consistently before comparing or projecting any move.
  // This changes the read model only; acceptance still owns every persisted write.
  for (const day of original.itineraryDays)
    day.items = day.items.map((item) => {
      const place = original.tripPlaces.find((p) => p.id === item.tripPlaceId)?.place;
      return resolvePlannedItemTiming(item, {
        date: day.date.toISOString().slice(0, 10),
        dayTimeZone: day.defaultTimeZone,
        placeTimeZone: place ? resolvedPlaceTimeZone(place) : null,
      });
    });
  const next = cloneTrip(original);
  const originals = new Map(allItems(original).map((i) => [i.id, i]));
  const { affected, targets } = project(next, input);
  const structureChanged = allItems(next).some((i) => {
    const old = originals.get(i.id)!;
    return i.position !== old.position || i.itineraryDayId !== old.itineraryDayId;
  });
  if (structureChanged) resolveZones(next, affected, originals);
  const overrides = new Map(input.overrides.map((o) => [o.itemId, o]));
  if (overrides.size !== input.overrides.length)
    throw new ItineraryValidationError('invalid_itinerary_item');
  for (const override of input.overrides) {
    const i = allItems(next).find((i) => i.id === override.itemId);
    if (!i || !i.itineraryDayId || !affected.has(i.itineraryDayId) || protectedTiming(i))
      throw new ItineraryValidationError('invalid_itinerary_item');
    const before = slot(original, originals.get(i.id)!);
    if (
      before.durationMinutes != null &&
      override.durationMinutes !== undefined &&
      override.durationMinutes !== before.durationMinutes
    )
      throw new ItineraryValidationError('invalid_itinerary_item');
    const duration = before.durationMinutes ?? override.durationMinutes;
    if (duration == null) throw new ItineraryValidationError('invalid_itinerary_item');
    i.durationMinutes = duration;
    i.localStartTime = parseLocalTime(override.localTime);
    i.startInstant = floatingLocalTimeToInstant(
      dateOf(next, i.itineraryDayId)!,
      override.localTime,
      i.timeZone ?? next.itineraryDays.find((d) => d.id === i.itineraryDayId)!.defaultTimeZone,
    );
    if (i.localEndTime)
      i.localEndTime = parseLocalTime(
        formatInstantInTimeZone(new Date(i.startInstant.getTime() + duration * 60000), i.timeZone!)
          .time,
      );
    i.timingFlexibility = 'FIXED';
    i.timeProvenance = 'USER_OWNED';
    i.timeSemantics = 'FLOATING_LOCAL';
    if (before.durationMinutes == null) i.durationProvenance = 'USER_OWNED';
  }
  const adjustable =
    structureChanged || input.overrides.length
      ? timingScope(original, next, affected, new Set([...targets, ...overrides.keys()]))
      : new Set<string>();
  const now = new Date();
  const baselineIssues = new Set<string>();
  const revisions: string[] = [];
  const limitations = new Set<string>();
  const unresolved: TimingIssue[] = [];
  // Feed effective explicit-end durations to the existing engine without changing storage.
  const assessmentTrip = (trip: TimingTrip) => {
    const copy = cloneTrip(trip);
    for (const i of allItems(copy))
      if (i.localEndTime) i.durationMinutes = slot(trip, i).durationMinutes;
    return copy;
  };
  for (const dayId of affected) {
    if (!dayId) continue;
    const baseline = await assessDay(userId, tripId, dayId, {}, client, now, true, {
      trip: assessmentTrip(original),
      validateOnly: true,
    });
    [
      ...baseline.result.issues,
      ...movementConnectionConflicts(
        baseline.items,
        baseline.scoring.availability,
        baseline.returnTravel,
      ),
    ].forEach((i) => baselineIssues.add(issueKey(original, i)));
    revisions.push(baseline.response.scheduleRevision!);
    const result = await assessDay(userId, tripId, dayId, {}, client, now, true, {
      trip: assessmentTrip(next),
      targetIds: targets,
    });
    revisions.push(result.response.scheduleRevision!);
    if (result.returnTravel.required && result.returnTravel.estimated)
      limitations.add('TRAVEL_ESTIMATED');
    const day = next.itineraryDays.find((d) => d.id === dayId)!;
    for (const i of day.items) {
      const effective = result.day.items.find((row) => row.id === i.id)!;
      if (!protectedTiming(i)) {
        i.timeZone = effective.timeZone;
        i.timeZoneSource =
          (effective.timeZoneSource as typeof i.timeZoneSource) ?? i.timeZoneSource;
        i.startInstant = effective.startInstant;
      }
      const normalized = result.items.find((row) => row.id === i.id)!;
      if (normalized.openingHours.status === 'UNKNOWN' && i.tripPlaceId)
        limitations.add('OPENING_HOURS_UNKNOWN');
      if (normalized.inboundRequired && !normalized.inboundTravel)
        limitations.add('TRAVEL_UNKNOWN');
      if (normalized.inboundTravel?.source === 'ESTIMATED') limitations.add('TRAVEL_ESTIMATED');
      if (normalized.duration?.source === 'ESTIMATED') limitations.add('DURATION_ESTIMATED');
      const suggested = result.result.slots.get(i.id);
      // Untimed stops remain deliberately loose; suggestions do not force exact timing.
      if (
        !adjustable.has(i.id) ||
        !i.localStartTime ||
        !flexible(i) ||
        protectedTiming(i) ||
        overrides.has(i.id)
      )
        continue;
      if (!suggested) {
        unresolved.push(
          ...result.result.issues.filter(
            (issue) => issue.itemId === i.id || issue.references.includes(i.id),
          ),
        );
        continue;
      }
      suggested.caveats.forEach((c) => limitations.add(c));
      const instant = new Date(result.scoring.origin + suggested.startMinute * 60000);
      if (instant.getTime() === i.startInstant?.getTime()) continue;
      i.startInstant = instant;
      i.localStartTime = parseLocalTime(
        formatInstantInTimeZone(instant, i.timeZone ?? day.defaultTimeZone).time,
      );
      if (i.localEndTime)
        i.localEndTime = parseLocalTime(
          formatInstantInTimeZone(
            new Date(result.scoring.origin + suggested.endMinute * 60000),
            i.timeZone ?? day.defaultTimeZone,
          ).time,
        );
      else if (i.durationMinutes == null) {
        i.durationMinutes = suggested.durationMinutes;
        i.durationProvenance = 'APP_ESTIMATED';
      }
      i.timeProvenance = 'APP_ESTIMATED';
      i.timingFlexibility = 'FLEXIBLE';
    }
  }
  const issues: MovementProposal['issues'] = [];
  for (const dayId of affected) {
    if (!dayId) continue;
    const validation = await assessDay(userId, tripId, dayId, {}, client, now, true, {
      trip: assessmentTrip(next),
      validateOnly: true,
    });
    for (const issue of [
      ...validation.result.issues,
      ...movementConnectionConflicts(
        validation.items,
        validation.scoring.availability,
        validation.returnTravel,
      ),
      ...unresolved.filter((i) =>
        next.itineraryDays.find((d) => d.id === dayId)!.items.some((row) => row.id === i.itemId),
      ),
    ]) {
      const i = allItems(next).find((i) => i.id === issue.itemId);
      const unchanged = baselineIssues.has(issueKey(next, issue));
      const exactNeedsInput = Boolean(
        i?.localStartTime &&
        !overrides.has(i.id) &&
        !(issue.code === 'TRAVEL_UNKNOWN' && issue.references.some((id) => overrides.has(id))) &&
        ['DURATION_UNKNOWN', 'CONTEXT_UNKNOWN', 'TRAVEL_UNKNOWN'].includes(issue.code),
      );
      const blocking = !unchanged && (issue.severity === 'conflict' || exactNeedsInput);
      if (
        !issues.some(
          (row) =>
            row.itemId === issue.itemId &&
            row.code === issue.code &&
            hash(row.references) === hash(issue.references),
        )
      )
        issues.push({ ...issue, blocking });
    }
  }
  const rows = allItems(next).filter((i) => affected.has(i.itineraryDayId));
  const changes = rows.flatMap((i) => {
    const before = slot(original, originals.get(i.id)!),
      after = slot(next, i);
    const reasons: MovementProposal['changes'][number]['reasons'] = [];
    if (before.itineraryDayId !== after.itineraryDayId) reasons.push('day');
    if (before.timeZone !== after.timeZone) reasons.push('zone');
    if (overrides.has(i.id)) reasons.push('manual');
    if (!reasons.length) reasons.push('fit');
    return hash(before) === hash(after) ? [] : [{ itemId: i.id, before, after, reasons }];
  });
  const editable = rows
    .filter((i) => i.itineraryDayId && !protectedTiming(i))
    .map((i) => ({
      itemId: i.id,
      localTime: formatLocalTime(i.localStartTime),
      durationMinutes: slot(next, i).durationMinutes,
    }));
  const blocked = issues.some((i) => i.blocking);
  const orders = [...affected].map((id) => ({
    itineraryDayId: id,
    itemIds: (id ? next.itineraryDays.find((d) => d.id === id)!.items : next.itineraryItems).map(
      (i) => i.id,
    ),
  }));
  // Exclude derived score timestamps, but include row versions to reject ABA/replayed swaps.
  const scheduleRevision = hash({
    revisions,
    items: allItems(original).map((i) => ({
      ...slot(original, i),
      id: i.id,
      position: i.position,
      updatedAt: i.updatedAt,
      flexibility: i.timingFlexibility,
      status: i.travelStatus,
    })),
    days: original.itineraryDays.map((d) => ({ id: d.id, updatedAt: d.updatedAt })),
  });
  const body = {
    status: blocked
      ? editable.length
        ? ('needs_input' as const)
        : ('conflict' as const)
      : ('ready' as const),
    orders,
    changes,
    issues,
    limitations: [...limitations].sort(),
    editable,
  };
  const proposal: MovementProposal = {
    ...body,
    scheduleRevision,
    fingerprint: hash({ input, scheduleRevision, ...body }),
  };
  return { proposal, next, original, affected };
}

export async function previewItineraryMovement(
  userId: string,
  tripId: string,
  input: MovementInput,
) {
  return getPrismaClient().$transaction(
    async (client) => (await calculate(userId, tripId, input, client)).proposal,
    { isolationLevel: 'Serializable', timeout: 30_000 },
  );
}
export async function applyItineraryMovement(
  userId: string,
  tripId: string,
  input: MovementApplyInput,
) {
  try {
    return await getPrismaClient().$transaction(
      async (client) => {
        const result = await calculate(
          userId,
          tripId,
          { operation: input.operation, overrides: input.overrides },
          client,
        );
        if (
          result.proposal.status !== 'ready' ||
          result.proposal.scheduleRevision !== input.scheduleRevision ||
          result.proposal.fingerprint !== input.fingerprint
        )
          throw new ItineraryConflictError('itinerary_schedule_conflict');
        const rows = allItems(result.next).filter((i) => result.affected.has(i.itineraryDayId));
        const old = new Map(allItems(result.original).map((i) => [i.id, i]));
        const changed =
          rows.some(
            (i) =>
              i.itineraryDayId !== old.get(i.id)!.itineraryDayId ||
              i.position !== old.get(i.id)!.position,
          ) ||
          result.proposal.changes.length > 0 ||
          input.overrides.length > 0;
        if (changed) {
          if (input.operation.kind === 'day')
            await client.trip.update({
              where: { id: tripId },
              data: { stayPlanRevision: { increment: 1 } },
            });
          const park =
            Math.max(0, ...allItems(result.original).map((i) => i.position)) + rows.length + 1;
          for (const [n, i] of rows.entries())
            await client.itineraryItem.update({
              where: { id: i.id },
              data: { position: park + n },
            });
          for (const i of rows)
            await client.itineraryItem.update({
              where: { id: i.id },
              data: {
                itineraryDayId: i.itineraryDayId,
                position: i.position,
                localStartTime: i.localStartTime,
                localEndTime: i.localEndTime,
                startInstant: i.startInstant,
                timeZone: i.timeZone,
                timeZoneSource: i.timeZoneSource,
                timeSemantics: i.timeSemantics,
                timeProvenance: i.timeProvenance,
                timingFlexibility: i.timingFlexibility,
                durationMinutes: i.durationMinutes,
                durationProvenance: i.durationProvenance,
              },
            });
          for (const d of result.next.itineraryDays.filter((d) => result.affected.has(d.id)))
            await client.itineraryDay.update({
              where: { id: d.id },
              data: {
                stayStartMode: d.stayStartMode,
                stayEndMode: d.stayEndMode,
                dailyBaseTripPlaceId: d.dailyBaseTripPlaceId,
                dailyBaseDepartureTripPlaceId: d.dailyBaseDepartureTripPlaceId,
                defaultTimeZone: d.defaultTimeZone,
                defaultTimeZoneSource: d.defaultTimeZoneSource,
                defaultTimeZoneSourceItemId: d.defaultTimeZoneSourceItemId,
                defaultTimeZoneSourceTripPlaceId: d.defaultTimeZoneSourceTripPlaceId,
              },
            });
        }
        return {
          itinerary: await listItinerary(userId, tripId, undefined, { cachedOnly: true, client }),
          proposal: result.proposal,
        };
      },
      { isolationLevel: 'Serializable', timeout: 30_000 },
    );
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === 'P2034')
      throw new ItineraryConflictError('itinerary_schedule_conflict');
    throw error;
  }
}
