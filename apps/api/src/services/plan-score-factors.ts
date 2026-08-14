import type {
  PlanScoreEvidence,
  PlanScoreEvidenceSource,
  PlanScoreFactorResult,
} from './plan-score-rules.js';

/**
 * Feasibility and Travel effort factor evaluators (PRD section 29.1).
 *
 * Both are pure and read an already time-zone-resolved description of one day.
 * They never reorder items or change itinerary/reservation data, and unknown
 * routes, locations, times, or provider data stay unknown rather than becoming
 * fabricated zero or worst-case values.
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

export type PlanScoreFeasibilityItem = {
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
  items: PlanScoreFeasibilityItem[];
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
