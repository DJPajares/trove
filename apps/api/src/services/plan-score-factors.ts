import type {
  PlanScoreEvidence,
  PlanScoreEvidenceSource,
  PlanScoreFactorResult,
} from './plan-score-rules.js';

/**
 * Plan Score factor evaluators (PRD section 29.1).
 *
 * All are pure and read an already time-zone-resolved description of one day, or
 * of the trip for Must Go priority fit. They never reorder items or change
 * itinerary/reservation data, and unknown routes, locations, times, or provider
 * data stay unknown rather than becoming fabricated zero or worst-case values.
 *
 * Better alternatives are recommendation output only. They are not a weighted
 * factor and cannot reach the day or trip score.
 */

/** A known quantity in minutes together with the reliability of its evidence. */
export type PlanScoreMinutes = { minutes: number; source: PlanScoreEvidenceSource };

/** Minutes from local midnight; `endMinute` may exceed 1440 for overnight hours. */
export type PlanScoreInterval = { endMinute: number; startMinute: number };

/**
 * Callers pass `UNKNOWN` when hours are unavailable or too stale to support the
 * rubric. Hours that remain safely usable are passed with a `STALE` source so
 * they lower confidence instead of being treated as a closed/open fact.
 */
export type PlanScoreOpeningHours =
  | { intervals: PlanScoreInterval[]; source: PlanScoreEvidenceSource; status: 'KNOWN' }
  | { status: 'UNKNOWN' };

/**
 * A coarse timing intent such as Morning, evaluated best-case: the item may begin
 * anywhere from `earliestMinute` up to `latestMinute`, and only a day where no
 * placement in that range works counts as a conflict. `latestMinute` is the
 * latest permissible *start*, not the latest the visit may run to.
 */
export type PlanScoreStartWindow = {
  earliestMinute: number;
  latestMinute: number;
  source: PlanScoreEvidenceSource;
};

export type PlanScoreDayItem = {
  blockType?: string | null;
  /** Known visit duration. */
  duration: PlanScoreMinutes | null;
  /** A fixed commitment cannot be moved, such as a reservation or booked tour. */
  fixed: boolean;
  id: string;
  placeId?: string;
  inboundRequired?: boolean;
  longDistance?: boolean;
  /** Required route time from the previous point in planned order. */
  inboundTravel: PlanScoreMinutes | null;
  openingHours: PlanScoreOpeningHours;
  /** Planned start as minutes from local midnight. */
  start: PlanScoreMinutes | null;
  /** Coarse daypart intent, used only when there is no exact `start`. */
  startWindow: PlanScoreStartWindow | null;
};

export type PlanScoreFixedCommitment = {
  endMinute: number;
  id: string;
  source: PlanScoreEvidenceSource;
  startMinute: number;
  itemId?: string | null;
  endKnown?: boolean;
  startKnown?: boolean;
  longDistance?: boolean;
  indispensable?: boolean;
};

export type PlanScoreFeasibilityInput = {
  /**
   * Fixed-time commitments including structured long-distance flight, train, and
   * ferry journeys, which count as logistics here rather than local travel effort.
   * Supply each underlying commitment once: a reservation already represented by a
   * fixed item must not be repeated here, otherwise it would conflict with itself.
   */
  commitments: PlanScoreFixedCommitment[];
  /** Items in planned order. The evaluator never reorders them. */
  items: PlanScoreDayItem[];
  availability?: PlanScoreInterval | null;
};

export type PlanScoreConflictKind =
  | 'ARRIVES_AFTER_FIXED_START'
  | 'OUTSIDE_OPENING_HOURS'
  | 'OVERLAPPING_COMMITMENTS'
  | 'TIGHT_TRANSITION'
  | 'OUTSIDE_AVAILABILITY';

/** `HARD` and `MATERIAL` are conflicts; `SOFT` is a still-possible risk. */
export type PlanScoreConflictSeverity = 'HARD' | 'MATERIAL' | 'SOFT';

export type PlanScoreConflict = {
  deduction: number;
  /** Identity of the underlying conflict; one identity deducts at most once. */
  id: string;
  kind: PlanScoreConflictKind;
  severity: PlanScoreConflictSeverity;
  verified?: boolean;
  subjectIds: string[];
};

export type PlanScoreFeasibilityEvaluation = {
  conflicts: PlanScoreConflict[];
  factor: PlanScoreFactorResult;
};

export type PlanScoreRouteScope = 'LOCAL' | 'LONG_DISTANCE';

/**
 * One leg of the day's route plan using existing routing semantics: day origin to
 * the first item, item to item, and the last item back to the daily base. The day
 * origin is the daily base, or the trip Starting Location on the first day.
 */
export type PlanScoreRouteSegment =
  | { duration: PlanScoreMinutes; id: string; scope: PlanScoreRouteScope; status: 'KNOWN' }
  | { id: string; scope: PlanScoreRouteScope; status: 'UNKNOWN' };

export type PlanScoreTravelEffortEvaluation = {
  factor: PlanScoreFactorResult;
  /** Total known local route minutes, or `null` when coverage is incomplete. */
  totalMinutes: number | null;
};

const SEVERITY_DEDUCTIONS: Record<PlanScoreConflictSeverity, number> = {
  HARD: 50,
  MATERIAL: 25,
  SOFT: 10,
};

const TRAVEL_EFFORT_BANDS: ReadonlyArray<{ maxMinutes: number; score: number }> = [
  { maxMinutes: 60, score: 100 },
  { maxMinutes: 120, score: 85 },
  { maxMinutes: 180, score: 70 },
  { maxMinutes: 240, score: 50 },
];

const TRAVEL_EFFORT_EXCESS_SCORE = 30;

function assertMinutes(value: number) {
  if (!Number.isFinite(value) || value < 0) throw new Error('invalid_plan_score_minutes');
  return value;
}

/**
 * Total local route time across the day's required segments. Structured
 * long-distance journeys are excluded, and a zero total is only evaluable when
 * every required local segment is known and actually totals zero.
 *
 * A day whose only movement is long-distance has no local travel to weigh, so the
 * factor is `NOT_APPLICABLE` rather than `UNKNOWN`: PRD section 29.1 renormalizes
 * the remaining weights on travel-heavy days instead of penalizing them, and
 * treating a flight as missing route evidence would withhold the day's score for
 * information Trove never intended to hold.
 */
export function evaluateTravelEffort(
  segments: PlanScoreRouteSegment[],
): PlanScoreTravelEffortEvaluation {
  const local = segments.filter((segment) => segment.scope === 'LOCAL');
  const known = local.flatMap((segment) => (segment.status === 'KNOWN' ? [segment] : []));

  if (local.length === 0) {
    return segments.length === 0
      ? { factor: { reason: 'MISSING_EVIDENCE', state: 'UNKNOWN' }, totalMinutes: null }
      : { factor: { state: 'NOT_APPLICABLE' }, totalMinutes: null };
  }

  const evidence: PlanScoreEvidence[] = [];
  let knownMinutes = 0;

  for (const segment of known) {
    knownMinutes += assertMinutes(segment.duration.minutes);
    evidence.push({ ref: `segment:${segment.id}`, source: segment.duration.source });
  }

  const band = (minutes: number) =>
    TRAVEL_EFFORT_BANDS.find((entry) => minutes <= entry.maxMinutes)?.score ??
    TRAVEL_EFFORT_EXCESS_SCORE;

  if (known.length < local.length) {
    // An unknown leg can only add travel, so a known subtotal already past the
    // lightest band proves at least that burden. A lighter subtotal proves
    // nothing: a partial route never passes for a light day.
    if (!known.length || band(knownMinutes) === TRAVEL_EFFORT_BANDS[0]!.score)
      return {
        factor: { reason: 'INSUFFICIENT_EVIDENCE', state: 'UNKNOWN' },
        totalMinutes: null,
      };
    return {
      factor: {
        evidence,
        score: band(knownMinutes),
        state: 'EVALUATED',
        coverage: (100 * known.length) / local.length,
      },
      totalMinutes: null,
    };
  }

  return {
    factor: { evidence, score: band(knownMinutes), state: 'EVALUATED' },
    totalMinutes: knownMinutes,
  };
}

function overlaps(left: PlanScoreInterval, right: PlanScoreInterval) {
  if (left.startMinute === left.endMinute)
    return right.startMinute <= left.startMinute && left.startMinute < right.endMinute;
  if (right.startMinute === right.endMinute)
    return left.startMinute <= right.startMinute && right.startMinute < left.endMinute;
  return left.startMinute < right.endMinute && right.startMinute < left.endMinute;
}

/**
 * An item is only anchored in time when the user gave it an exact start. A
 * daypart is an intent, not a commitment, so a windowed item is never treated as
 * fixed even when it carries a reservation: that reservation's real time reaches
 * the evaluator through `commitments` instead.
 */
function isAnchored(item: PlanScoreDayItem) {
  return item.fixed && item.start !== null;
}

function openingHoursSeverity(
  intervals: PlanScoreInterval[],
  startMinute: number,
  durationMinutes: number | null,
): PlanScoreConflictSeverity | null {
  for (const interval of intervals) {
    if (!Number.isFinite(interval.startMinute) || !Number.isFinite(interval.endMinute))
      throw new Error('invalid_plan_score_minutes');
  }

  if (durationMinutes === null || durationMinutes <= 0) {
    const openAtStart = intervals.some(
      (interval) => interval.startMinute <= startMinute && startMinute < interval.endMinute,
    );
    return openAtStart ? null : 'HARD';
  }

  const visit = { endMinute: startMinute + durationMinutes, startMinute };
  let openMinutes = 0;

  for (const interval of intervals) {
    const overlap =
      Math.min(visit.endMinute, interval.endMinute) -
      Math.max(visit.startMinute, interval.startMinute);
    openMinutes += Math.max(0, overlap);
  }

  if (openMinutes <= 0) return 'HARD';
  return openMinutes < durationMinutes ? 'MATERIAL' : null;
}

/**
 * Starts at 100 and applies each distinct known conflict's single highest
 * deduction. Detection is limited to evidence the day actually has, so missing
 * times, locations, routes, or provider hours never produce a deduction.
 */
export function evaluateFeasibility(
  input: PlanScoreFeasibilityInput,
): PlanScoreFeasibilityEvaluation {
  const evidence = new Map<string, PlanScoreEvidence>();
  const conflicts = new Map<string, PlanScoreConflict>();
  let applicable = 0,
    evaluated = 0;
  const use = (ref: string, source: PlanScoreEvidenceSource) => evidence.set(ref, { ref, source });
  const trusted = (source: PlanScoreEvidenceSource) =>
    source === 'USER_OWNED' || source === 'FRESH_PROVIDER' || source === 'CACHED_PROVIDER';
  const record = (
    id: string,
    kind: PlanScoreConflictKind,
    severity: PlanScoreConflictSeverity,
    subjectIds: string[],
    verified: boolean,
  ) => {
    const qualified = severity === 'HARD' && !verified ? 'SOFT' : severity;
    const next = {
      id,
      kind,
      severity: qualified,
      subjectIds,
      verified,
      deduction: SEVERITY_DEDUCTIONS[qualified],
    };
    const old = conflicts.get(id);
    if (!old || next.deduction > old.deduction) conflicts.set(id, next);
  };
  // Linked reservations are already represented by their item; never collide with themselves.
  const commitments = input.commitments.filter(
    (c) => !c.itemId || !input.items.some((i) => i.id === c.itemId),
  );
  const fixed: Array<PlanScoreInterval & { id: string; verified: boolean }> = [];
  for (const c of commitments) {
    assertMinutes(c.startMinute);
    assertMinutes(c.endMinute);
    applicable++;
    use(`commitment:${c.id}`, c.source);
    if (c.endKnown !== false) evaluated++;
    if (c.startKnown !== false)
      fixed.push({
        id: c.id,
        startMinute: c.startMinute,
        endMinute: c.endMinute,
        verified: trusted(c.source),
      });
  }
  for (const item of input.items) {
    if (!isAnchored(item)) continue;
    fixed.push({
      id: item.id,
      startMinute: item.start!.minutes,
      endMinute: item.start!.minutes + (item.duration?.minutes ?? 0),
      verified: trusted(item.start!.source) && (!item.duration || trusted(item.duration.source)),
    });
  }
  for (let i = 0; i < fixed.length; i++)
    for (let j = i + 1; j < fixed.length; j++) {
      const a = fixed[i]!,
        b = fixed[j]!;
      if (a.id === b.id || !overlaps(a, b)) continue;
      const refs = [a.id, b.id].sort();
      record(
        `collision:${refs.join(':')}`,
        'OVERLAPPING_COMMITMENTS',
        'HARD',
        refs,
        a.verified && b.verified,
      );
    }
  let earliest: number | null =
    input.availability?.startMinute ?? Math.min(0, input.items[0]?.start?.minutes ?? 0);
  let chainTrusted = true;
  for (const [index, item] of input.items.entries()) {
    const duration = item.duration?.minutes ?? null;
    applicable++;
    if (item.duration) use(`duration:${item.id}`, item.duration.source);
    if (item.start) use(`start:${item.id}`, item.start.source);
    if (item.startWindow) use(`window:${item.id}`, item.startWindow.source);
    const inboundRequired = item.inboundRequired ?? index > 0;
    const previous = input.items[index - 1];
    if (inboundRequired) {
      applicable++; // Transition feasibility is independent of the block itself.
      if (item.inboundTravel && earliest !== null) {
        use(`travel:${item.id}`, item.inboundTravel.source);
        evaluated++;
        earliest += item.inboundTravel.minutes;
        chainTrusted = chainTrusted && trusted(item.inboundTravel.source);
      } else {
        earliest = null;
        chainTrusted = false;
      }
    }
    const minimum =
      item.startWindow?.earliestMinute ??
      (item.fixed ? item.start?.minutes : null) ??
      input.availability?.startMinute ??
      0;
    let start: number | null =
      earliest === null
        ? (item.start?.minutes ??
          item.startWindow?.earliestMinute ??
          input.availability?.startMinute ??
          null)
        : Math.max(earliest, minimum);
    const deadline = item.fixed ? item.start?.minutes : item.startWindow?.latestMinute;
    const timingTrusted: boolean =
      chainTrusted && (!previous?.duration || trusted(previous.duration.source));
    if (earliest !== null && deadline != null) {
      const remaining = deadline - earliest;
      const refs = previous ? [previous.id, item.id] : [item.id];
      const collision = `collision:${[...refs].sort().join(':')}`;
      if (item.fixed && remaining < 0 && !conflicts.has(collision)) {
        record(
          collision,
          'ARRIVES_AFTER_FIXED_START',
          item.fixed && -remaining > 30 ? 'HARD' : 'MATERIAL',
          refs,
          timingTrusted && (!item.fixed || (item.start !== null && trusted(item.start.source))),
        );
      } else if (
        item.fixed &&
        remaining >= 0 &&
        remaining < 15 &&
        previous &&
        item.blockType !== 'free_time'
      ) {
        record(collision, 'TIGHT_TRANSITION', 'SOFT', refs, timingTrusted);
      }
    }
    if (item.fixed && item.start) start = item.start.minutes;
    if (!isAnchored(item) && start !== null && duration !== null) {
      // Earliest feasible placement in the complete ordered schedule. Wait for an opening
      // or move past a standalone commitment; do not reorder the itinerary.
      for (
        let pass = 0;
        pass <=
        commitments.length +
          (item.openingHours.status === 'KNOWN' ? item.openingHours.intervals.length : 0) +
          1;
        pass++
      ) {
        let moved: number = start;
        if (item.openingHours.status === 'KNOWN') {
          const fitting = item.openingHours.intervals.find(
            (h) => Math.max(start!, h.startMinute) + duration <= h.endMinute,
          );
          if (fitting) moved = Math.max(moved, fitting.startMinute);
        }
        for (const c of commitments) {
          if (c.endKnown !== false && moved < c.endMinute && moved + duration > c.startMinute)
            moved = c.endMinute;
        }
        if (moved === start) break;
        start = moved;
      }
    }
    if (
      !isAnchored(item) &&
      item.startWindow &&
      start !== null &&
      start > item.startWindow.latestMinute
    )
      record(
        `window:${item.id}`,
        'ARRIVES_AFTER_FIXED_START',
        'MATERIAL',
        [item.id],
        timingTrusted && (item.duration === null || trusted(item.duration.source)),
      );
    const intrinsicTiming =
      item.start !== null || item.startWindow !== null || input.availability != null;
    if (
      (!item.blockType || item.blockType === 'activity') &&
      (item.openingHours.status === 'KNOWN' || item.placeId)
    ) {
      applicable++;
      if (item.openingHours.status === 'KNOWN') {
        use(`hours:${item.id}`, item.openingHours.source);
        const point = intrinsicTiming
          ? (start ?? item.start?.minutes ?? item.startWindow?.earliestMinute)
          : null;
        const closed = item.openingHours.intervals.length === 0;
        if (closed || point != null) {
          evaluated++;
          const severity = closed
            ? 'HARD'
            : openingHoursSeverity(item.openingHours.intervals, point!, duration);
          if (severity) {
            const independentClosure =
              closed ||
              (item.fixed &&
                item.start !== null &&
                trusted(item.start.source) &&
                duration !== null &&
                item.duration !== null &&
                trusted(item.duration.source) &&
                item.openingHours.intervals.every(
                  (h) => h.endMinute <= point! || h.startMinute >= point! + duration,
                ));
            const verified =
              trusted(item.openingHours.source) &&
              (independentClosure ||
                (timingTrusted &&
                  (!item.fixed || (item.start !== null && trusted(item.start.source))) &&
                  item.duration !== null &&
                  trusted(item.duration.source)));
            record(
              `hours:${item.id}`,
              'OUTSIDE_OPENING_HOURS',
              severity === 'HARD' && !item.fixed && !closed ? 'MATERIAL' : severity,
              [item.id],
              verified,
            );
          }
        }
      }
    }
    if (start !== null && duration !== null && intrinsicTiming) evaluated++;
    if (
      input.availability &&
      start !== null &&
      duration !== null &&
      start + duration > input.availability.endMinute
    ) {
      record(
        `availability:${item.id}`,
        'OUTSIDE_AVAILABILITY',
        'MATERIAL',
        [item.id],
        trusted(item.duration!.source) &&
          (timingTrusted ||
            (isAnchored(item) && trusted(item.start!.source)) ||
            (item.startWindow !== null &&
              trusted(item.startWindow.source) &&
              Math.max(input.availability.startMinute, item.startWindow.earliestMinute) + duration >
                input.availability.endMinute) ||
            duration > input.availability.endMinute - input.availability.startMinute),
      );
    }
    if (duration === null || start === null) {
      earliest = null;
      chainTrusted = false;
    } else {
      earliest = start + duration;
      chainTrusted =
        (item.fixed && item.start ? trusted(item.start.source) : timingTrusted) &&
        trusted(item.duration!.source);
    }
  }
  if (!applicable) return { conflicts: [], factor: { state: 'NOT_APPLICABLE' } };
  if (!evaluated || !evidence.size)
    return {
      conflicts: [...conflicts.values()],
      factor: { reason: 'MISSING_EVIDENCE', state: 'UNKNOWN' },
    };
  // A flexible placement missing both its window and opening/availability boundary
  // is one unsatisfied placement, not two independent conflicts.
  for (const item of input.items.filter((i) => !i.fixed)) {
    const keys = [`window:${item.id}`, `hours:${item.id}`, `availability:${item.id}`];
    const detected = keys.flatMap((key) => (conflicts.has(key) ? [conflicts.get(key)!] : []));
    if (detected.length > 1) {
      const primary = detected.toSorted((a, b) => b.deduction - a.deduction)[0]!;
      for (const key of keys) if (key !== primary.id) conflicts.delete(key);
    }
  }
  const detected = [...conflicts.values()];
  return {
    conflicts: detected,
    factor: {
      state: 'EVALUATED',
      coverage: (100 * evaluated) / applicable,
      evidence: [...evidence.values()],
      score: Math.max(0, 100 - detected.reduce((n, c) => n + c.deduction, 0)),
    },
  };
}

export type PlanScorePaceEvaluation = {
  /** Known activity plus local travel minutes, or `null` when the day is not fully described. */
  activeMinutes: number | null;
  factor: PlanScoreFactorResult;
  /** Smallest transition buffer between timed items, or `null` when none is evaluable. */
  smallestBufferMinutes: number | null;
};

export type PlanScoreRouteStop = {
  /** A stop pinned by a fixed-order commitment keeps its planned position. */
  fixed: boolean;
  id: string;
  placeId?: string;
  inboundRequired?: boolean;
  longDistance?: boolean;
};

export type PlanScoreRouteLeg = { duration: PlanScoreMinutes; fromId: string; toId: string };

export type PlanScoreRouteEfficiencyInput = {
  /** Known pairwise route durations. Direction matters, so supply each leg used. */
  legs: PlanScoreRouteLeg[];
  /** Stops in planned order, including base endpoints when the day has them. */
  stops: PlanScoreRouteStop[];
  isFeasibleOrder?: (order: readonly string[]) => boolean;
};

export type PlanScoreRouteEfficiencyEvaluation = {
  /** Duration of the best comparable order, or `null` when it cannot be derived. */
  bestMinutes: number | null;
  factor: PlanScoreFactorResult;
  plannedMinutes: number | null;
};

const ROUTE_EFFICIENCY_MINIMUM_STOPS = 3;

/** Movable-stop ceiling that keeps the exhaustive comparison deterministic and bounded. */
const ROUTE_EFFICIENCY_MOVABLE_LIMIT = 8;

const ROUTE_EFFICIENCY_BANDS: ReadonlyArray<{ maxRatio: number; score: number }> = [
  { maxRatio: 1.1, score: 100 },
  { maxRatio: 1.25, score: 80 },
  { maxRatio: 1.5, score: 60 },
  { maxRatio: 2, score: 40 },
];

const ROUTE_EFFICIENCY_EXCESS_SCORE = 20;

function forEachPermutation<T>(values: T[], visit: (permutation: T[]) => void) {
  if (values.length === 0) {
    visit([]);
    return;
  }

  values.forEach((value, index) => {
    const rest = [...values.slice(0, index), ...values.slice(index + 1)];
    forEachPermutation(rest, (permutation) => visit([value, ...permutation]));
  });
}

function legKey(fromId: string, toId: string) {
  return `${fromId}>${toId}`;
}

function orderDuration(order: string[], legs: Map<string, PlanScoreMinutes>) {
  const used: PlanScoreEvidence[] = [];
  let total = 0;

  for (let index = 1; index < order.length; index += 1) {
    const from = order[index - 1];
    const to = order[index];
    if (from === undefined || to === undefined) return null;

    const key = legKey(from, to);
    const leg = legs.get(key);
    if (!leg) return null;

    total += assertMinutes(leg.minutes);
    used.push({ ref: `leg:${key}`, source: leg.source });
  }

  return { total, used };
}

/**
 * Compares the planned order with the best order of the same stops that respects
 * fixed-order commitments. The comparison is advisory: nothing is reordered.
 */
export function evaluateRouteEfficiency(
  input: PlanScoreRouteEfficiencyInput,
): PlanScoreRouteEfficiencyEvaluation {
  const unevaluated = (
    factor: PlanScoreFactorResult,
    plannedMinutes: number | null = null,
  ): PlanScoreRouteEfficiencyEvaluation => ({ bestMinutes: null, factor, plannedMinutes });

  if (input.stops.length < ROUTE_EFFICIENCY_MINIMUM_STOPS) {
    return unevaluated({ state: 'NOT_APPLICABLE' });
  }

  const legs = new Map<string, PlanScoreMinutes>();
  for (const leg of input.legs) legs.set(legKey(leg.fromId, leg.toId), leg.duration);

  const plannedOrder = input.stops.map((stop) => stop.id);
  const planned = orderDuration(plannedOrder, legs);
  if (!planned) return unevaluated({ reason: 'INSUFFICIENT_EVIDENCE', state: 'UNKNOWN' });

  const movable = input.stops.flatMap((stop, index) =>
    stop.fixed ? [] : [{ id: stop.id, index }],
  );
  // With fewer than two movable stops there is no other order to compare, so
  // avoidable movement does not apply rather than being unknown.
  if (movable.length < 2) return unevaluated({ state: 'NOT_APPLICABLE' }, planned.total);
  if (movable.length > ROUTE_EFFICIENCY_MOVABLE_LIMIT) {
    return unevaluated({ reason: 'UNUSABLE_EVIDENCE', state: 'UNKNOWN' }, planned.total);
  }

  let best = planned;
  let compared = 0;
  let incomplete = false;
  forEachPermutation(
    movable.map((entry) => entry.id),
    (permutation) => {
      const candidateOrder = [...plannedOrder];
      movable.forEach((entry, offset) => {
        const id = permutation[offset];
        if (id !== undefined) candidateOrder[entry.index] = id;
      });

      if (candidateOrder.every((id, index) => id === plannedOrder[index])) return;
      const candidate = orderDuration(candidateOrder, legs);
      if (!candidate) {
        incomplete = true;
        return;
      }
      if (!input.isFeasibleOrder || !input.isFeasibleOrder(candidateOrder)) return;
      compared++;
      if (candidate.total < best.total) best = candidate;
    },
  );

  if (!compared || incomplete)
    return unevaluated({ reason: 'INSUFFICIENT_EVIDENCE', state: 'UNKNOWN' }, planned.total);
  const ratio = best.total <= 0 ? (planned.total > 0 ? Infinity : 1) : planned.total / best.total;
  const band = ROUTE_EFFICIENCY_BANDS.find((entry) => ratio <= entry.maxRatio);
  const evidence = new Map<string, PlanScoreEvidence>();
  for (const entry of [...planned.used, ...best.used]) {
    if (!evidence.has(entry.ref)) evidence.set(entry.ref, entry);
  }

  return {
    bestMinutes: best.total,
    factor: {
      evidence: [...evidence.values()],
      score: band?.score ?? ROUTE_EFFICIENCY_EXCESS_SCORE,
      state: 'EVALUATED',
    },
    plannedMinutes: planned.total,
  };
}

export type PlanScoreMustGoInput = {
  /** Distinct Trip Places the traveller marked Must Go. */
  mustGoTripPlaceIds: string[];
  /** Distinct Trip Places scheduled anywhere in the itinerary. */
  scheduledTripPlaceIds: string[];
  /** Reliability of the Must Go and scheduling evidence, which Trove owns. */
  source: PlanScoreEvidenceSource;
};

/**
 * Trip-scoped priority fit. Unscheduled priorities lower the proportion rather
 * than applying a penalty, and a trip without Must Go Places is not applicable.
 */
export function evaluateMustGoPriorityFit(input: PlanScoreMustGoInput): PlanScoreFactorResult {
  const mustGo = [...new Set(input.mustGoTripPlaceIds)];
  if (mustGo.length === 0) return { state: 'NOT_APPLICABLE' };

  const scheduled = new Set(input.scheduledTripPlaceIds);
  const covered = mustGo.filter((tripPlaceId) => scheduled.has(tripPlaceId));

  return {
    evidence: mustGo.map((tripPlaceId) => ({
      ref: `must-go:${tripPlaceId}`,
      source: input.source,
    })),
    score: (100 * covered.length) / mustGo.length,
    state: 'EVALUATED',
  };
}

export type PlanScoreRating =
  | {
      rating: number;
      source: PlanScoreEvidenceSource;
      status: 'KNOWN';
      reviewCount?: number | null;
    }
  | { status: 'UNKNOWN' };

export type PlanScorePlace = { rating: PlanScoreRating; tripPlaceId: string };

const MAXIMUM_PUBLIC_RATING = 5;

function ratingScore(rating: number) {
  if (!Number.isFinite(rating) || rating < 0 || rating > MAXIMUM_PUBLIC_RATING) {
    throw new Error('invalid_public_rating');
  }

  const anchors = [
    [0, 40],
    [3, 55],
    [3.5, 70],
    [4, 85],
    [4.5, 100],
    [5, 100],
  ] as const;
  for (let index = 1; index < anchors.length; index++) {
    const [x, y] = anchors[index]!,
      [px, py] = anchors[index - 1]!;
    if (rating <= x) return py + ((y - py) * (rating - px)) / (x - px);
  }
  return 100;
}

/**
 * Supporting provider-backed signal. Places without a usable current rating are
 * excluded rather than treated as poor quality, and identical Trip Places count
 * once no matter how often they are scheduled.
 */
export function evaluatePlaceQuality(places: PlanScorePlace[]): PlanScoreFactorResult {
  const distinct = new Map<string, PlanScorePlace>();
  for (const place of places) {
    if (!distinct.has(place.tripPlaceId)) distinct.set(place.tripPlaceId, place);
  }

  const rated = [...distinct.values()].flatMap((place) =>
    place.rating.status === 'KNOWN'
      ? [{ rating: place.rating, tripPlaceId: place.tripPlaceId }]
      : [],
  );
  if (rated.length === 0) return { reason: 'MISSING_EVIDENCE', state: 'UNKNOWN' };

  const total = rated.reduce((sum, place) => sum + ratingScore(place.rating.rating), 0);

  return {
    evidence: rated.map((place) => ({
      ref: `rating:${place.tripPlaceId}`,
      source: place.rating.source,
      strength:
        place.rating.reviewCount == null
          ? 0.5
          : place.rating.reviewCount / (place.rating.reviewCount + 50),
    })),
    score: total / rated.length,
    coverage: (100 * rated.length) / distinct.size,
    state: 'EVALUATED',
  };
}

/**
 * Suggestion action types from PRD section 29.4. Only `REPLACE` is derivable from
 * place-quality evidence; `ADD` suggestions come from the explanation task.
 */
export type PlanScoreAlternativeAction = 'ADD' | 'REPLACE';

export type PlanScoreReplacementCandidate = {
  candidate: PlanScorePlace;
  current: PlanScorePlace;
  targetItemId: string;
};

export type PlanScoreAlternative = {
  action: PlanScoreAlternativeAction;
  /** Public rating of the suggested Place, so the benefit can be explained in user terms. */
  candidateRating: number;
  candidateTripPlaceId: string;
  /** Public rating of the Place currently on the targeted item. */
  currentRating: number;
  /** Place-quality points gained; at least one full rubric band. */
  improvement: number;
  targetItemId: string;
};

/** One full place-quality band, the smallest improvement worth interrupting a plan for. */
const MATERIAL_IMPROVEMENT = 15;

/**
 * Recommendation output only. Alternatives are never a weighted factor and never
 * change the itinerary; the caller presents them for explicit confirmation.
 */
export function buildReplacementAlternatives(
  candidates: PlanScoreReplacementCandidate[],
): PlanScoreAlternative[] {
  return candidates.flatMap((entry) => {
    if (entry.candidate.rating.status !== 'KNOWN' || entry.current.rating.status !== 'KNOWN') {
      return [];
    }
    if (entry.candidate.tripPlaceId === entry.current.tripPlaceId) return [];

    const improvement =
      ratingScore(entry.candidate.rating.rating) - ratingScore(entry.current.rating.rating);
    if (improvement < MATERIAL_IMPROVEMENT) return [];

    return [
      {
        action: 'REPLACE' as const,
        candidateRating: entry.candidate.rating.rating,
        candidateTripPlaceId: entry.candidate.tripPlaceId,
        currentRating: entry.current.rating.rating,
        improvement,
        targetItemId: entry.targetItemId,
      },
    ];
  });
}
