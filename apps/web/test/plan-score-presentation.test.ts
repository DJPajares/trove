import { expect, test } from 'vitest';
import { QueryObserver } from '@tanstack/react-query';
import type { PlanScoreExplanation, TripPlanScore } from '@trove/types';
import {
  assessmentDeadline,
  assessmentBasisKey,
  breakdownRows,
  compareScores,
  currentAssessment,
  dayActionLink,
  isEstimatedOutcome,
  prioritizedProblems,
  scoreSnapshot,
  travelerInsights,
} from '../lib/plan-score/presentation';
import {
  CLOCK_LEEWAY_MS,
  observeServerTime,
  resetServerClock,
  serverNow,
} from '../lib/plan-score/clock';
import { stripPersistedPlanScores } from '../lib/query/persister';
import { createQueryClient, shouldDehydrateQuery } from '../lib/query/client';
import {
  assessmentChange,
  refreshExpiredAssessment,
  rememberAssessment,
  startCanonicalPlanScoreRead,
} from '../lib/plan-score/lifecycle';

const NOW = Date.parse('2026-09-29T02:00:00Z');
function assessment(overrides: Partial<TripPlanScore> = {}): TripPlanScore {
  const evaluated = { state: 'EVALUATED', score: 80, coverage: 70, confidence: 90 } as const;
  const explanations = { whatWorks: [], worthImproving: [], uncertainty: [] };
  return {
    schemaVersion: 8,
    rubricVersion: 12,
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
  // A score from beyond the clock leeway is not trusted; within it, it is.
  expect(currentAssessment(score, Date.parse(score.generatedAt) - CLOCK_LEEWAY_MS - 1)).toBe(false);
  expect(currentAssessment(score, Date.parse(score.generatedAt) - 1)).toBe(true);
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
test('expiry reads coalesce in flight but a later eligible event can recover', async () => {
  const client = createQueryClient();
  const score = assessment();
  client.setQueryData(['plan-score', 'trip'], score);
  let reads = 0;
  let release: ((score: TripPlanScore) => void) | undefined;
  const observer = new QueryObserver(client, {
    queryKey: ['plan-score', 'trip'],
    queryFn: () => {
      reads++;
      return new Promise<TripPlanScore>((resolve) => {
        release = resolve;
      });
    },
    staleTime: Infinity,
  });
  const unsubscribe = observer.subscribe(() => undefined);
  refreshExpiredAssessment(client, 'trip', score, NOW);
  expect(reads).toBe(0);
  refreshExpiredAssessment(client, 'trip', score, NOW + 86_400_000);
  refreshExpiredAssessment(client, 'trip', score, NOW + 86_400_001);
  expect(reads).toBe(1);
  release?.(score);
  await new Promise((resolve) => setTimeout(resolve, 0));
  refreshExpiredAssessment(client, 'trip', score, NOW + 86_400_002);
  expect(reads).toBe(2);
  release?.(score);
  unsubscribe();
  client.clear();
});
test('Apply starts one canonical read that a destination observer shares', async () => {
  const client = createQueryClient();
  const score = assessment();
  let reads = 0;
  let finish: ((value: TripPlanScore) => void) | undefined;
  const read = () => {
    reads++;
    return new Promise<TripPlanScore>((resolve) => {
      finish = resolve;
    });
  };
  const started = startCanonicalPlanScoreRead(client, 'applied-trip', read);
  const observer = new QueryObserver(client, {
    queryKey: ['plan-score', 'applied-trip'],
    queryFn: read,
    staleTime: Infinity,
  });
  const unsubscribe = observer.subscribe(() => undefined);
  expect(reads).toBe(1);
  finish?.(score);
  await started;
  expect(observer.getCurrentResult().data).toEqual(score);
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

test('loading the trip context refreshes that trip score, so seasonal fit can fill', async () => {
  const client = createQueryClient();
  client.setQueryData(['plan-score', 'trip'], assessment());
  client.setQueryData(['plan-score', 'other'], assessment());
  await client.fetchQuery({
    queryKey: ['trip-context', 'trip', 1, 'en'],
    queryFn: async () => ({ climate: [] }),
  });
  expect(client.getQueryState(['plan-score', 'trip'])?.isInvalidated).toBe(true);
  expect(client.getQueryState(['plan-score', 'other'])?.isInvalidated).toBe(false);
  client.clear();
});

test('the breakdown lists every row: filled rows say why, inapplicable rows say so', () => {
  const filled = { state: 'EVALUATED', score: 78, coverage: 100, confidence: 0 } as const;
  const rows = breakdownRows(
    {
      DAILY_QUALITY: { state: 'EVALUATED', score: 82, coverage: 90, confidence: 85 },
      DESTINATION_UTILIZATION: filled,
      VARIETY_COVERAGE: { state: 'NOT_APPLICABLE' },
      SEASONAL_FIT: filled,
    },
    ['DAILY_QUALITY', 'DESTINATION_UTILIZATION', 'VARIETY_COVERAGE', 'SEASONAL_FIT'],
    [
      {
        ...reason('DESTINATION_UTILIZATION', 'INFO', 'ROW_NEEDS_DETAIL'),
        action: null,
        messageKey: 'rowReasons.DESTINATION_UTILIZATION',
      },
      {
        ...reason('SEASONAL_FIT', 'INFO', 'ROW_NEEDS_DETAIL'),
        action: null,
        messageKey: 'rowReasons.SEASONAL_FIT',
      },
    ],
  );
  expect(rows).toEqual([
    { id: 'DAILY_QUALITY', score: 82, estimated: false, reasonKey: null },
    {
      id: 'DESTINATION_UTILIZATION',
      score: 78,
      estimated: true,
      reasonKey: 'rowReasons.DESTINATION_UTILIZATION',
    },
    { id: 'VARIETY_COVERAGE', notApplicable: true },
    { id: 'SEASONAL_FIT', score: 78, estimated: true, reasonKey: 'rowReasons.SEASONAL_FIT' },
  ]);
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

test('missing stop detail leads the basis and its nudges open the stop to fix', () => {
  expect(
    assessmentBasisKey(assessment({ limitations: ['TRAVEL_TIME_UNKNOWN', 'DETAIL_MISSING'] })),
  ).toBe('basis.detailMissing');
  const conflict = {
    ...reason('FEASIBILITY', 'HARD', 'OVERLAPPING_COMMITMENTS'),
    references: ['a', 'b'],
  };
  const located = {
    ...reason('ROUTE_EFFICIENCY', 'INFO', 'STOPS_NOT_LOCATED'),
    action: 'LINK_PLACE' as const,
    references: ['item-1'],
  };
  const timing = {
    ...reason('FEASIBILITY', 'INFO', 'STOPS_WITHOUT_TIMING'),
    action: 'ADD_TIMING' as const,
    references: ['item-1'],
  };
  // Real problems come first; the nudges follow in category order and are
  // never dropped as diagnostics.
  expect(
    travelerInsights({
      whatWorks: [],
      worthImproving: [timing, located, conflict],
      uncertainty: [],
    }),
  ).toEqual([conflict, timing, located]);
  const score = assessment();
  score.presentation!.referenceTargets = { 'item-1': { kind: 'item', dayId: 'day-1' } };
  expect(dayActionLink('trip', score, timing)).toEqual({
    href: '/trips/trip/itinerary?item=item-1&day=day-1',
  });
});

test('one concise basis prioritizes unknown required travel and uses stable v7 codes', () => {
  expect(assessmentBasisKey(assessment({ limitations: ['TRAVEL_TIME_UNKNOWN'] }))).toBe(
    'basis.travelUnknown',
  );
  expect(assessmentBasisKey(assessment({ assessmentBasis: ['ACTIVITY_LOAD'] }))).toBe(
    'basis.activityLoad',
  );
  expect(assessmentBasisKey(assessment({ assessmentBasis: ['REST'] }))).toBe('basis.rest');
  expect(assessmentBasisKey(assessment({ limitations: ['TRAVEL_TIME_ESTIMATED'] }))).toBe(
    'basis.travelEstimated',
  );
  expect(
    currentAssessment({ ...assessment(), schemaVersion: 7, rubricVersion: 10 } as never, NOW),
  ).toBe(false);
});

test('a published category is marked estimated when partial or mostly estimated', () => {
  const outcome = (coverage: number, confidence: number) =>
    ({ state: 'EVALUATED', score: 90, coverage, confidence }) as const;
  // Complete, mostly owned or routed evidence reads as a plain number.
  expect(isEstimatedOutcome(outcome(100, 80))).toBe(false);
  // Complete but mostly estimated (AI times, distance-estimated legs).
  expect(isEstimatedOutcome(outcome(100, 50))).toBe(true);
  // Reliable where known, but only partly assessed.
  expect(isEstimatedOutcome(outcome(60, 60))).toBe(true);
  expect(isEstimatedOutcome(outcome(0, 0))).toBe(true);
});

test('freshness is judged in server time, so a device running behind still sees a fresh score', () => {
  resetServerClock();
  // Just computed on the server, received by a device whose clock runs 2 s behind.
  const fresh = assessment({
    generatedAt: new Date(NOW + 2_000).toISOString(),
    evidenceAsOf: new Date(NOW - 60_000).toISOString(),
  });
  expect(currentAssessment(fresh, NOW)).toBe(true);
  // Beyond the leeway, only a known offset can vouch for it.
  const skewed = assessment({
    generatedAt: new Date(NOW + 10 * 60_000).toISOString(),
    evidenceAsOf: new Date(NOW - 60_000).toISOString(),
  });
  expect(currentAssessment(skewed, serverNow(NOW))).toBe(false);
  observeServerTime(
    new Response(null, {
      headers: { 'x-trove-served-at': new Date(NOW + 10 * 60_000 + 500).toISOString() },
    }),
    NOW,
  );
  expect(currentAssessment(skewed, serverNow(NOW))).toBe(true);
  // A passed deadline (03:00 server time) still expires, though the device reads 02:50.
  expect(currentAssessment(assessment(), serverNow(Date.parse('2026-09-29T02:50:00Z')))).toBe(
    false,
  );
  resetServerClock();
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

test('Plan Score keeps to scoring: advisories and generic category lines stay out', async () => {
  const { travelerInsightGroups } = await import('../lib/plan-score/presentation');
  const overload = reason('PACE_COMFORT', 'RISK', 'HIGH_ACTIVE_LOAD');
  const rain = reason('EXPERIENCE_QUALITY', 'RISK', 'RAIN_FORECAST');
  const walking = reason('PACE_COMFORT', 'RISK', 'WALKING_LOAD');
  const timing = { ...reason('FEASIBILITY', 'INFO', 'ASSESSED_TIMING_WORKS'), action: null };
  const generic = {
    ...reason('PLAN_COMPOSITION', 'INFO', 'PLAN_COMPOSITION_SUPPORTED'),
    action: null,
  };
  const downtime = { ...reason('PACE_COMFORT', 'INFO', 'NATURAL_DOWNTIME'), action: null };
  expect(
    travelerInsightGroups({
      whatWorks: [timing, generic, downtime],
      worthImproving: [rain, overload, walking],
      uncertainty: [],
    }),
  ).toEqual({ issues: [overload], highlights: [timing] });
});
