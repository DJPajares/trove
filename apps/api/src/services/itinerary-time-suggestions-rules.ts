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
  | 'AVAILABILITY'
  | 'BEFORE_FIXED_ITEM'
  | 'CLEARS_COMMITMENT'
  | 'DAY_PART_WINDOW'
  | 'DAY_START'
  | 'FITS_AROUND_STOPS'
  | 'FROM_STAY'
  | 'OPENING_HOURS'
  | 'PREVIOUS_ITEM_ENDS'
  | 'SUITS_PLACE';

/**
 * What Trove could not establish, or only estimated. A caveat qualifies a
 * suggestion, never blocks it.
 */
export type SuggestedTimeCaveat =
  | 'DURATION_ESTIMATED'
  | 'DURATION_UNKNOWN'
  | 'OPENING_HOURS_UNKNOWN'
  | 'TRAVEL_ESTIMATED'
  | 'TRAVEL_UNKNOWN';

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

/** When a kind of place usually suits a visit; `typicalMinute` is the usual start. */
export type SuggestedTimeWindow = PlanScoreInterval & { typicalMinute?: number };

export type SuggestItemStartInput = {
  /** The traveller's available time that day: the visit starts and ends inside it. */
  availability?: PlanScoreInterval | null;
  commitments: PlanScoreFixedCommitment[];
  dayStartMinute: number;
  /** Items whose duration is only a typical length for their kind of place. */
  inferredDurations?: ReadonlySet<string>;
  /** Items in planned order. Never reordered. */
  items: PlanScoreDayItem[];
  /** Windows the target's kind of place suits, preferred but never required. */
  preferredWindows?: readonly SuggestedTimeWindow[] | null;
  roundingMinutes: number;
  targetItemId: string;
};

type Blocker = { endMinute: number; id: string; startMinute: number };

function roundUp(value: number, step: number) {
  if (step <= 1) return value;
  return Math.ceil(value / step) * step;
}

/**
 * Any stop with a start already occupies its time. A fixed one is a booking;
 * the rest are the traveller's own plans, which a suggestion fits around
 * rather than silently overlapping.
 */
function occupiedStart(item: PlanScoreDayItem) {
  return item.start ? item.start.minutes : null;
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
}): { blockedBy: SuggestedTimeReasonCode | null; cleared: string[]; startMinute: number | null } {
  let start = input.earliest;
  const cleared: string[] = [];

  for (let pass = 0; pass <= input.blockers.length; pass += 1) {
    const clash = input.blockers.find(
      (blocker) => start < blocker.endMinute && blocker.startMinute < start + input.visitMinutes,
    );
    if (!clash) {
      // Running past the window and running out of opening hours are different
      // answers to "why not", so they are reported as different reasons.
      return start >= input.latest
        ? { blockedBy: 'DAY_PART_WINDOW', cleared, startMinute: null }
        : { blockedBy: null, cleared, startMinute: start };
    }

    cleared.push(clash.id);
    start = roundUp(clash.endMinute, input.roundingMinutes);

    if (input.intervals) {
      const reopened = firstFittingStart(input.intervals, start, input.latest, input.visitMinutes);
      if (reopened === null) return { blockedBy: 'OPENING_HOURS', cleared, startMinute: null };
      start = reopened;
    }
  }

  return { blockedBy: 'CLEARS_COMMITMENT', cleared, startMinute: null };
}

type Chain = {
  anchorId?: string;
  caveat: SuggestedTimeCaveat | null;
  /**
   * With a leg unknown, when the stop before that leg ends. Arrival is some
   * unknown time after it, so it is a floor to start from, not an arrival.
   */
  floor?: number;
  /** The chain crossed the day's first leg, from wherever the traveller is staying. */
  fromStay?: boolean;
  minutes: number | null;
  usedEstimatedDuration?: boolean;
  usedEstimatedTravel?: boolean;
};

/**
 * Adds up durations and travel from `startIndex` to the target, starting the
 * clock at `running`. Trove does not guess across a gap: an unknown leg means
 * the arrival time is unknown, not zero.
 */
function chainTo(
  items: PlanScoreDayItem[],
  startIndex: number,
  targetIndex: number,
  running: number,
  inferred: ReadonlySet<string>,
): Chain {
  const chain: Chain = { caveat: null, minutes: null };
  for (let index = startIndex; index <= targetIndex; index += 1) {
    const step = items[index];
    if (!step) return chain;
    const required = step.inboundRequired ?? index > 0;
    if (required) {
      if (!step.inboundTravel)
        return { ...chain, caveat: 'TRAVEL_UNKNOWN', ...(index > 0 ? { floor: running } : {}) };
      running += step.inboundTravel.minutes;
      if (step.inboundTravel.source === 'ESTIMATED') chain.usedEstimatedTravel = true;
      if (index === 0) chain.fromStay = step.inboundTravel.minutes > 0;
    }
    if (index === targetIndex) return { ...chain, minutes: running };
    // A stop the traveller placed in a daypart does not begin before it.
    if (!step.start && step.startWindow)
      running = Math.max(running, step.startWindow.earliestMinute);
    if (!step.duration) return { ...chain, caveat: 'DURATION_UNKNOWN' };
    if (inferred.has(step.id)) chain.usedEstimatedDuration = true;
    running += step.duration.minutes;
  }
  return chain;
}

/**
 * Walks back to the nearest item with an exact start and adds up the durations
 * and travel between it and the target. With no such item the day itself is
 * the anchor: the traveller sets out from their stay at the start of the day
 * and works through the stops before this one in order.
 */
function earliestFromPredecessors(
  items: PlanScoreDayItem[],
  targetIndex: number,
  dayStartMinute: number,
  inferred: ReadonlySet<string>,
): Chain {
  for (let anchorIndex = targetIndex - 1; anchorIndex >= 0; anchorIndex -= 1) {
    const anchor = items[anchorIndex];
    if (!anchor?.start) continue;
    if (!anchor.duration) return { caveat: 'DURATION_UNKNOWN', minutes: null };
    const chain = chainTo(
      items,
      anchorIndex + 1,
      targetIndex,
      anchor.start.minutes + anchor.duration.minutes,
      inferred,
    );
    return {
      ...chain,
      anchorId: anchor.id,
      usedEstimatedDuration: chain.usedEstimatedDuration || inferred.has(anchor.id),
    };
  }
  return chainTo(items, 0, targetIndex, dayStartMinute, inferred);
}

/**
 * The earliest start inside the first preferred window the visit still fits in
 * at or after `earliest`, at the window's usual start where that is still
 * ahead. A lunch squeezed into the window's last minutes is not lunch, so the
 * whole visit has to be over by the window's end. `null` when no window suits
 * the remaining day: the preference is then dropped rather than blocking
 * anything.
 */
function preferredStart(
  windows: readonly SuggestedTimeWindow[],
  earliest: number,
  latest: number,
  visitMinutes: number,
): number | null {
  for (const window of [...windows].toSorted((a, b) => a.startMinute - b.startMinute)) {
    const end = Math.min(window.endMinute - visitMinutes, latest - 1);
    const typical = Math.max(earliest, window.typicalMinute ?? window.startMinute);
    if (typical <= end) return typical;
    const opening = Math.max(earliest, window.startMinute);
    if (opening <= end) return opening;
  }
  return null;
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
  const inferred = input.inferredDurations ?? new Set<string>();
  const availability = input.availability ?? null;
  // The traveller's own start of day is a reason in itself; Trove's default is not.
  const reasons: SuggestedTimeReason[] = [
    { code: availability ? 'AVAILABILITY' : 'DAY_START', references: [] },
  ];
  const visitMinutes = target.duration?.minutes ?? 0;
  if (!target.duration) caveats.add('DURATION_UNKNOWN');
  else if (inferred.has(target.id)) caveats.add('DURATION_ESTIMATED');

  const dayStart = availability?.startMinute ?? input.dayStartMinute;
  let earliest = dayStart;
  let latest = MINUTES_PER_DAY;
  // The visit has to be over by the end of the traveller's available time.
  const latestFinish = availability?.endMinute ?? Infinity;

  if (target.startWindow) {
    earliest = Math.max(earliest, target.startWindow.earliestMinute);
    latest = Math.min(latest, target.startWindow.latestMinute);
  }

  const predecessor = earliestFromPredecessors(input.items, targetIndex, dayStart, inferred);
  if (predecessor.caveat) caveats.add(predecessor.caveat);
  // A chain inferred from the day's start only suggests an order; the daypart the
  // traveller chose outranks it rather than being ruled out by it.
  const chainIsFirm = Boolean(predecessor.anchorId);
  if (
    predecessor.minutes !== null &&
    predecessor.minutes > earliest &&
    (chainIsFirm || predecessor.minutes < latest)
  ) {
    earliest = predecessor.minutes;
    if (predecessor.usedEstimatedDuration) caveats.add('DURATION_ESTIMATED');
    if (predecessor.usedEstimatedTravel) caveats.add('TRAVEL_ESTIMATED');
    const previous = input.items[targetIndex - 1];
    reasons.push(
      targetIndex === 0 && predecessor.fromStay
        ? { code: 'FROM_STAY', references: [] }
        : {
            code: 'AFTER_PREVIOUS_ITEM',
            references: predecessor.anchorId
              ? [predecessor.anchorId]
              : previous
                ? [previous.id]
                : [],
          },
    );
  }

  // An unknown leg still cannot move the start before the stop ahead of it ends.
  // Trove does not guess the travel; it only refuses to overlap what is known.
  else if (
    predecessor.floor !== undefined &&
    predecessor.floor > earliest &&
    (chainIsFirm || predecessor.floor < latest)
  ) {
    earliest = predecessor.floor;
    if (predecessor.usedEstimatedDuration) caveats.add('DURATION_ESTIMATED');
    reasons.push({
      code: 'PREVIOUS_ITEM_ENDS',
      references: predecessor.anchorId ? [predecessor.anchorId] : [],
    });
  }

  if (target.startWindow) reasons.push({ code: 'DAY_PART_WINDOW', references: [target.id] });

  if (input.preferredWindows?.length) {
    const preferred = preferredStart(input.preferredWindows, earliest, latest, visitMinutes);
    if (preferred !== null && preferred > earliest) {
      earliest = preferred;
      reasons.push({ code: 'SUITS_PLACE', references: [target.id] });
    }
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
      const start = occupiedStart(item);
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
  // Stepping past a booking and past one of the traveller's own stops are
  // explained differently: only the first was booked.
  const booked = new Set([
    ...input.commitments.map((commitment) => commitment.id),
    ...input.items.flatMap((item) => (item.fixed ? [item.id] : [])),
  ]);
  const clearedStops = displaced.cleared.filter((id) => !booked.has(id));
  const clearedBookings = displaced.cleared.filter((id) => booked.has(id));
  if (clearedStops.length > 0) {
    reasons.push({ code: 'FITS_AROUND_STOPS', references: clearedStops });
  }
  if (clearedBookings.length > 0) {
    reasons.push({ code: 'CLEARS_COMMITMENT', references: clearedBookings });
  }
  if (displaced.startMinute === null) {
    return { blockedBy: [displaced.blockedBy ?? 'OPENING_HOURS'], status: 'no_feasible_time' };
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
  if (earliest + visitMinutes > latestFinish)
    return { blockedBy: ['AVAILABILITY'], status: 'no_feasible_time' };

  // Only the fallback start contributed, so there is nothing behind this number.
  // A default dressed as a suggestion is worse than admitting there isn't one.
  if (reasons.length === 1 && reasons[0]!.code === 'DAY_START') {
    return { missing: [...caveats].toSorted(), status: 'insufficient_evidence' };
  }

  return {
    caveats: [...caveats].toSorted(),
    reasons,
    startMinute: earliest,
    status: 'ok',
  };
}
