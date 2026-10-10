import type { TimingIssue } from '@trove/types';
import type {
  PlanScoreDayItem,
  PlanScoreFixedCommitment,
  PlanScoreInterval,
} from './plan-score-factors.js';
import type { SuggestedTimeWindow } from './itinerary-time-suggestions-rules.js';

export type SchedulingItem = PlanScoreDayItem & {
  protected?: boolean;
  preferredWindows?: readonly SuggestedTimeWindow[] | null;
};
export type SchedulingInput = {
  items: SchedulingItem[];
  commitments: PlanScoreFixedCommitment[];
  availability: PlanScoreInterval | null;
  dayStartMinute: number;
  dayEndMinute: number;
  returnTravel: { required: boolean; minutes: number | null; estimated?: boolean };
  targetIds: ReadonlySet<string>;
};
export type ScheduledSlot = {
  startMinute: number;
  endMinute: number;
  durationMinutes: number;
  caveats: string[];
  reasons: Array<{ code: string; references: string[] }>;
};
export type SchedulingResult = { slots: Map<string, ScheduledSlot>; issues: TimingIssue[] };
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
    if (
      item.start &&
      !input.targetIds.has(item.id) &&
      valid(input, item, item.start.minutes, earliest, latest)
    )
      start = item.start.minutes;
    if (start === null) {
      // Prefer breathing room before a fixed activity, without making it a hard constraint.
      const comfortableLatest = next?.start ? latest - 15 : latest;
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

/** One planner pass: fixed anchors bound independently solvable flexible blocks. No I/O. */
export function scheduleItinerary(input: SchedulingInput): SchedulingResult {
  const slots = new Map<string, ScheduledSlot>();
  const issues: TimingIssue[] = [];
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
        ? (slots.get(previous.id)?.startMinute ?? previous.start?.minutes)
        : undefined;
      if (
        previousStart !== undefined &&
        previous?.duration &&
        previousStart + previous.duration.minutes + (first.inboundTravel?.minutes ?? 0) >
          first.start!.minutes
      )
        issue(first, 'FIXED_CONFLICT', [previous.id]);
      if (
        first.duration &&
        !valid(
          input,
          first,
          first.start!.minutes,
          input.availability?.startMinute ?? -Infinity,
          (input.availability?.endMinute ?? input.dayEndMinute) - first.duration.minutes,
        )
      )
        issue(first, first.openingHours.status === 'KNOWN' ? 'OPENING_HOURS' : 'FIXED_CONFLICT');
      from++;
      continue;
    }
    let to = from;
    while (to < input.items.length && !isAnchor(input.items[to]!)) to++;
    const group = input.items.slice(from, to);
    const next = input.items[to];
    const protectedUntimed = group.find((item) => item.protected && !item.start);
    if (protectedUntimed) {
      for (const item of group) issue(item, 'FIXED_CONFLICT', [protectedUntimed.id]);
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
      for (const item of group)
        issue(item, missingDuration || unknownEnd ? 'DURATION_UNKNOWN' : 'TRAVEL_UNKNOWN', [
          missingDuration?.id ?? previous?.id ?? missingTravel?.id ?? next?.id ?? item.id,
        ]);
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
      for (const item of group) issue(item, 'CONTEXT_UNKNOWN');
      from = to;
      continue;
    }
    const planned = groupSlots(input, from, to, true) ?? groupSlots(input, from, to, false);
    if (!planned) {
      for (const item of group)
        issue(
          item,
          item.openingHours.status === 'KNOWN' && item.openingHours.intervals.length === 0
            ? 'OPENING_HOURS'
            : 'NO_ROOM',
          next ? [next.id] : [],
        );
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
      if (item.placeId && item.openingHours.status === 'UNKNOWN')
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
  return { slots, issues };
}
