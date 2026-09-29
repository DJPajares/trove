/** Provider evidence expires independently of immutable itinerary inputs. */
export const PLAN_SCORE_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

type AssessmentTime = {
  generatedAt: string;
  evidenceAsOf?: string | null;
  recomputeAfter?: string;
  evidenceExpiresAt?: string | null;
};

/** Unknown, invalid, or future evidence cannot establish freshness. */
export function oldestPlanScoreEvidenceAt(
  generatedAt: string,
  evidenceTimes: readonly string[],
): string | null {
  const evaluated = Date.parse(generatedAt);
  const times = [evaluated, ...evidenceTimes.map((value) => Date.parse(value))];
  if (times.some((value) => !Number.isFinite(value) || value > evaluated)) return null;
  return new Date(Math.min(...times)).toISOString();
}

/** Reads never advance the clock, including legacy rows with inflated Apply times. */
export function originalPlanScoreTime(
  score: AssessmentTime,
  now: Date,
  computedAt?: Date,
): Date | null {
  const times = [Date.parse(score.generatedAt)];
  if (score.evidenceAsOf === null) return null;
  if (score.evidenceAsOf !== undefined) {
    const evidence = Date.parse(score.evidenceAsOf);
    if (
      !Number.isFinite(evidence) ||
      evidence > times[0]! ||
      now.getTime() - evidence >= 30 * PLAN_SCORE_CACHE_TTL_MS
    )
      return null;
  }
  if (computedAt) times.push(computedAt.getTime());
  if (times.some((value) => !Number.isFinite(value) || value > now.getTime())) return null;
  if (score.evidenceExpiresAt) {
    const deadline = Date.parse(score.evidenceExpiresAt);
    if (!Number.isFinite(deadline) || deadline <= now.getTime()) return null;
  }
  if (score.recomputeAfter) {
    const deadline = Date.parse(score.recomputeAfter);
    if (
      !Number.isFinite(deadline) ||
      deadline <= now.getTime() ||
      deadline > times[0]! + PLAN_SCORE_CACHE_TTL_MS
    )
      return null;
  }
  const original = Math.min(...times);
  return now.getTime() - original < PLAN_SCORE_CACHE_TTL_MS ? new Date(original) : null;
}
