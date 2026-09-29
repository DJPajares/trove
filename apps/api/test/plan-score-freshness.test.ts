import { expect, test } from 'vitest';
import {
  oldestPlanScoreEvidenceAt,
  originalPlanScoreTime,
  PLAN_SCORE_CACHE_TTL_MS,
} from '../src/services/plan-score-freshness.js';
import {
  buildPlanScoreFromEvaluations,
  parseStoredPlanScore,
  withholdNonCurrentPlanScore,
} from '../src/services/plan-score.js';
import { emptyPlanScore } from './fixtures/ai-planning.js';

const NOW = new Date('2026-09-01T12:00:00.000Z');

test('the local recheck expires at 24 hours independently of provider acquisition age', () => {
  const evidence = new Date(NOW.getTime() - 7 * PLAN_SCORE_CACHE_TTL_MS).toISOString();
  const score = {
    generatedAt: NOW.toISOString(),
    evidenceAsOf: evidence,
    recomputeAfter: new Date(NOW.getTime() + PLAN_SCORE_CACHE_TTL_MS).toISOString(),
    evidenceExpiresAt: new Date(NOW.getTime() + 23 * PLAN_SCORE_CACHE_TTL_MS).toISOString(),
  };
  expect(originalPlanScoreTime(score, NOW, NOW)).toEqual(NOW);
  expect(
    originalPlanScoreTime(score, new Date(NOW.getTime() + PLAN_SCORE_CACHE_TTL_MS), NOW),
  ).toBeNull();
  expect(originalPlanScoreTime({ ...score, evidenceExpiresAt: NOW.toISOString() }, NOW)).toBeNull();
});

test('unknown, malformed, and future timestamps cannot make an assessment current', () => {
  for (const evidenceAsOf of [null, 'bad-time', new Date(NOW.getTime() + 1).toISOString()]) {
    expect(originalPlanScoreTime({ generatedAt: NOW.toISOString(), evidenceAsOf }, NOW)).toBeNull();
  }
  expect(originalPlanScoreTime({ generatedAt: 'bad-time' }, NOW)).toBeNull();
  expect(
    originalPlanScoreTime({ generatedAt: NOW.toISOString() }, NOW, new Date(NOW.getTime() + 1)),
  ).toBeNull();
});

test('evaluation preserves provider fetch age instead of resetting it', () => {
  const earlier = new Date(NOW.getTime() - 3_600_000).toISOString();
  expect(oldestPlanScoreEvidenceAt(NOW.toISOString(), [NOW.toISOString(), earlier])).toBe(earlier);
  expect(oldestPlanScoreEvidenceAt(NOW.toISOString(), [])).toBe(NOW.toISOString());
  expect(oldestPlanScoreEvidenceAt(NOW.toISOString(), ['bad-time'])).toBeNull();
});

test('expired and invalid optional evidence cannot expire unrelated assessment data', () => {
  const fresh = new Date(NOW.getTime() - 60_000).toISOString();
  const score = buildPlanScoreFromEvaluations({
    days: [],
    mustGoIds: [],
    scheduledIds: [],
    evaluatedAt: NOW,
    evidenceTimes: [
      'not-a-time',
      new Date(NOW.getTime() - 31 * PLAN_SCORE_CACHE_TTL_MS).toISOString(),
      fresh,
    ],
    evidenceDeadlines: ['invalid', new Date(NOW.getTime() - 1).toISOString()],
  });
  expect(score.evidenceAsOf).toBe(fresh);
  expect(score.evidenceExpiresAt).toBe(
    new Date(Date.parse(fresh) + 30 * PLAN_SCORE_CACHE_TTL_MS).toISOString(),
  );
  expect(originalPlanScoreTime(score, NOW)).toEqual(NOW);
});

test('expired assessments withhold numbers without rewriting the original assessment', () => {
  const score = {
    ...emptyPlanScore(),
    generatedAt: new Date(NOW.getTime() - PLAN_SCORE_CACHE_TTL_MS).toISOString(),
    evidenceAsOf: undefined,
    score: 72,
  };
  const result = withholdNonCurrentPlanScore(score, NOW);
  expect(result.score).toBeNull();
  expect(result.withheldReasons).toContain('EVIDENCE_NOT_CURRENT');
  expect(score.score).toBe(72);
  expect(result.generatedAt).toBe(score.generatedAt);
});

test('current versioned payloads remain readable without optional age metadata', () => {
  const { evidenceAsOf: _age, ...legacy } = emptyPlanScore();
  expect(parseStoredPlanScore(legacy)).toEqual(legacy);
});

test('incompatible rubric and legacy category payloads are rejected', () => {
  const score = emptyPlanScore();
  expect(parseStoredPlanScore({ ...score, schemaVersion: 4, rubricVersion: 4 })).toBeNull();
  expect(parseStoredPlanScore({ ...score, rubricVersion: 99 })).toBeNull();
});
