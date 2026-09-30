import { PLACE_EVIDENCE_TTL_MS } from './place-evidence-cache.js';

/**
 * How much stored rich evidence (rating, hours) a set of places actually has.
 *
 * Evidence is only stored for places whose details were opened, that were added
 * to an itinerary, or that an AI plan scheduled, and it lasts 30 days, so
 * features that lean on it need to know how sparse it really is. Pure, so the
 * counting can be tested without a database.
 */

export type EvidenceRow = {
  evidence: unknown;
  evidenceAt: Date | null;
};

export type PopulationCoverage = {
  total: number;
  withDateSpecificHours: number;
  withFreshEvidence: number;
  withHours: number;
  withRating: number;
};

type StoredEvidence = {
  currentHoursValidThrough?: string | null;
  currentOpeningPeriods?: unknown[];
  openingPeriods?: unknown[];
  rating?: number | null;
};

export function emptyCoverage(): PopulationCoverage {
  return {
    total: 0,
    withDateSpecificHours: 0,
    withFreshEvidence: 0,
    withHours: 0,
    withRating: 0,
  };
}

export function summariseCoverage(rows: readonly EvidenceRow[], now: Date): PopulationCoverage {
  const coverage = emptyCoverage();
  const today = now.toISOString().slice(0, 10);

  for (const row of rows) {
    coverage.total += 1;
    const fresh =
      row.evidenceAt !== null &&
      row.evidence !== null &&
      typeof row.evidence === 'object' &&
      now.getTime() - row.evidenceAt.getTime() < PLACE_EVIDENCE_TTL_MS;
    if (!fresh) continue;

    const evidence = row.evidence as StoredEvidence;
    coverage.withFreshEvidence += 1;
    if (evidence.openingPeriods?.length) coverage.withHours += 1;
    // Special hours only count while their window has not passed.
    if (
      evidence.currentOpeningPeriods?.length &&
      (!evidence.currentHoursValidThrough || evidence.currentHoursValidThrough >= today)
    ) {
      coverage.withDateSpecificHours += 1;
    }
    if (typeof evidence.rating === 'number') coverage.withRating += 1;
  }

  return coverage;
}

export function mergeCoverage(parts: readonly PopulationCoverage[]): PopulationCoverage {
  const merged = emptyCoverage();
  for (const part of parts) {
    merged.total += part.total;
    merged.withDateSpecificHours += part.withDateSpecificHours;
    merged.withFreshEvidence += part.withFreshEvidence;
    merged.withHours += part.withHours;
    merged.withRating += part.withRating;
  }
  return merged;
}

/** "n (p%)" of the population, or a dash when there is none to measure. */
export function share(count: number, total: number) {
  return total === 0 ? '-' : `${count} (${Math.round((count / total) * 100)}%)`;
}
