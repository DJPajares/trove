/** Provider evidence expires independently of immutable itinerary inputs. */
export const PLAN_SCORE_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

type AssessmentTime = { generatedAt: string; evidenceAsOf?: string | null };

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
  if (score.evidenceAsOf !== undefined) {
    if (score.evidenceAsOf === null) return null;
    times.push(Date.parse(score.evidenceAsOf));
    if (times[1]! > times[0]!) return null;
  }
  if (computedAt) times.push(computedAt.getTime());
  if (times.some((value) => !Number.isFinite(value) || value > now.getTime())) return null;
  const original = Math.min(...times);
  return now.getTime() - original < PLAN_SCORE_CACHE_TTL_MS ? new Date(original) : null;
}
