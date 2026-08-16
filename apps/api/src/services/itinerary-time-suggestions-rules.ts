import type {
  PlanScoreDayItem,
  PlanScoreFixedCommitment,
  PlanScoreInterval,
} from './plan-score-factors.js';

/**
 * Proposes a specific start time for an itinerary item the traveller has only
 * timed vaguely, or not at all.
 *
 * Deterministic and pure: the same day always yields the same answer. It reads
 * the evidence Plan Score already collects — opening hours, neighbouring fixed
 * items, durations, and route legs — and returns the earliest start that
 * satisfies all of it.
 *
 * Nothing here writes. The proposal is offered to the traveller, who accepts it
 * by saving (PRD section 29.4).
 */

/** Five-minute steps because people plan on the clock, not to the minute. */
export const SUGGESTED_TIME_ROUNDING_MINUTES = 5;

/** Where a day starts when nothing else pins it down. */
export const DEFAULT_DAY_START_MINUTE = 8 * 60;

const MINUTES_PER_DAY = 1440;

export type SuggestedTimeReasonCode =
  | 'AFTER_PREVIOUS_ITEM'
  | 'BEFORE_FIXED_ITEM'
  | 'CLEARS_COMMITMENT'
  | 'DAY_PART_WINDOW'
  | 'DAY_START'
  | 'OPENING_HOURS';

/** What Trove could not establish. A caveat qualifies a suggestion, never blocks it. */
export type SuggestedTimeCaveat = 'DURATION_UNKNOWN' | 'OPENING_HOURS_UNKNOWN' | 'TRAVEL_UNKNOWN';

export type SuggestedTimeReason = {
  code: SuggestedTimeReasonCode;
  /** Item or commitment ids the reason refers to; the client resolves the names. */
  references: string[];
};

export type SuggestedTimeResult =
  | {
      caveats: SuggestedTimeCaveat[];
      reasons: SuggestedTimeReason[];
      startMinute: number;
      status: 'ok';
    }
  | { blockedBy: SuggestedTimeReasonCode[]; status: 'no_feasible_time' }
  | { missing: SuggestedTimeCaveat[]; status: 'insufficient_evidence' };

export type SuggestItemStartInput = {
  commitments: PlanScoreFixedCommitment[];
  dayStartMinute: number;
  /** Items in planned order. Never reordered. */
  items: PlanScoreDayItem[];
  roundingMinutes: number;
  targetItemId: string;
};

type Blocker = { endMinute: number; id: string; startMinute: number };

function roundUp(value: number, step: number) {
  if (step <= 1) return value;
  return Math.ceil(value / step) * step;
}

/** An item is anchored only when the traveller gave it an exact start. */
function anchoredStart(item: PlanScoreDayItem) {
  return item.fixed && item.start ? item.start.minutes : null;
}

/**
 * Earliest start at or after `earliest` and before `latest`, whose whole visit
 * fits inside one opening interval. Intervals are sorted so the first fit found
 * is genuinely the earliest.
 *
 * `latest` is exclusive, matching the half-open daypart windows: a Morning item
 * starting at exactly 12:00 has stopped being a morning item.
 */
function firstFittingStart(
  intervals: PlanScoreInterval[],
  earliest: number,
  latest: number,
  visitMinutes: number,
): number | null {
  const sorted = [...intervals].toSorted((left, right) => left.startMinute - right.startMinute);

  for (const interval of sorted) {
    const start = Math.max(earliest, interval.startMinute);
    if (start >= latest) continue;
    // A zero-length visit only needs the instant itself to be open.
    const fits =
      visitMinutes > 0 ? start + visitMinutes <= interval.endMinute : start < interval.endMinute;
    if (fits) return start;
  }

  return null;
}

/**
 * Pushes the start past anything already occupying the day, then re-checks
 * opening hours, because clearing a commitment can land outside them. Each
 * blocker can displace at most once, which bounds the loop.
 */
function clearBlockers(input: {
  blockers: Blocker[];
  earliest: number;
  intervals: PlanScoreInterval[] | null;
  latest: number;
  roundingMinutes: number;
  visitMinutes: number;
}): { cleared: string[]; startMinute: number | null } {
  let start = input.earliest;
  const cleared: string[] = [];

  for (let pass = 0; pass <= input.blockers.length; pass += 1) {
    const clash = input.blockers.find(
      (blocker) => start < blocker.endMinute && blocker.startMinute < start + input.visitMinutes,
    );
    if (!clash) return { cleared, startMinute: start >= input.latest ? null : start };

    cleared.push(clash.id);
    start = roundUp(clash.endMinute, input.roundingMinutes);

    if (input.intervals) {
      const reopened = firstFittingStart(input.intervals, start, input.latest, input.visitMinutes);
      if (reopened === null) return { cleared, startMinute: null };
      start = reopened;
    }
  }

  return { cleared, startMinute: null };
}

/**
 * Walks back to the nearest item with an exact start and adds up the durations
 * and travel between it and the target.
 *
 * Returns null when the chain breaks, together with why. Trove does not guess
 * across a gap: an unknown leg means the arrival time is unknown, not zero.
 */
function earliestFromPredecessors(items: PlanScoreDayItem[], targetIndex: number) {
  for (let anchorIndex = targetIndex - 1; anchorIndex >= 0; anchorIndex -= 1) {
    const anchor = items[anchorIndex];
    if (!anchor?.start) continue;
    if (!anchor.duration) return { caveat: 'DURATION_UNKNOWN' as const, minutes: null };

    let running = anchor.start.minutes + anchor.duration.minutes;

    for (let index = anchorIndex + 1; index <= targetIndex; index += 1) {
      const step = items[index];
      if (!step?.inboundTravel) return { caveat: 'TRAVEL_UNKNOWN' as const, minutes: null };

      running += step.inboundTravel.minutes;
      if (index === targetIndex) {
        return { anchorId: anchor.id, caveat: null, minutes: running };
      }
      if (!step.duration) return { caveat: 'DURATION_UNKNOWN' as const, minutes: null };
      running += step.duration.minutes;
    }
  }

  return { caveat: null, minutes: null };
}

/**
 * Latest the target may finish before the next exact-start item becomes
 * unreachable. This only ever rules a suggestion out; a broken chain means the
 * constraint is unknown, so nothing is ruled out and no caveat is raised.
 */
function nextAnchorLimit(items: PlanScoreDayItem[], targetIndex: number) {
  let travel = 0;

  for (let index = targetIndex + 1; index < items.length; index += 1) {
    const step = items[index];
    if (!step?.inboundTravel) return null;

    travel += step.inboundTravel.minutes;
    if (step.start) return { id: step.id, latestFinish: step.start.minutes - travel };
    if (!step.duration) return null;
    travel += step.duration.minutes;
  }

  return null;
}

export function suggestItemStart(input: SuggestItemStartInput): SuggestedTimeResult {
  const targetIndex = input.items.findIndex((item) => item.id === input.targetItemId);
  const target = input.items[targetIndex];
  if (!target) return { missing: [], status: 'insufficient_evidence' };

  const caveats = new Set<SuggestedTimeCaveat>();
  const reasons: SuggestedTimeReason[] = [{ code: 'DAY_START', references: [] }];
  const visitMinutes = target.duration?.minutes ?? 0;
  if (!target.duration) caveats.add('DURATION_UNKNOWN');

  let earliest = input.dayStartMinute;
  let latest = MINUTES_PER_DAY;

  const predecessor = earliestFromPredecessors(input.items, targetIndex);
  if (predecessor.caveat) caveats.add(predecessor.caveat);
  if (predecessor.minutes !== null) {
    earliest = Math.max(earliest, predecessor.minutes);
    reasons.push({
      code: 'AFTER_PREVIOUS_ITEM',
      references: predecessor.anchorId ? [predecessor.anchorId] : [],
    });
  }

  if (target.startWindow) {
    earliest = Math.max(earliest, target.startWindow.earliestMinute);
    latest = Math.min(latest, target.startWindow.latestMinute);
    reasons.push({ code: 'DAY_PART_WINDOW', references: [target.id] });
  }

  // A KNOWN status with no intervals is Trove saying the place is shut that day,
  // not that its hours are missing. That has to block, not pass through.
  const intervals = target.openingHours.status === 'KNOWN' ? target.openingHours.intervals : null;
  if (intervals === null) caveats.add('OPENING_HOURS_UNKNOWN');

  if (intervals) {
    const opened = firstFittingStart(intervals, earliest, latest, visitMinutes);
    if (opened === null) return { blockedBy: ['OPENING_HOURS'], status: 'no_feasible_time' };
    if (opened > earliest) reasons.push({ code: 'OPENING_HOURS', references: [target.id] });
    earliest = opened;
  }

  // Rounding can push the start past the end of a tight interval, so the fit is
  // re-checked once against the rounded value.
  earliest = roundUp(earliest, input.roundingMinutes);
  if (intervals) {
    const refitted = firstFittingStart(intervals, earliest, latest, visitMinutes);
    if (refitted === null) return { blockedBy: ['OPENING_HOURS'], status: 'no_feasible_time' };
    earliest = refitted;
  }

  const blockers: Blocker[] = [
    ...input.commitments.map((commitment) => ({
      endMinute: commitment.endMinute,
      id: commitment.id,
      startMinute: commitment.startMinute,
    })),
    ...input.items.flatMap((item) => {
      if (item.id === target.id) return [];
      const start = anchoredStart(item);
      if (start === null) return [];
      return [
        { endMinute: start + (item.duration?.minutes ?? 0), id: item.id, startMinute: start },
      ];
    }),
  ];

  const displaced = clearBlockers({
    blockers,
    earliest,
    intervals,
    latest,
    roundingMinutes: input.roundingMinutes,
    visitMinutes,
  });
  if (displaced.cleared.length > 0) {
    reasons.push({ code: 'CLEARS_COMMITMENT', references: displaced.cleared });
  }
  if (displaced.startMinute === null) {
    return {
      blockedBy: displaced.cleared.length > 0 ? ['CLEARS_COMMITMENT'] : ['OPENING_HOURS'],
      status: 'no_feasible_time',
    };
  }
  earliest = displaced.startMinute;

  const limit = nextAnchorLimit(input.items, targetIndex);
  if (limit && earliest + visitMinutes > limit.latestFinish) {
    // `earliest` is already the earliest workable start, so if even that arrives
    // too late for the next fixed item, no start on this day works.
    return { blockedBy: ['BEFORE_FIXED_ITEM'], status: 'no_feasible_time' };
  }
  if (limit) reasons.push({ code: 'BEFORE_FIXED_ITEM', references: [limit.id] });

  if (earliest >= latest) return { blockedBy: ['DAY_PART_WINDOW'], status: 'no_feasible_time' };

  // Only the fallback start contributed, so there is nothing behind this number.
  // A default dressed as a suggestion is worse than admitting there isn't one.
  if (reasons.length === 1) {
    return { missing: [...caveats].toSorted(), status: 'insufficient_evidence' };
  }

  return {
    caveats: [...caveats].toSorted(),
    reasons,
    startMinute: earliest,
    status: 'ok',
  };
}
