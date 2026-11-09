import type { TimingIssue, TimingShortfallLimit } from '@trove/types';
import { openingHoursApply } from './place-opening-hours.js';
import type {
  PlanScoreDayItem,
  PlanScoreFixedCommitment,
  PlanScoreInterval,
} from './plan-score-factors.js';
import type { SuggestedTimeWindow } from './itinerary-time-suggestions-rules.js';

export type SchedulingItem = PlanScoreDayItem & {
  protected?: boolean;
  preferredWindows?: readonly SuggestedTimeWindow[] | null;
  /** The time a retimed stop had. A repair stays as close to it as fits, not the day's first slot. */
  anchorMinute?: number;
};
/** A connection that needs more travel than the gap before the next stop leaves. */
export type TravelShortfall = {
  fromItemId: string;
  toItemId: string;
  travelMinutes: number;
  availableMinutes: number;
  limitedBy: TimingShortfallLimit;
  limitItemId?: string;
  limitMinute: number;
  /** When the earlier stop starts, if it has a time; past `limitMinute` means out of time order. */
  fromStartMinute?: number;
};
export type SchedulingInput = {
  items: SchedulingItem[];
  commitments: PlanScoreFixedCommitment[];
  availability: PlanScoreInterval | null;
  dayStartMinute: number;
  dayEndMinute: number;
  returnTravel: { required: boolean; minutes: number | null; estimated?: boolean };
  targetIds: ReadonlySet<string>;
  /** An explicit Planner move may adjust flexible daypart preferences to fit its order. */
  allowDayPartAdjustment?: boolean;
};
export type ScheduledSlot = {
  startMinute: number;
  endMinute: number;
  durationMinutes: number;
  caveats: string[];
  reasons: Array<{ code: string; references: string[] }>;
};
export type SchedulingResult = {
  slots: Map<string, ScheduledSlot>;
  issues: TimingIssue[];
  orderConflicts: Map<string, { previousItemId: string; earliest: number; scheduled: number }>;
  /** Keyed by the stop the issue sits on. */
  shortfalls: Map<string, TravelShortfall>;
  /** A fixed stop and the unlinked booking it overlaps, keyed by the stop. */
  bookingOverlaps: Map<string, PlanScoreFixedCommitment>;
};
const roundUp = (minute: number) => Math.ceil(minute / 5) * 5;
const roundDown = (minute: number) => Math.floor(minute / 5) * 5;

type Window = { low: number; high: number };
function windows(item: SchedulingItem, low: number, high: number): Window[] {
  const duration = item.duration?.minutes ?? 0;
  const earliest = Math.max(low, item.startWindow?.earliestMinute ?? -Infinity);
  const latest = Math.min(high, (item.startWindow?.latestMinute ?? Infinity) - 1);
  return (
    item.openingHours.status === 'KNOWN'
      ? item.openingHours.intervals
      : [{ startMinute: earliest, endMinute: latest + duration }]
  )
    .map((interval) => ({
      low: Math.max(earliest, interval.startMinute),
      high: Math.min(latest, interval.endMinute - duration),
    }))
    .filter((window) => window.low <= window.high)
    .toSorted((a, b) => a.low - b.low);
}
function blockers(input: SchedulingInput, item: SchedulingItem) {
  return input.commitments.filter((commitment) => commitment.itemId !== item.id);
}
function clash(input: SchedulingInput, item: SchedulingItem, start: number) {
  return blockers(input, item).find(
    (blocker) =>
      start < blocker.endMinute && blocker.startMinute < start + (item.duration?.minutes ?? 0),
  );
}
function fitting(
  input: SchedulingInput,
  item: SchedulingItem,
  low: number,
  high: number,
  backwards = false,
): number | null {
  const ranges = windows(item, low, high);
  if (backwards) ranges.reverse();
  for (const window of ranges) {
    let start = backwards ? roundDown(window.high) : roundUp(window.low);
    for (let pass = 0; pass <= input.commitments.length; pass++) {
      if (start < window.low || start > window.high) break;
      const blocker = clash(input, item, start);
      if (!blocker) return start;
      start = backwards
        ? roundDown(blocker.startMinute - (item.duration?.minutes ?? 0))
        : roundUp(blocker.endMinute);
    }
  }
  return null;
}
/** The feasible start closest to `target`, either side of it. */
function nearest(
  input: SchedulingInput,
  item: SchedulingItem,
  low: number,
  high: number,
  target: number,
): number | null {
  const after = fitting(input, item, Math.max(low, target), high);
  const before = fitting(input, item, low, Math.min(high, target), true);
  if (after === null || before === null) return after ?? before;
  return after - target <= target - before ? after : before;
}
function valid(
  input: SchedulingInput,
  item: SchedulingItem,
  minute: number,
  low: number,
  high: number,
) {
  return (
    windows(item, low, high).some((window) => minute >= window.low && minute <= window.high) &&
    !clash(input, item, minute)
  );
}
function groupSlots(
  input: SchedulingInput,
  from: number,
  to: number,
  keepTimes: boolean,
): Map<string, number> | null {
  const slots = new Map<string, number>();
  const previous = input.items[from - 1];
  const next = input.items[to];
  const dayEnd = input.availability?.endMinute ?? input.dayEndMinute;
  let latestEnd = next?.start
    ? next.start.minutes - (next.inboundTravel?.minutes ?? 0)
    : dayEnd - (input.returnTravel.required ? (input.returnTravel.minutes ?? 0) : 0);
  const latestStarts = new Map<string, number>();
  for (let index = to - 1; index >= from; index--) {
    const item = input.items[index]!;
    const upper = latestEnd - item.duration!.minutes;
    const start =
      keepTimes && item.start && !input.targetIds.has(item.id)
        ? valid(input, item, item.start.minutes, -Infinity, upper)
          ? item.start.minutes
          : null
        : fitting(input, item, -Infinity, upper, true);
    if (start === null) return null;
    latestStarts.set(item.id, start);
    latestEnd = start - (item.inboundTravel?.minutes ?? 0);
  }
  let running = previous?.start
    ? Math.max(
        previous.start.minutes + (previous.duration?.minutes ?? 0),
        input.availability?.startMinute ?? -Infinity,
      )
    : (input.availability?.startMinute ?? input.dayStartMinute);
  for (let index = from; index < to; index++) {
    const item = input.items[index]!;
    const earliest = running + (item.inboundTravel?.minutes ?? 0);
    const latest = latestStarts.get(item.id)!;
    let start: number | null = null;
    if (item.start && valid(input, item, item.start.minutes, earliest, latest))
      start = item.start.minutes;
    // Prefer breathing room before a fixed activity, without making it a hard constraint.
    const comfortableLatest = next?.start ? latest - 15 : latest;
    if (start === null && item.anchorMinute !== undefined)
      start =
        nearest(input, item, earliest, comfortableLatest, item.anchorMinute) ??
        nearest(input, item, earliest, latest, item.anchorMinute);
    if (start === null) {
      const preferred = (item.preferredWindows ?? []).flatMap((window) => {
        const minute = Math.max(earliest, window.typicalMinute ?? window.startMinute);
        return minute + item.duration!.minutes <= window.endMinute &&
          valid(input, item, roundUp(minute), earliest, comfortableLatest)
          ? [roundUp(minute)]
          : [];
      })[0];
      start =
        preferred ??
        fitting(input, item, earliest, comfortableLatest) ??
        fitting(input, item, earliest, latest);
    }
    if (start === null) return null;
    slots.set(item.id, start);
    running = start + item.duration!.minutes;
  }
  return slots;
}

/**
 * Why a block of flexible stops has no plan, in the traveller's terms: the first
 * connection whose earliest arrival is after the latest start the rest of the
 * day allows, and what sets that latest start - a fixed stop, a closing time or
 * the end of the day. Null when the block fails for another reason, such as a
 * stop that fits nowhere at all.
 */
function diagnoseGroup(input: SchedulingInput, from: number, to: number): TravelShortfall | null {
  const previous = input.items[from - 1];
  if (!previous?.start || !previous.duration) return null;
  const next = input.items[to];
  const dayEnd = input.availability?.endMinute ?? input.dayEndMinute;
  let latestEnd = next?.start
    ? next.start.minutes - (next.inboundTravel?.minutes ?? 0)
    : dayEnd - (input.returnTravel.required ? (input.returnTravel.minutes ?? 0) : 0);
  let bound: Pick<TravelShortfall, 'limitedBy' | 'limitItemId' | 'limitMinute'> = next?.start
    ? { limitedBy: 'fixed_start', limitItemId: next.id, limitMinute: next.start.minutes }
    : { limitedBy: 'day_end', limitMinute: dayEnd };
  const latest = new Map<string, { minute: number; bound: typeof bound }>();
  for (let index = to - 1; index >= from; index--) {
    const item = input.items[index]!;
    const duration = item.duration!.minutes;
    const upper = latestEnd - duration;
    const start = fitting(input, item, -Infinity, upper, true);
    if (start === null) return null;
    if (item.openingHours.status === 'KNOWN') {
      const open = { ...item, openingHours: { status: 'UNKNOWN' as const } };
      const unbounded = fitting(input, open, -Infinity, upper, true);
      if (unbounded !== null && unbounded > start)
        bound = {
          limitedBy: 'closing_time',
          limitItemId: item.id,
          limitMinute:
            item.openingHours.intervals.find(
              (interval) => start >= interval.startMinute && start + duration <= interval.endMinute,
            )?.endMinute ?? start + duration,
        };
    }
    latest.set(item.id, { minute: start, bound });
    latestEnd = start - (item.inboundTravel?.minutes ?? 0);
  }
  let running = previous.start.minutes + previous.duration.minutes;
  let before = previous;
  for (let index = from; index < to; index++) {
    const item = input.items[index]!;
    const travel = item.inboundTravel?.minutes ?? 0;
    const limit = latest.get(item.id)!;
    if (running + travel > limit.minute)
      return {
        fromItemId: before.id,
        toItemId: item.id,
        travelMinutes: travel,
        availableMinutes: limit.minute - running,
        ...limit.bound,
      };
    const start = fitting(input, item, running + travel, limit.minute);
    if (start === null) return null;
    running = start + item.duration!.minutes;
    before = item;
  }
  return null;
}

/** One planner pass: fixed anchors bound independently solvable flexible blocks. No I/O. */
export function scheduleItinerary(input: SchedulingInput): SchedulingResult {
  const slots = new Map<string, ScheduledSlot>();
  const issues: TimingIssue[] = [];
  const orderConflicts: SchedulingResult['orderConflicts'] = new Map();
  const shortfalls: SchedulingResult['shortfalls'] = new Map();
  const bookingOverlaps: SchedulingResult['bookingOverlaps'] = new Map();
  const issue = (item: SchedulingItem, code: TimingIssue['code'], references: string[] = []) => {
    issues.push({
      code,
      itemId: item.id,
      references,
      severity:
        code === 'DURATION_UNKNOWN' || code === 'TRAVEL_UNKNOWN' || code === 'CONTEXT_UNKNOWN'
          ? 'review'
          : code === 'TIGHT_TRANSITION'
            ? 'notice'
            : 'conflict',
    });
  };
  const isAnchor = (item: SchedulingItem) => Boolean((item.fixed || item.protected) && item.start);
  const blockedIds = new Set<string>();
  const blockIssue = (
    group: SchedulingItem[],
    code: TimingIssue['code'],
    references: string[] = [],
    cause?: SchedulingItem,
  ) => {
    const subject =
      group.find((item) => input.targetIds.has(item.id)) ??
      cause ??
      group.find((item) => !item.start) ??
      group[0]!;
    group.forEach((item) => blockedIds.add(item.id));
    issue(
      subject,
      code,
      [...new Set([...references, ...group.map((item) => item.id)])].filter(
        (id) => id !== subject.id,
      ),
    );
    return subject;
  };
  let from = 0;
  while (from < input.items.length) {
    const first = input.items[from]!;
    if (isAnchor(first)) {
      const previous = input.items[from - 1];
      if (!first.duration) issue(first, 'DURATION_UNKNOWN');
      if (
        !previous &&
        input.availability &&
        first.inboundTravel &&
        first.start!.minutes < input.availability.startMinute + first.inboundTravel.minutes
      )
        issue(first, 'FIXED_CONFLICT');
      if (first.inboundRequired && !first.inboundTravel)
        issue(first, 'TRAVEL_UNKNOWN', previous ? [previous.id] : []);
      if (from === input.items.length - 1 && input.availability && input.returnTravel.required) {
        if (input.returnTravel.minutes === null) issue(first, 'TRAVEL_UNKNOWN');
        else if (
          first.duration &&
          first.start!.minutes + first.duration.minutes + input.returnTravel.minutes >
            input.availability.endMinute
        )
          issue(first, 'FIXED_CONFLICT');
      }
      const previousStart = previous
        ? blockedIds.has(previous.id)
          ? undefined
          : (slots.get(previous.id)?.startMinute ?? previous.start?.minutes)
        : undefined;
      if (
        previousStart !== undefined &&
        previous?.duration &&
        previousStart + previous.duration.minutes + (first.inboundTravel?.minutes ?? 0) >
          first.start!.minutes
      ) {
        const previousEnd = previousStart + previous.duration.minutes;
        // The stop just placed before a fixed one is what no longer fits, so the
        // conflict is told about it rather than the stop that did not move.
        const moved = input.targetIds.has(previous.id) && !input.targetIds.has(first.id);
        const subject = moved ? previous : first;
        issue(subject, 'FIXED_CONFLICT', [moved ? first.id : previous.id]);
        if (!first.inboundRequired || first.inboundTravel) {
          shortfalls.set(subject.id, {
            fromItemId: previous.id,
            toItemId: first.id,
            travelMinutes: first.inboundTravel?.minutes ?? 0,
            availableMinutes: first.start!.minutes - previousEnd,
            limitedBy: 'fixed_start',
            limitItemId: first.id,
            limitMinute: first.start!.minutes,
            fromStartMinute: previousStart,
          });
          if (!moved)
            orderConflicts.set(first.id, {
              previousItemId: previous.id,
              earliest: previousEnd + (first.inboundTravel?.minutes ?? 0),
              scheduled: first.start!.minutes,
            });
        }
      }
      if (first.duration) {
        const start = first.start!.minutes;
        const inWindow = windows(
          first,
          input.availability?.startMinute ?? -Infinity,
          (input.availability?.endMinute ?? input.dayEndMinute) - first.duration.minutes,
        ).some((window) => start >= window.low && start <= window.high);
        const booking = inWindow ? clash(input, first, start) : undefined;
        if (!inWindow)
          issue(first, first.openingHours.status === 'KNOWN' ? 'OPENING_HOURS' : 'FIXED_CONFLICT');
        else if (booking) {
          // A booking that is not linked to this stop. Often the two are the same
          // plan, so Trove names the booking and asks for a check, not a new time.
          issues.push({
            code: 'FIXED_CONFLICT',
            itemId: first.id,
            references: [booking.id],
            severity: 'review',
          });
          bookingOverlaps.set(first.id, booking);
        }
      }
      from++;
      continue;
    }
    let to = from;
    while (to < input.items.length && !isAnchor(input.items[to]!)) to++;
    const group = input.items.slice(from, to);
    const next = input.items[to];
    const protectedUntimed = group.find((item) => item.protected && !item.start);
    if (protectedUntimed) {
      blockIssue(group, 'FIXED_CONFLICT', [protectedUntimed.id], protectedUntimed);
      from = to;
      continue;
    }
    const missingDuration = group.find((item) => !item.duration || item.duration.minutes <= 0);
    const missingTravel = group.find((item) => item.inboundRequired && !item.inboundTravel);
    const previous = input.items[from - 1];
    const unknownEnd = previous && !previous.duration;
    const unknownOutgoing = next
      ? next.inboundRequired && !next.inboundTravel
      : Boolean(
          input.availability && input.returnTravel.required && input.returnTravel.minutes === null,
        );
    if (missingDuration || unknownEnd || missingTravel || unknownOutgoing) {
      blockIssue(
        group,
        missingDuration || unknownEnd ? 'DURATION_UNKNOWN' : 'TRAVEL_UNKNOWN',
        [missingDuration?.id ?? previous?.id ?? missingTravel?.id ?? next?.id ?? first.id],
        missingDuration ?? missingTravel,
      );
      from = to;
      continue;
    }
    if (
      !previous &&
      !input.availability &&
      !next?.start &&
      !group.some(
        (item) =>
          item.start ||
          item.startWindow ||
          item.openingHours.status === 'KNOWN' ||
          item.preferredWindows?.length ||
          item.inboundRequired,
      )
    ) {
      blockIssue(group, 'CONTEXT_UNKNOWN');
      from = to;
      continue;
    }
    let attempted = input;
    let planned = groupSlots(input, from, to, true) ?? groupSlots(input, from, to, false);
    if (
      !planned &&
      input.allowDayPartAdjustment &&
      group.some((item) => input.targetIds.has(item.id))
    ) {
      // Dayparts remain intent, while the explicit position wins. Hours, travel,
      // durations, availability and protected anchors are still hard boundaries.
      const relaxed = {
        ...input,
        items: input.items.map((item, index) =>
          index >= from && index < to
            ? {
                ...item,
                startWindow: null,
                preferredWindows: [
                  ...(item.startWindow
                    ? [
                        {
                          startMinute: item.startWindow.earliestMinute,
                          endMinute: item.startWindow.latestMinute + item.duration!.minutes,
                          typicalMinute: item.startWindow.earliestMinute,
                        },
                      ]
                    : []),
                  ...(item.preferredWindows ?? []),
                ],
              }
            : item,
        ),
      };
      attempted = relaxed;
      planned = groupSlots(relaxed, from, to, true) ?? groupSlots(relaxed, from, to, false);
    }
    if (!planned) {
      const closed = group.find(
        (item) =>
          item.openingHours.status === 'KNOWN' &&
          !item.openingHours.intervals.some(
            (interval) => interval.endMinute - interval.startMinute >= item.duration!.minutes,
          ),
      );
      const subject = blockIssue(
        group,
        closed ? 'OPENING_HOURS' : 'NO_ROOM',
        next ? [next.id] : [],
        closed,
      );
      const shortfall = closed ? null : diagnoseGroup(attempted, from, to);
      if (shortfall) shortfalls.set(subject.id, shortfall);
      from = to;
      continue;
    }
    for (const item of group) {
      const startMinute = planned.get(item.id)!;
      const caveats: string[] = [];
      if (item.duration!.source === 'ESTIMATED') caveats.push('DURATION_ESTIMATED');
      if (
        item.inboundTravel?.source === 'ESTIMATED' ||
        input.items[input.items.indexOf(item) + 1]?.inboundTravel?.source === 'ESTIMATED' ||
        (item === input.items.at(-1) && input.returnTravel.estimated)
      )
        caveats.push('TRAVEL_ESTIMATED');
      if (
        item.placeId &&
        openingHoursApply(item.blockType) &&
        item.openingHours.status === 'UNKNOWN'
      )
        caveats.push('OPENING_HOURS_UNKNOWN');
      const index = input.items.indexOf(item);
      const references = input.items[index - 1] ? [input.items[index - 1]!.id] : [];
      const reasons = [
        {
          code: references.length
            ? 'AFTER_PREVIOUS_ITEM'
            : item.openingHours.status === 'KNOWN'
              ? 'OPENING_HOURS'
              : item.startWindow
                ? 'DAY_PART_WINDOW'
                : input.availability
                  ? 'AVAILABILITY'
                  : 'DAY_START',
          references,
        },
      ];
      if (
        !references.length &&
        !input.availability &&
        !item.startWindow &&
        item.openingHours.status === 'UNKNOWN' &&
        !item.preferredWindows?.length &&
        !item.inboundRequired &&
        !next?.start &&
        !group.some((neighbor) => neighbor.id !== item.id && neighbor.start) &&
        input.targetIds.has(item.id)
      ) {
        issue(item, 'CONTEXT_UNKNOWN');
        continue;
      }
      slots.set(item.id, {
        startMinute,
        endMinute: startMinute + item.duration!.minutes,
        durationMinutes: item.duration!.minutes,
        caveats,
        reasons,
      });
    }
    if (next?.start && group.length) {
      const last = group.at(-1)!;
      const slot = slots.get(last.id);
      if (slot && next.start.minutes - slot.endMinute - (next.inboundTravel?.minutes ?? 0) < 15) {
        issue(last, 'TIGHT_TRANSITION', [next.id]);
        slot.caveats.unshift('TIGHT_TRANSITION');
      }
    }
    from = to;
  }
  return { slots, issues, orderConflicts, shortfalls, bookingOverlaps };
}

/** A personal stop can be explicitly retimed; bookings and travel history stay protected.
 * All constraints and surrounding flexible slots still go through the same planner pass.
 */
export function suggestScheduledTarget(input: SchedulingInput, targetId: string): SchedulingResult {
  const targetIndex = input.items.findIndex((item) => item.id === targetId);
  // Earlier saved visits define the arrival at this stop. Do not move them
  // backwards merely to hide an overdue connection.
  const items = input.items.map((item, index) => {
    if (index < targetIndex && item.start) return { ...item, fixed: true };
    if (item.id !== targetId || item.protected) return item;
    return {
      ...item,
      ...(item.start ? { anchorMinute: item.start.minutes } : {}),
      fixed: false,
      start: null,
      startWindow: item.start ? null : item.startWindow,
      preferredWindows:
        item.start && item.duration
          ? [
              {
                startMinute: item.start.minutes,
                endMinute: item.start.minutes + item.duration.minutes,
                typicalMinute: item.start.minutes,
              },
              ...(item.preferredWindows ?? []),
            ]
          : item.preferredWindows,
    };
  });
  const focused = { ...input, items, targetIds: new Set([targetId]) };
  const ordinary = scheduleItinerary(focused);
  if (ordinary.slots.has(targetId) || input.items[targetIndex]?.protected) return ordinary;
  // Personal fixed times can be proposed for explicit group review. Bookings,
  // authoritative transport, history, hours and availability remain boundaries.
  return scheduleItinerary({
    ...focused,
    items: items.map((item, index) =>
      index > targetIndex && !item.protected && item.start ? { ...item, fixed: false } : item,
    ),
  });
}
