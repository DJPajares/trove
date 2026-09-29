import { expect, test } from 'vitest';
import type { PlanScoreExplanation, TripPlanScore } from '@trove/types';
import {
  assessmentDeadline,
  assessmentBasisKey,
  compareScores,
  currentAssessment,
  dayActionLink,
  prioritizedProblems,
  scoreSnapshot,
} from '../lib/plan-score/presentation';
import { stripPersistedPlanScores } from '../lib/query/persister';
import { createQueryClient, shouldDehydrateQuery } from '../lib/query/client';
import {
  assessmentChange,
  refreshExpiredAssessment,
  rememberAssessment,
} from '../lib/plan-score/lifecycle';

const NOW = Date.parse('2026-09-29T02:00:00Z');
function assessment(overrides: Partial<TripPlanScore> = {}): TripPlanScore {
  const evaluated = { state: 'EVALUATED', score: 80, coverage: 70, confidence: 90 } as const;
  const explanations = { whatWorks: [], worthImproving: [], uncertainty: [] };
  return {
    schemaVersion: 7,
    rubricVersion: 7,
    assessmentStatus: 'provisional',
    assessmentBasis: ['TIMING'],
    limitations: [],
    assessedDayCount: 1,
    applicableDayCount: 1,
    evidenceCoverage: 70,
    evidenceExpiresAt: '2026-10-20T01:00:00Z',
    fingerprint: 'original',
    generatedAt: '2026-09-29T01:00:00Z',
    recomputeAfter: '2026-09-29T03:00:00Z',
    completeness: 75,
    confidence: 90,
    score: 80,
    withheldReasons: [],
    caps: [],
    explanations,
    components: {
      DAILY_QUALITY: evaluated,
      DESTINATION_UTILIZATION: evaluated,
      VARIETY_COVERAGE: evaluated,
      SEASONAL_FIT: { state: 'UNKNOWN', reason: 'MISSING_EVIDENCE' },
    },
    days: [
      {
        assessmentStatus: 'provisional',
        assessmentBasis: ['TIMING'],
        limitations: [],
        dayId: 'day-1',
        date: '2026-10-01',
        completeness: 75,
        confidence: 90,
        score: 80,
        caps: [],
        explanations,
        withheldReasons: [],
        factors: {
          FEASIBILITY: evaluated,
          ROUTE_EFFICIENCY: evaluated,
          PACE_COMFORT: evaluated,
          EXPERIENCE_QUALITY: evaluated,
          PLAN_COMPOSITION: evaluated,
        },
      },
    ],
    presentation: {
      adjustments: { fatigue: 2, weakDays: 3 },
      revisions: { planning: 'p1', evidence: 'e1', destinationContext: 'c1' },
    },
    ...overrides,
  };
}
function reason(
  factor: PlanScoreExplanation['factor'],
  severity: PlanScoreExplanation['severity'],
  code: string,
): PlanScoreExplanation {
  return {
    factor,
    severity,
    code,
    messageKey: 'unused',
    references: [],
    values: {},
    action: 'ADJUST_TIME',
  };
}
test('problems prioritize hard conflicts, feasibility, travel and comfort ahead of quality opportunities', () => {
  const reasons = [
    reason('PLAN_COMPOSITION', 'INFO', 'a'),
    reason('EXPERIENCE_QUALITY', 'RISK', 'b'),
    reason('ROUTE_EFFICIENCY', 'RISK', 'c'),
    reason('PACE_COMFORT', 'RISK', 'd'),
    reason('FEASIBILITY', 'MATERIAL', 'e'),
    reason('FEASIBILITY', 'HARD', 'f'),
  ];
  expect(prioritizedProblems(reasons).map((entry) => entry.code)).toEqual([
    'f',
    'e',
    'c',
    'd',
    'b',
    'a',
  ]);
});
test('freshness uses the original instant, earliest expiry and 24-hour maximum', () => {
  const score = assessment();
  expect(currentAssessment(score, NOW)).toBe(true);
  expect(currentAssessment(score, Date.parse(score.recomputeAfter!))).toBe(false);
  expect(currentAssessment(score, Date.parse(score.generatedAt) - 1)).toBe(false);
  expect(currentAssessment({ ...score, rubricVersion: 4 } as never, NOW)).toBe(false);
  expect(assessmentDeadline({ ...score, recomputeAfter: '2026-10-02T00:00:00Z' })).toBe(
    Date.parse(score.generatedAt) + 86_400_000,
  );
});
test('numeric changes require compatible, current scores and identify changed planning or evidence', () => {
  const first = scoreSnapshot(assessment(), NOW);
  const changed = assessment({ fingerprint: 'changed', score: 90 });
  changed.presentation!.revisions.planning = 'p2';
  expect(compareScores(first, scoreSnapshot(changed, NOW), 'trip', NOW)).toEqual({
    source: 'planning',
    delta: 10,
    state: 'score',
  });
  changed.presentation!.revisions.planning = 'p1';
  changed.presentation!.revisions.evidence = 'e2';
  expect(compareScores(first, scoreSnapshot(changed, NOW), 'trip', NOW)?.source).toBe('evidence');
  expect(
    compareScores(first, scoreSnapshot(changed, NOW), 'trip', first.deadline)?.delta,
  ).toBeNull();
  expect(
    compareScores(first, { ...scoreSnapshot(changed, NOW), version: '6:6' }, 'trip', NOW),
  ).toEqual({ source: 'rubric', delta: null, state: 'rubric' });
});
test('coverage and withheld transitions never fabricate score deltas; unaffected days stay quiet', () => {
  const first = scoreSnapshot(assessment(), NOW);
  expect(
    compareScores(
      first,
      scoreSnapshot(assessment({ fingerprint: 'coverage', completeness: 80 }), NOW),
      'trip',
      NOW,
    )?.state,
  ).toBe('coverage');
  expect(
    compareScores(
      first,
      scoreSnapshot(assessment({ fingerprint: 'unknown', score: null }), NOW),
      'trip',
      NOW,
    ),
  ).toMatchObject({ state: 'unavailable', delta: null });
  expect(
    compareScores(
      first,
      scoreSnapshot(assessment({ fingerprint: 'trip-change', score: 90 }), NOW),
      'day-1',
      NOW,
    ),
  ).toBeNull();
});
test('session comparisons retain summaries, never explanation parameters, and isolate travellers', () => {
  const client = createQueryClient();
  const other = createQueryClient();
  const first = assessment();
  first.explanations.worthImproving.push({
    ...reason('FEASIBILITY', 'HARD', 'conflict'),
    values: { secretRawProviderValue: 123 },
    references: ['private-item'],
  });
  expect(JSON.stringify(scoreSnapshot(first, NOW))).not.toContain('secretRawProviderValue');
  expect(JSON.stringify(scoreSnapshot(first, NOW))).not.toContain('private-item');
  rememberAssessment(client, 'trip', first);
  rememberAssessment(client, 'trip', assessment({ fingerprint: 'second', score: 90 }));
  expect(assessmentChange(client, 'trip', 'trip')).not.toBeNull();
  expect(assessmentChange(other, 'trip', 'trip')).toBeNull();
  client.clear();
  other.clear();
});
test('legacy disk cleanup removes full score responses and preserves permitted route caches', () => {
  const legacy = JSON.stringify({
    buster: 'v1',
    timestamp: NOW,
    clientState: {
      mutations: [],
      queries: [
        { queryKey: ['plan-score', 'trip'], state: { data: { values: { raw: 123 } } } },
        { queryKey: ['itinerary-day-routes', 'trip'], state: { data: { route: 'keep' } } },
      ],
    },
  });
  const cleaned = JSON.parse(stripPersistedPlanScores(legacy));
  expect(cleaned.clientState.queries).toHaveLength(1);
  expect(cleaned.clientState.queries[0].state.data).toEqual({ route: 'keep' });
  expect(cleaned.buster).toBe('v1');
  expect(
    shouldDehydrateQuery({
      queryKey: ['plan-score', 'trip'],
      state: { status: 'success' },
    } as never),
  ).toBe(false);
});
test('navigation resolves explicit day and Must Go actions; unknown references have no dead action', () => {
  const entry = { ...reason('DAILY_QUALITY', 'HARD', 'conflict'), references: ['day-1'] };
  expect(dayActionLink('trip', assessment(), entry)).toEqual({
    href: '/trips/trip/itinerary?day=day-1',
  });
  expect(dayActionLink('trip', assessment(), { ...entry, references: ['unknown'] })).toBeNull();
  expect(
    dayActionLink('trip', assessment(), {
      ...entry,
      action: 'SCHEDULE_MUST_GO',
      references: ['place-1'],
    }),
  ).toEqual({ href: '/trips/trip/itinerary?place=place-1' });
});
test('expiry attempts are deduplicated across surfaces and repeated expired responses', () => {
  const client = createQueryClient();
  const score = assessment();
  client.setQueryData(['plan-score', 'trip'], score);
  let invalidations = 0;
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'invalidate') invalidations++;
  });
  refreshExpiredAssessment(client, 'trip', score, NOW);
  expect(invalidations).toBe(0);
  refreshExpiredAssessment(client, 'trip', score, NOW + 86_400_000);
  refreshExpiredAssessment(client, 'trip', score, NOW + 86_400_001);
  expect(invalidations).toBe(1);
  unsubscribe();
  client.clear();
});
test('ordinary acquisition invalidates cached scoring without invoking any acquisition itself', async () => {
  const client = createQueryClient();
  client.setQueryData(['plan-score', 'trip'], assessment());
  client.setQueryData(['plan-score', 'other'], assessment());
  await client.fetchQuery({
    queryKey: ['itinerary-day-routes', 'trip', 'day'],
    queryFn: async () => ({ route: 'owned' }),
  });
  expect(client.getQueryState(['plan-score', 'trip'])?.isInvalidated).toBe(true);
  expect(client.getQueryState(['plan-score', 'other'])?.isInvalidated).toBe(false);
  expect(client.getQueryData(['itinerary-day-routes', 'trip', 'day'])).toEqual({ route: 'owned' });
  client.clear();
});

test('the client freshness guard preserves field-specific cache age and rejects unknown evidence age', () => {
  expect(currentAssessment(assessment({ evidenceAsOf: null }), NOW)).toBe(false);
  expect(currentAssessment(assessment({ evidenceAsOf: '2026-09-30T00:00:00Z' }), NOW)).toBe(false);
  expect(currentAssessment(assessment({ evidenceAsOf: '2026-09-20T00:00:00Z' }), NOW)).toBe(true);
  expect(
    currentAssessment(
      assessment({
        evidenceAsOf: '2026-08-20T00:00:00Z',
        evidenceExpiresAt: '2026-09-19T00:00:00Z',
      }),
      NOW,
    ),
  ).toBe(false);
  expect(
    currentAssessment(
      assessment({ recomputeAfter: '2026-09-29T01:00:00Z', evidenceAsOf: '2026-09-20T00:00:00Z' }),
      NOW,
    ),
  ).toBe(false);
});

test('only unsynchronized operations that change scoring inputs withhold current scores', async () => {
  const { hasUnsyncedScoringEdits } = await import('../lib/plan-score/presentation');
  expect(hasUnsyncedScoringEdits([{ kind: 'itinerary_day_move' }])).toBe(true);
  expect(hasUnsyncedScoringEdits([{ kind: 'itinerary_item_update' }])).toBe(true);
  expect(
    hasUnsyncedScoringEdits([{ kind: 'itinerary_travel_status' }, { kind: 'itinerary_day_note' }]),
  ).toBe(false);
  expect(hasUnsyncedScoringEdits([])).toBe(false);
});

test('sign-out cache clearing discards the session comparison baseline', () => {
  const client = createQueryClient();
  client.setQueryData(['plan-score', 'trip'], assessment());
  rememberAssessment(client, 'trip', assessment({ fingerprint: 'changed', score: 90 }));
  client.clear();
  expect(assessmentChange(client, 'trip', 'trip')).toBeNull();
});

test('evidence acquired during an in-flight score produces one coalesced cache-only follow-up', async () => {
  const { QueryObserver } = await import('@tanstack/react-query');
  const { vi } = await import('vitest');
  const client = createQueryClient();
  let release: (() => void) | undefined;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let scoreReads = 0,
    acquisitions = 0;
  const observer = new QueryObserver(client, {
    queryKey: ['plan-score', 'trip'],
    queryFn: async () => {
      scoreReads++;
      if (scoreReads === 1) await waiting;
      return assessment({ fingerprint: String(scoreReads) });
    },
  });
  const unsubscribe = observer.subscribe(() => undefined);
  await client.fetchQuery({
    queryKey: ['itinerary-day-routes', 'trip', 'day'],
    queryFn: async () => {
      acquisitions++;
      return {};
    },
  });
  await client.fetchQuery({
    queryKey: ['trip-weather', 'trip'],
    queryFn: async () => {
      acquisitions++;
      return {};
    },
  });
  release!();
  await vi.waitFor(() => expect(scoreReads).toBe(2));
  expect(acquisitions).toBe(2);
  unsubscribe();
  client.clear();
});

test('typed owned references resolve item editors and reservation views across score consumers', () => {
  const score = assessment();
  score.presentation!.referenceTargets = {
    'item-1': { kind: 'item', dayId: 'day-1' },
    'reservation-1': { kind: 'reservation' },
  };
  const entry = { ...reason('FEASIBILITY', 'HARD', 'conflict'), references: ['item-1'] };
  expect(dayActionLink('trip', score, entry)).toEqual({
    href: '/trips/trip/itinerary?item=item-1&day=day-1',
  });
  expect(dayActionLink('trip', score, { ...entry, references: ['reservation-1'] })).toEqual({
    href: '/trips/trip/reservations?reservation=reservation-1',
  });
});

test('AI regeneration comparisons use the same sanitized, session-only baseline', () => {
  const client = createQueryClient();
  client.setQueryData(['ai-planning', 'session', 'session-1'], {});
  rememberAssessment(client, 'draft:session-1', assessment());
  rememberAssessment(
    client,
    'draft:session-1',
    assessment({ fingerprint: 'regenerated', score: 90 }),
  );
  expect(assessmentChange(client, 'draft:session-1', 'trip')).not.toBeNull();
  client.clear();
  expect(assessmentChange(client, 'draft:session-1', 'trip')).toBeNull();
});

test('traveler insights omit diagnostics and general guidance and deduplicate the same issue', async () => {
  const { travelerInsights } = await import('../lib/plan-score/presentation');
  const conflict = {
    ...reason('FEASIBILITY', 'HARD', 'OVERLAPPING_COMMITMENTS'),
    references: ['a', 'b'],
  };
  const insights = travelerInsights({
    whatWorks: [],
    worthImproving: [conflict, { ...conflict, references: ['b', 'a'] }],
    uncertainty: [
      reason('PACE_COMFORT', 'INFO', 'PACE_COMFORT_UNKNOWN'),
      reason('SEASONAL_FIT', 'INFO', 'SEASONAL_PATTERN'),
    ],
  });
  expect(insights).toEqual([conflict]);
});

test('a disabled response rechecks on remount and concurrent score surfaces share the request', async () => {
  const { QueryObserver } = await import('@tanstack/react-query');
  const { vi } = await import('vitest');
  const { planScoreReadPolicy } = await import('../lib/plan-score/lifecycle');
  const client = createQueryClient();
  let enabled = false;
  const reads = vi.fn(async () => (enabled ? assessment() : null));
  const options = {
    queryKey: ['plan-score', 'existing-trip'],
    queryFn: reads,
    ...planScoreReadPolicy,
  };
  const first = new QueryObserver(client, options);
  const stop = first.subscribe(() => undefined);
  await vi.waitFor(() => expect(first.getCurrentResult().data).toBeNull());
  stop();
  enabled = true;
  const a = new QueryObserver(client, options),
    b = new QueryObserver(client, options);
  const stopA = a.subscribe(() => undefined),
    stopB = b.subscribe(() => undefined);
  await vi.waitFor(() => expect(a.getCurrentResult().data?.score).toBe(assessment().score));
  expect(reads).toHaveBeenCalledTimes(2);
  expect(b.getCurrentResult().data).toBe(a.getCurrentResult().data);
  stopA();
  stopB();
  client.clear();
});

test('one concise basis prioritizes unknown required travel and uses stable v7 codes', () => {
  expect(assessmentBasisKey(assessment({ limitations: ['TRAVEL_TIME_UNKNOWN'] }))).toBe(
    'basis.travelUnknown',
  );
  expect(assessmentBasisKey(assessment({ assessmentBasis: ['ACTIVITY_LOAD'] }))).toBe(
    'basis.activityLoad',
  );
  expect(assessmentBasisKey(assessment({ assessmentBasis: ['REST'] }))).toBe('basis.rest');
  expect(
    currentAssessment({ ...assessment(), schemaVersion: 6, rubricVersion: 6 } as never, NOW),
  ).toBe(false);
});

test('verdict bands follow the published thresholds at every boundary', async () => {
  const { scoreBand } = await import('../lib/plan-score/presentation');
  expect([100, 90, 89, 80, 79, 70, 69, 60, 59, 0].map(scoreBand)).toEqual([
    'excellent',
    'excellent',
    'strong',
    'strong',
    'good',
    'good',
    'refine',
    'refine',
    'attention',
    'attention',
  ]);
});

test('insight groups keep issues in priority order apart from what is working', async () => {
  const { travelerInsightGroups } = await import('../lib/plan-score/presentation');
  const route = reason('ROUTE_EFFICIENCY', 'RISK', 'AVOIDABLE_MOVEMENT');
  const conflict = {
    ...reason('FEASIBILITY', 'HARD', 'OVERLAPPING_COMMITMENTS'),
    references: ['a'],
  };
  const works = { ...reason('PACE_COMFORT', 'INFO', 'COMFORTABLE_LOAD'), action: null };
  const missing = reason('FEASIBILITY', 'INFO', 'MISSING_ARRIVAL');
  expect(
    travelerInsightGroups({
      whatWorks: [works],
      worthImproving: [route, conflict, { ...conflict }],
      uncertainty: [missing, { ...reason('PACE_COMFORT', 'INFO', 'NO_ACTION'), action: null }],
    }),
  ).toEqual({ issues: [conflict, route, missing], highlights: [works] });
});
