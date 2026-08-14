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

export type PlanScoreDayItem = {
  /** Known visit duration. */
  duration: PlanScoreMinutes | null;
  /** A fixed commitment cannot be moved, such as a reservation or booked tour. */
  fixed: boolean;
  id: string;
  /** Required route time from the previous point in planned order. */
  inboundTravel: PlanScoreMinutes | null;
  openingHours: PlanScoreOpeningHours;
  /** Planned start as minutes from local midnight. */
  start: PlanScoreMinutes | null;
};

export type PlanScoreFixedCommitment = {
  endMinute: number;
  id: string;
  source: PlanScoreEvidenceSource;
  startMinute: number;
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
};

export type PlanScoreConflictKind =
  | 'ARRIVES_AFTER_FIXED_START'
  | 'OUTSIDE_OPENING_HOURS'
  | 'OVERLAPPING_COMMITMENTS'
  | 'TIGHT_TRANSITION';

/** `HARD` and `MATERIAL` are conflicts; `SOFT` is a still-possible risk. */
export type PlanScoreConflictSeverity = 'HARD' | 'MATERIAL' | 'SOFT';

export type PlanScoreConflict = {
  deduction: number;
  /** Identity of the underlying conflict; one identity deducts at most once. */
  id: string;
  kind: PlanScoreConflictKind;
  severity: PlanScoreConflictSeverity;
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

const LATE_ARRIVAL_HARD_MINUTES = 30;
const TIGHT_TRANSITION_MINUTES = 15;

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
 */
export function evaluateTravelEffort(
  segments: PlanScoreRouteSegment[],
): PlanScoreTravelEffortEvaluation {
  const local = segments.filter((segment) => segment.scope === 'LOCAL');
  const known = local.flatMap((segment) => (segment.status === 'KNOWN' ? [segment] : []));

  if (local.length === 0) {
    return { factor: { reason: 'MISSING_EVIDENCE', state: 'UNKNOWN' }, totalMinutes: null };
  }
  if (known.length < local.length) {
    return { factor: { reason: 'INSUFFICIENT_EVIDENCE', state: 'UNKNOWN' }, totalMinutes: null };
  }

  const evidence: PlanScoreEvidence[] = [];
  let totalMinutes = 0;

  for (const segment of known) {
    totalMinutes += assertMinutes(segment.duration.minutes);
    evidence.push({ ref: `segment:${segment.id}`, source: segment.duration.source });
  }

  const band = TRAVEL_EFFORT_BANDS.find((entry) => totalMinutes <= entry.maxMinutes);

  return {
    factor: { evidence, score: band?.score ?? TRAVEL_EFFORT_EXCESS_SCORE, state: 'EVALUATED' },
    totalMinutes,
  };
}

function overlaps(left: PlanScoreInterval, right: PlanScoreInterval) {
  return left.startMinute < right.endMinute && right.startMinute < left.endMinute;
}

function openingHoursSeverity(
  intervals: PlanScoreInterval[],
  startMinute: number,
  durationMinutes: number | null,
): PlanScoreConflictSeverity | null {
  for (const interval of intervals) {
    assertMinutes(interval.startMinute);
    assertMinutes(interval.endMinute);
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

function transitionSeverity(fixed: boolean, bufferMinutes: number) {
  if (bufferMinutes < 0) {
    if (!fixed) return null;
    const severity = -bufferMinutes > LATE_ARRIVAL_HARD_MINUTES ? 'HARD' : 'MATERIAL';
    return { kind: 'ARRIVES_AFTER_FIXED_START', severity } as const;
  }

  if (bufferMinutes < TIGHT_TRANSITION_MINUTES) {
    return { kind: 'TIGHT_TRANSITION', severity: 'SOFT' } as const;
  }

  return null;
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

  const use = (ref: string, source: PlanScoreEvidenceSource) => {
    if (!evidence.has(ref)) evidence.set(ref, { ref, source });
  };
  const record = (conflict: PlanScoreConflict) => {
    const existing = conflicts.get(conflict.id);
    if (!existing || conflict.deduction > existing.deduction) conflicts.set(conflict.id, conflict);
  };

  const intervals: Array<PlanScoreInterval & { id: string }> = [];

  for (const commitment of input.commitments) {
    use(`commitment:${commitment.id}`, commitment.source);
    intervals.push({
      endMinute: assertMinutes(commitment.endMinute),
      id: commitment.id,
      startMinute: assertMinutes(commitment.startMinute),
    });
  }

  for (const item of input.items) {
    if (!item.fixed || !item.start || !item.duration) continue;

    use(`start:${item.id}`, item.start.source);
    use(`duration:${item.id}`, item.duration.source);
    intervals.push({
      endMinute: assertMinutes(item.start.minutes) + assertMinutes(item.duration.minutes),
      id: item.id,
      startMinute: item.start.minutes,
    });
  }

  for (let left = 0; left < intervals.length; left += 1) {
    for (let right = left + 1; right < intervals.length; right += 1) {
      const first = intervals[left];
      const second = intervals[right];
      if (!first || !second || !overlaps(first, second)) continue;

      const subjectIds = [first.id, second.id].toSorted((one, other) => one.localeCompare(other));
      record({
        deduction: SEVERITY_DEDUCTIONS.HARD,
        id: `overlap:${subjectIds.join(':')}`,
        kind: 'OVERLAPPING_COMMITMENTS',
        severity: 'HARD',
        subjectIds,
      });
    }
  }

  for (const item of input.items) {
    if (item.openingHours.status !== 'KNOWN' || !item.start) continue;

    use(`start:${item.id}`, item.start.source);
    use(`hours:${item.id}`, item.openingHours.source);
    if (item.duration) use(`duration:${item.id}`, item.duration.source);

    const severity = openingHoursSeverity(
      item.openingHours.intervals,
      assertMinutes(item.start.minutes),
      item.duration ? assertMinutes(item.duration.minutes) : null,
    );
    if (!severity) continue;

    record({
      deduction: SEVERITY_DEDUCTIONS[severity],
      id: `hours:${item.id}`,
      kind: 'OUTSIDE_OPENING_HOURS',
      severity,
      subjectIds: [item.id],
    });
  }

  for (let index = 1; index < input.items.length; index += 1) {
    const previous = input.items[index - 1];
    const next = input.items[index];
    if (!previous?.start || !previous.duration || !next?.start || !next.inboundTravel) continue;

    use(`start:${previous.id}`, previous.start.source);
    use(`duration:${previous.id}`, previous.duration.source);
    use(`start:${next.id}`, next.start.source);
    use(`travel:${next.id}`, next.inboundTravel.source);

    const arrival =
      assertMinutes(previous.start.minutes) +
      assertMinutes(previous.duration.minutes) +
      assertMinutes(next.inboundTravel.minutes);
    const transition = transitionSeverity(next.fixed, assertMinutes(next.start.minutes) - arrival);
    if (!transition) continue;

    record({
      deduction: SEVERITY_DEDUCTIONS[transition.severity],
      id: `transition:${next.id}`,
      kind: transition.kind,
      severity: transition.severity,
      subjectIds: [previous.id, next.id],
    });
  }

  if (evidence.size === 0) {
    return { conflicts: [], factor: { reason: 'MISSING_EVIDENCE', state: 'UNKNOWN' } };
  }

  const detected = [...conflicts.values()];
  const deducted = detected.reduce((total, conflict) => total + conflict.deduction, 0);

  return {
    conflicts: detected,
    factor: {
      evidence: [...evidence.values()],
      score: Math.max(0, 100 - deducted),
      state: 'EVALUATED',
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

export type PlanScorePaceInput = {
  /** Items in planned order, sharing the day model used by Feasibility. */
  items: PlanScoreDayItem[];
  /** The day's required local route segments, as used by Travel effort. */
  segments: PlanScoreRouteSegment[];
};

function bufferScore(bufferMinutes: number) {
  if (bufferMinutes < 0) return 20;
  if (bufferMinutes < 5) return 40;
  if (bufferMinutes < 15) return 60;
  if (bufferMinutes < 30) return 80;
  return 100;
}

function activeMinutesScore(totalMinutes: number) {
  if (totalMinutes <= 480) return 100;
  if (totalMinutes <= 600) return 75;
  if (totalMinutes <= 720) return 50;
  return 25;
}

/**
 * Uses the lower of the two applicable rubric rules: the smallest transition
 * buffer between timed items, and how much of the day known activity duration
 * plus local travel consumes. The second rule needs the day to be fully
 * described, so partial duration or route coverage leaves it unevaluated rather
 * than understating how packed the day is.
 */
export function evaluatePaceBuffer(input: PlanScorePaceInput): PlanScorePaceEvaluation {
  const evidence = new Map<string, PlanScoreEvidence>();
  const use = (ref: string, source: PlanScoreEvidenceSource) => {
    if (!evidence.has(ref)) evidence.set(ref, { ref, source });
  };

  const timedItems = input.items.filter((item) => item.start !== null);
  let smallestBufferMinutes: number | null = null;

  if (timedItems.length >= 2) {
    for (let index = 1; index < input.items.length; index += 1) {
      const previous = input.items[index - 1];
      const next = input.items[index];
      if (!previous?.start || !previous.duration || !next?.start || !next.inboundTravel) continue;

      use(`start:${previous.id}`, previous.start.source);
      use(`duration:${previous.id}`, previous.duration.source);
      use(`start:${next.id}`, next.start.source);
      use(`travel:${next.id}`, next.inboundTravel.source);

      const buffer =
        assertMinutes(next.start.minutes) -
        (assertMinutes(previous.start.minutes) +
          assertMinutes(previous.duration.minutes) +
          assertMinutes(next.inboundTravel.minutes));
      smallestBufferMinutes = Math.min(smallestBufferMinutes ?? buffer, buffer);
    }
  }

  const localSegments = input.segments.filter((segment) => segment.scope === 'LOCAL');
  const knownSegments = localSegments.flatMap((segment) =>
    segment.status === 'KNOWN' ? [segment] : [],
  );
  const describesDay =
    input.items.length > 0 &&
    input.items.every((item) => item.duration !== null) &&
    knownSegments.length === localSegments.length;
  let activeMinutes: number | null = null;

  if (describesDay) {
    activeMinutes = 0;
    for (const item of input.items) {
      if (!item.duration) continue;
      use(`duration:${item.id}`, item.duration.source);
      activeMinutes += assertMinutes(item.duration.minutes);
    }
    for (const segment of knownSegments) {
      use(`segment:${segment.id}`, segment.duration.source);
      activeMinutes += assertMinutes(segment.duration.minutes);
    }
  }

  const scores = [
    smallestBufferMinutes === null ? null : bufferScore(smallestBufferMinutes),
    activeMinutes === null ? null : activeMinutesScore(activeMinutes),
  ].flatMap((score) => (score === null ? [] : [score]));

  if (scores.length === 0) {
    return {
      activeMinutes: null,
      factor: { reason: 'INSUFFICIENT_EVIDENCE', state: 'UNKNOWN' },
      smallestBufferMinutes: null,
    };
  }

  return {
    activeMinutes,
    factor: { evidence: [...evidence.values()], score: Math.min(...scores), state: 'EVALUATED' },
    smallestBufferMinutes,
  };
}

export type PlanScoreRouteStop = {
  /** A stop pinned by a fixed-order commitment keeps its planned position. */
  fixed: boolean;
  id: string;
};

export type PlanScoreRouteLeg = { duration: PlanScoreMinutes; fromId: string; toId: string };

export type PlanScoreRouteEfficiencyInput = {
  /** Known pairwise route durations. Direction matters, so supply each leg used. */
  legs: PlanScoreRouteLeg[];
  /** Stops in planned order, including base endpoints when the day has them. */
  stops: PlanScoreRouteStop[];
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
  if (movable.length > ROUTE_EFFICIENCY_MOVABLE_LIMIT) {
    return unevaluated({ reason: 'UNUSABLE_EVIDENCE', state: 'UNKNOWN' }, planned.total);
  }

  let best = planned;
  forEachPermutation(
    movable.map((entry) => entry.id),
    (permutation) => {
      const candidateOrder = [...plannedOrder];
      movable.forEach((entry, offset) => {
        const id = permutation[offset];
        if (id !== undefined) candidateOrder[entry.index] = id;
      });

      const candidate = orderDuration(candidateOrder, legs);
      if (candidate && candidate.total < best.total) best = candidate;
    },
  );

  const ratio = best.total <= 0 ? 1 : planned.total / best.total;
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
  { rating: number; source: PlanScoreEvidenceSource; status: 'KNOWN' } | { status: 'UNKNOWN' };

export type PlanScorePlace = { rating: PlanScoreRating; tripPlaceId: string };

const PLACE_QUALITY_BANDS: ReadonlyArray<{ minRating: number; score: number }> = [
  { minRating: 4.5, score: 100 },
  { minRating: 4, score: 85 },
  { minRating: 3.5, score: 70 },
  { minRating: 3, score: 55 },
];

const PLACE_QUALITY_LOW_SCORE = 40;

const MAXIMUM_PUBLIC_RATING = 5;

function ratingScore(rating: number) {
  if (!Number.isFinite(rating) || rating < 0 || rating > MAXIMUM_PUBLIC_RATING) {
    throw new Error('invalid_public_rating');
  }

  return (
    PLACE_QUALITY_BANDS.find((band) => rating >= band.minRating)?.score ?? PLACE_QUALITY_LOW_SCORE
  );
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
    })),
    score: total / rated.length,
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
  candidateTripPlaceId: string;
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
        candidateTripPlaceId: entry.candidate.tripPlaceId,
        improvement,
        targetItemId: entry.targetItemId,
      },
    ];
  });
}
