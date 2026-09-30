import { expect, test } from 'vitest';

import { mergeCoverage, share, summariseCoverage } from '../src/services/evidence-coverage.js';

const NOW = new Date('2026-09-30T12:00:00.000Z');
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

test('only evidence inside its 30 days counts, and each signal is counted on its own', () => {
  const coverage = summariseCoverage(
    [
      {
        evidence: { openingPeriods: [{}], rating: 4.5 },
        evidenceAt: ago(1),
      },
      { evidence: { openingPeriods: [{}] }, evidenceAt: ago(29) },
      // Past its life: present in the row, but not evidence any more.
      { evidence: { openingPeriods: [{}], rating: 5 }, evidenceAt: ago(31) },
      { evidence: null, evidenceAt: null },
    ],
    NOW,
  );

  expect(coverage).toStrictEqual({
    total: 4,
    withDateSpecificHours: 0,
    withFreshEvidence: 2,
    withHours: 2,
    withRating: 1,
  });
});

test('special hours count only until their window has passed', () => {
  const special = (through: string | null) => ({
    evidence: { currentHoursValidThrough: through, currentOpeningPeriods: [{}] },
    evidenceAt: ago(1),
  });

  const coverage = summariseCoverage(
    [special('2026-10-03'), special('2026-09-30'), special('2026-09-29'), special(null)],
    NOW,
  );

  expect(coverage.withDateSpecificHours).toBe(3);
});

test('an empty population is measured as nothing, not as an error', () => {
  expect(summariseCoverage([], NOW).total).toBe(0);
  expect(share(0, 0)).toBe('-');
  expect(share(1, 3)).toBe('1 (33%)');
});

test('populations add up', () => {
  const one = summariseCoverage([{ evidence: { rating: 4 }, evidenceAt: ago(1) }], NOW);
  expect(mergeCoverage([one, one])).toMatchObject({
    total: 2,
    withFreshEvidence: 2,
    withRating: 2,
  });
});
