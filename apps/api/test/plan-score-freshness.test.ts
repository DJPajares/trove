import { expect, test } from 'vitest';
import {
  oldestPlanScoreEvidenceAt,
  originalPlanScoreTime,
  PLAN_SCORE_CACHE_TTL_MS,
} from '../src/services/plan-score-freshness.js';
import { parseStoredPlanScore, withholdNonCurrentPlanScore } from '../src/services/plan-score.js';
import { emptyPlanScore } from './fixtures/ai-planning.js';

const NOW = new Date('2026-09-01T12:00:00.000Z');

test('freshness follows the oldest original timestamp and expires at exactly 24 hours', () => {
  const evidence = new Date(NOW.getTime() - PLAN_SCORE_CACHE_TTL_MS + 1).toISOString();
  const score = { generatedAt: NOW.toISOString(), evidenceAsOf: evidence };
  expect(originalPlanScoreTime(score, NOW, NOW)).toEqual(new Date(evidence));
  expect(originalPlanScoreTime(score, new Date(NOW.getTime() + 1), NOW)).toBeNull();
  expect(
    originalPlanScoreTime({ generatedAt: evidence }, new Date(NOW.getTime() + 1), NOW),
  ).toBeNull();
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
