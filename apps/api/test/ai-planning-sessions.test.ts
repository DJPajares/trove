import { creditModels } from './support/fake-ai-credits.js';
import { draftPlanScoreInputRevision } from '../src/services/ai-planning-plan-score.js';
import Fastify from 'fastify';
import { Prisma } from '@trove/db';
import { describe, expect, test, vi } from 'vitest';

import { registerAiPlanningSessionRoutes } from '../src/routes/ai-planning-sessions.js';
import {
  AI_PLANNING_PROMPT_MAX_LENGTH,
  acknowledgeAiPlanningWarnings,
  cancelAiPlanningSession,
  claimAiPlanningDispatch,
  completeAiPlanningRunFailure,
  completeAiPlanningRunSuccess,
  createAiPlanningSession,
  getAiPlanningAvailability,
  getAiPlanningSession,
  loadReviewableAiPlanningSessionForApply,
  normalizeAiPlanningPrompt,
  recoverLatestAiPlanningSession,
  regenerateAiPlanningSession,
  setAiPlanningTripDescription,
  setAiPlanningTripName,
  setAiPlanningCountries,
  serializeAiPlanningSession,
} from '../src/services/ai-planning-sessions.js';
import {
  setAiPlanningTelemetrySink,
  type AiPlanningTelemetryEvent,
} from '../src/services/ai-planning-telemetry.js';
import { emptyPlanScore, explicitDraft } from './fixtures/ai-planning.js';
import { suggestedDraftCountries } from '../src/services/ai-planning-countries.js';

const OWNER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_OWNER_ID = '00000000-0000-4000-8000-000000000002';
const NOW = new Date('2026-08-31T12:00:00.000Z');

test('reopening an expired assessment withholds its numbers without editing the stored score or draft', () => {
  const generatedAt = '2026-08-30T12:00:00.000Z';
  const score = { ...emptyPlanScore(), generatedAt, evidenceAsOf: generatedAt, score: 72 };
  const session = makeSession('00000000-0000-4000-8000-000000000169', {
    draft: explicitDraft(),
    planScore: score,
    draftRevision: 1,
    status: 'REVIEWING',
    stage: 'REVIEWING',
  });
  const response = serializeAiPlanningSession({ ...session, runs: [] } as never, NOW);
  expect(response.planScore?.score).toBeNull();
  expect(response.planScore?.generatedAt).toBe(generatedAt);
  expect(session.planScore).toBe(score);
  expect((session.planScore as typeof score).score).toBe(72);
  expect(response.draft).toBe(session.draft);
});
const AVAILABLE_ENVIRONMENT = {
  GOOGLE_VERTEX_CLIENT_EMAIL: 'ai@example.test',
  GOOGLE_VERTEX_PRIVATE_KEY: 'line-one\\nline-two',
  GOOGLE_VERTEX_PROJECT: 'trove-test',
  TROVE_AI_MODEL: 'gemini-3.1-flash-lite',
  TROVE_AI_PROVIDER: 'vertex',
};

type SessionState = {
  appliedTripId: string | null;
  createdAt: Date;
  draft: unknown;
  draftRevision: number;
  expiresAt: Date;
  id: string;
  lastErrorCode: string | null;
  planScore: unknown;
  ownerId: string;
  rawPrompt: string | null;
  schemaVersion: number;
  stage: string;
  status: string;
  tripDescription: string | null;
  tripName: string | null;
  reviewedCountries: string[];
  countriesReviewedRevision: number | null;
  countryContextChanged: boolean;
  updatedAt: Date;
  warningsAcknowledgedAt: Date | null;
  warningsAcknowledgedRevision: number | null;
};

type RunState = {
  baseDraftRevision: number;
  completedAt: Date | null;
  createdAt: Date;
  deadlineAt: Date | null;
  dispatchedAt: Date | null;
  errorCode: string | null;
  id: string;
  idempotencyKey: string;
  inputTokens: number | null;
  latencyMs: number | null;
  model: string;
  outputTokens: number | null;
  ownerId: string;
  provider: string;
  result: string;
  sessionId: string;
  totalTokens: number | null;
};

function valuesMatch(value: unknown, filter: unknown): boolean {
  if (filter === undefined) return true;
  if (filter && typeof filter === 'object' && !Array.isArray(filter)) {
    const record = filter as Record<string, unknown>;
    if ('in' in record) return (record.in as unknown[]).includes(value);
    if ('gt' in record) return value instanceof Date && value > (record.gt as Date);
    if ('lte' in record) return value instanceof Date && value <= (record.lte as Date);
  }
  return value === filter;
}

function createPlanningStore(
  storedPlaces: {
    customTimeZone: string | null;
    id: string;
    kind: 'PROVIDER';
    providerAddress: string | null;
    providerRefs: [];
  }[] = [],
) {
  const sessions = new Map<string, SessionState>();
  const runs = new Map<string, RunState>();
  const queries: unknown[] = [];
  let sessionCounter = 10;
  let runCounter = 100;
  let transactionTail = Promise.resolve<unknown>(undefined);

  const uuid = (counter: number) =>
    `00000000-0000-4000-8000-${counter.toString().padStart(12, '0')}`;
  const pendingRuns = (sessionId: string) =>
    [...runs.values()]
      .filter((run) => run.sessionId === sessionId && run.result === 'PENDING')
      .toSorted((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, 1)
      .map(({ deadlineAt, id }) => ({ deadlineAt, id }));
  const withRuns = (session: SessionState) => ({ ...session, runs: pendingRuns(session.id) });
  const sessionMatches = (session: SessionState, where: Record<string, unknown> = {}) =>
    valuesMatch(session.id, where.id) &&
    valuesMatch(session.ownerId, where.ownerId) &&
    valuesMatch(session.status, where.status) &&
    valuesMatch(session.countryContextChanged, where.countryContextChanged) &&
    valuesMatch(session.expiresAt, where.expiresAt) &&
    valuesMatch(session.draftRevision, where.draftRevision) &&
    valuesMatch(session.updatedAt, where.updatedAt);
  const runMatches = (run: RunState, where: Record<string, unknown> = {}) =>
    valuesMatch(run.id, where.id) &&
    valuesMatch(run.ownerId, where.ownerId) &&
    valuesMatch(run.sessionId, where.sessionId) &&
    valuesMatch(run.result, where.result) &&
    valuesMatch(run.dispatchedAt, where.dispatchedAt) &&
    valuesMatch(run.deadlineAt, where.deadlineAt);
  const applySessionData = (session: SessionState, data: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(data)) {
      if (key === 'draftRevision' && value && typeof value === 'object' && 'increment' in value) {
        session.draftRevision += Number((value as { increment: number }).increment);
      } else if ((key === 'draft' || key === 'planScore') && value === Prisma.DbNull) {
        (session as unknown as Record<string, unknown>)[key] = null;
      } else if (value !== undefined) {
        (session as unknown as Record<string, unknown>)[key] = value;
      }
    }
    session.updatedAt = new Date(session.updatedAt.getTime() + 1);
  };
  const applyRunData = (run: RunState, data: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) (run as unknown as Record<string, unknown>)[key] = value;
    }
  };

  const credits = creditModels(NOW);
  const transaction = {
    ...credits.models,
    $queryRaw(query: unknown) {
      queries.push(query);
      return Promise.resolve([{ id: OWNER_ID }]);
    },
    profile: {
      upsert: async () => ({ id: OWNER_ID }),
      findUnique: async () => ({ homeTimeZone: null }),
    },
    place: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        storedPlaces.filter((place) => where.id.in.includes(place.id)),
    },
    aiPlanningSession: {
      async create({ data }: { data: Record<string, any> }) {
        const id = uuid(sessionCounter++);
        const session: SessionState = {
          appliedTripId: null,
          createdAt: NOW,
          draft: null,
          draftRevision: 0,
          expiresAt: data.expiresAt,
          id,
          lastErrorCode: null,
          planScore: null,
          ownerId: data.ownerId,
          rawPrompt: data.rawPrompt,
          schemaVersion: 1,
          stage: 'PENDING' in data ? data.stage : 'CREATED',
          status: 'PENDING',
          tripDescription: null,
          tripName: null,
          reviewedCountries: [],
          countriesReviewedRevision: null,
          countryContextChanged: false,
          updatedAt: NOW,
          warningsAcknowledgedAt: null,
          warningsAcknowledgedRevision: null,
        };
        sessions.set(id, session);
        if (data.runs?.create) {
          const runId = uuid(runCounter++);
          runs.set(runId, {
            ...data.runs.create,
            completedAt: null,
            createdAt: NOW,
            deadlineAt: null,
            dispatchedAt: null,
            errorCode: null,
            id: runId,
            inputTokens: null,
            latencyMs: null,
            outputTokens: null,
            // Prisma fills both compound-relation scalars from the parent.
            ownerId: data.ownerId,
            result: 'PENDING',
            sessionId: id,
            totalTokens: null,
          });
        }
        return withRuns(session);
      },
      async findFirst({ where = {}, orderBy }: any) {
        const matching = [...sessions.values()].filter((session) => sessionMatches(session, where));
        if (orderBy?.updatedAt === 'desc') {
          matching.sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
        }
        return matching[0] ? withRuns(matching[0]) : null;
      },
      async findFirstOrThrow(args: any) {
        const result = await this.findFirst(args);
        if (!result) throw new Error('not_found');
        return result;
      },
      async findMany({ where = {} }: any) {
        return [...sessions.values()]
          .filter((session) => sessionMatches(session, where))
          .map(({ id }) => ({ id }));
      },
      async update({ where, data }: any) {
        const session = sessions.get(where.id);
        if (!session) throw new Error('not_found');
        applySessionData(session, data);
        return withRuns(session);
      },
      async updateMany({ where = {}, data }: any) {
        const matching = [...sessions.values()].filter((session) => sessionMatches(session, where));
        matching.forEach((session) => applySessionData(session, data));
        return { count: matching.length };
      },
    },
    aiGenerationRun: {
      async findMany({ where = {} }: any) {
        return [...runs.values()].filter((run) => runMatches(run, where));
      },
      async count({ where }: any) {
        return [...runs.values()].filter(
          (run) =>
            run.ownerId === where.ownerId &&
            run.dispatchedAt &&
            run.dispatchedAt > where.dispatchedAt.gt,
        ).length;
      },
      async create({ data }: any) {
        const id = uuid(runCounter++);
        const run: RunState = {
          ...data,
          completedAt: null,
          createdAt: NOW,
          deadlineAt: null,
          dispatchedAt: null,
          errorCode: null,
          id,
          inputTokens: null,
          latencyMs: null,
          outputTokens: null,
          result: 'PENDING',
          totalTokens: null,
        };
        runs.set(id, run);
        return run;
      },
      async findFirst({ where = {}, orderBy }: any) {
        let matching = [...runs.values()].filter((run) => runMatches(run, where));
        if (where.dispatchedAt?.gt) {
          matching = matching.filter(
            (run) => run.dispatchedAt && run.dispatchedAt > where.dispatchedAt.gt,
          );
        }
        if (orderBy?.dispatchedAt === 'asc') {
          matching.sort(
            (left, right) =>
              (left.dispatchedAt?.getTime() ?? 0) - (right.dispatchedAt?.getTime() ?? 0),
          );
        }
        const run = matching[0];
        return run ? (where.id ? { ...run, session: sessions.get(run.sessionId)! } : run) : null;
      },
      async findUnique({ where }: any) {
        const key = where.ownerId_idempotencyKey;
        const run = [...runs.values()].find(
          (candidate) =>
            candidate.ownerId === key.ownerId && candidate.idempotencyKey === key.idempotencyKey,
        );
        return run ? { sessionId: run.sessionId } : null;
      },
      async updateMany({ where = {}, data }: any) {
        const matching = [...runs.values()].filter((run) => runMatches(run, where));
        matching.forEach((run) => applyRunData(run, data));
        return { count: matching.length };
      },
    },
  };

  const prisma = {
    ...transaction,
    $transaction<T>(callback: (value: typeof transaction) => Promise<T>) {
      const operation = transactionTail.then(() => callback(transaction));
      transactionTail = operation.catch(() => undefined);
      return operation;
    },
  };

  return {
    addRun(run: RunState, session: SessionState) {
      sessions.set(session.id, session);
      runs.set(run.id, run);
    },
    prisma: prisma as never,
    queries,
    credits,
    runs,
    sessions,
  };
}

function makeSession(id: string, overrides: Partial<SessionState> = {}): SessionState {
  return {
    appliedTripId: null,
    createdAt: NOW,
    draft: null,
    draftRevision: 0,
    expiresAt: new Date(NOW.getTime() + 60_000),
    id,
    lastErrorCode: null,
    planScore: null,
    ownerId: OWNER_ID,
    rawPrompt: 'Plan Tokyo',
    schemaVersion: 1,
    stage: 'CREATED',
    status: 'PENDING',
    tripDescription: null,
    tripName: null,
    reviewedCountries: [],
    countriesReviewedRevision: null,
    countryContextChanged: false,
    updatedAt: NOW,
    warningsAcknowledgedAt: null,
    warningsAcknowledgedRevision: null,
    ...overrides,
  };
}

function makeRun(id: string, sessionId: string, overrides: Partial<RunState> = {}): RunState {
  return {
    baseDraftRevision: 0,
    completedAt: null,
    createdAt: NOW,
    deadlineAt: null,
    dispatchedAt: null,
    errorCode: null,
    id,
    idempotencyKey: id,
    inputTokens: null,
    latencyMs: null,
    model: 'gemini-3.1-flash-lite',
    outputTokens: null,
    ownerId: OWNER_ID,
    provider: 'vertex',
    result: 'PENDING',
    sessionId,
    totalTokens: null,
    ...overrides,
  };
}

describe('planning-session routes', () => {
  test('all lifecycle routes require authentication', async () => {
    const app = Fastify();
    registerAiPlanningSessionRoutes(app);
    const sessionId = '00000000-0000-4000-8000-000000000010';
    const requests = [
      { method: 'POST', url: '/ai/planning-sessions', payload: { prompt: 'Tokyo' } },
      { method: 'GET', url: '/ai/planning-sessions/availability' },
      { method: 'GET', url: '/ai/planning-sessions/recovery' },
      { method: 'GET', url: `/ai/planning-sessions/${sessionId}` },
      {
        method: 'PATCH',
        url: `/ai/planning-sessions/${sessionId}/description`,
        payload: { description: 'A week in Tokyo' },
      },
      {
        method: 'PATCH',
        url: `/ai/planning-sessions/${sessionId}/name`,
        payload: { name: 'A week in Tokyo' },
      },
      {
        method: 'PATCH',
        url: `/ai/planning-sessions/${sessionId}/countries`,
        payload: { countries: ['JP'], expectedRevision: 1 },
      },
      { method: 'POST', url: `/ai/planning-sessions/${sessionId}/regenerate`, payload: {} },
      {
        method: 'POST',
        url: `/ai/planning-sessions/${sessionId}/warnings/acknowledge`,
        payload: {},
      },
      { method: 'POST', url: `/ai/planning-sessions/${sessionId}/cancel`, payload: {} },
      { method: 'POST', url: `/ai/planning-sessions/${sessionId}/apply`, payload: {} },
    ] as const;

    for (const request of requests) {
      const response = await app.inject(request);
      expect(response.statusCode, `${request.method} ${request.url}`).toBe(401);
      expect(response.json()).toStrictEqual({ code: 'unauthorized' });
    }
    await app.close();
  });
});

describe('planning-session reservations and recovery', () => {
  test.each([
    { subscriptionStatus: 'active', tier: 'paid', credits: 50, days: 20, renewal: 'monthly' },
    { subscriptionStatus: 'inactive', tier: 'free', credits: 10, days: 10, renewal: 'lifetime' },
  ])(
    'availability resolves $subscriptionStatus Paid and preserves legacy fields',
    async (expected) => {
      const store = createPlanningStore();
      await store.credits.models.userEntitlement.create({
        data: {
          ownerId: OWNER_ID,
          planKey: 'paid',
          subscriptionStatus: expected.subscriptionStatus,
          monthlyAnchorAt: NOW,
        },
      });
      const availability = await getAiPlanningAvailability(OWNER_ID, {
        environment: AVAILABLE_ENVIRONMENT,
        now: () => NOW,
        prisma: store.prisma,
      });
      expect(availability).toMatchObject({
        tier: expected.tier,
        allowance: expected.credits,
        availableCredits: expected.credits,
        remainingDispatches: expected.credits,
        maxItineraryDays: expected.days,
        renewalPolicy: expected.renewal,
        status: 'available',
        code: null,
        retryAt: null,
      });
      expect(availability).not.toHaveProperty('subscriptionStatus');
      expect(availability).not.toHaveProperty('assignedPlan');
    },
  );

  test('new accounts receive fresh lifetime credits independently of legacy telemetry', async () => {
    const store = createPlanningStore();
    const sessionId = '00000000-0000-4000-8000-000000000010';
    for (let index = 0; index < 5; index += 1) {
      store.runs.set(
        `00000000-0000-4000-8000-${(index + 700).toString().padStart(12, '0')}`,
        makeRun(
          `00000000-0000-4000-8000-${(index + 700).toString().padStart(12, '0')}`,
          sessionId,
          { dispatchedAt: new Date(NOW.getTime() - (index + 1) * 1_000) },
        ),
      );
    }

    await expect(
      getAiPlanningAvailability(OWNER_ID, {
        environment: AVAILABLE_ENVIRONMENT,
        now: () => NOW,
        prisma: store.prisma,
      }),
    ).resolves.toMatchObject({
      code: null,
      remainingDispatches: 10,
      retryAt: null,
      status: 'available',
      tier: 'free',
      maxItineraryDays: 10,
      renewalPolicy: 'lifetime',
    });

    await expect(
      getAiPlanningAvailability(OWNER_ID, {
        environment: { TROVE_AI_DISABLED: 'true' },
        now: () => NOW,
        prisma: store.prisma,
      }),
    ).resolves.toStrictEqual({
      code: 'ai_disabled',
      remainingDispatches: null,
      retryAt: null,
      status: 'unavailable',
    });
  });

  test('reports credits independently of recent burst-rate attempts', async () => {
    const store = createPlanningStore();
    const sessionId = '00000000-0000-4000-8000-000000000012';
    for (let index = 0; index < 7; index += 1) {
      const runId = `00000000-0000-4000-8000-${String(index + 720).padStart(12, '0')}`;
      store.runs.set(
        runId,
        makeRun(runId, sessionId, { dispatchedAt: new Date(NOW.getTime() - index * 1_000) }),
      );
    }

    await expect(
      getAiPlanningAvailability(OWNER_ID, {
        environment: { ...AVAILABLE_ENVIRONMENT, TROVE_AI_PLANNER_STARTS_PER_MINUTE: '6' },
        now: () => NOW,
        prisma: store.prisma,
      }),
    ).resolves.toMatchObject({
      code: null,
      remainingDispatches: 10,
      retryAt: null,
      status: 'available',
    });

    await expect(
      getAiPlanningAvailability(OWNER_ID, {
        environment: {
          ...AVAILABLE_ENVIRONMENT,
          TROVE_AI_DISABLED: 'true',
          TROVE_AI_PLANNER_STARTS_PER_MINUTE: '6',
        },
        now: () => NOW,
        prisma: store.prisma,
      }),
    ).resolves.toMatchObject({ code: 'ai_disabled', status: 'unavailable' });
  });

  test('trims prompts, enforces 10,000 characters, and reuses create idempotency keys', async () => {
    const store = createPlanningStore();
    const key = '00000000-0000-4000-8000-000000000020';
    expect(normalizeAiPlanningPrompt('  Tokyo  ')).toBe('Tokyo');
    expect(() => normalizeAiPlanningPrompt(' '.repeat(4))).toThrowError('invalid_prompt');
    expect(() =>
      normalizeAiPlanningPrompt('x'.repeat(AI_PLANNING_PROMPT_MAX_LENGTH + 1)),
    ).toThrowError('invalid_prompt');

    const first = await createAiPlanningSession(OWNER_ID, '  Plan Tokyo  ', key, {
      now: () => NOW,
      prisma: store.prisma,
    });
    const retry = await createAiPlanningSession(OWNER_ID, 'ignored retry body', key, {
      now: () => NOW,
      prisma: store.prisma,
    });

    expect(retry.id).toBe(first.id);
    expect(retry.pendingRunId).toBe(first.pendingRunId);
    expect(store.sessions).toHaveLength(1);
    expect(store.runs).toHaveLength(1);
  });

  test('direct recovery hides another user and lazy expiry scrubs content', async () => {
    const store = createPlanningStore();
    const sessionId = '00000000-0000-4000-8000-000000000030';
    const session = makeSession(sessionId, {
      draft: explicitDraft(),
      draftRevision: 1,
      expiresAt: new Date(NOW.getTime() - 1),
      tripName: 'Private title',
      tripDescription: 'Private description',
      planScore: { score: 80 },
      status: 'REVIEWING',
    });
    store.addRun(makeRun('00000000-0000-4000-8000-000000000031', sessionId), session);

    await expect(
      getAiPlanningSession(OTHER_OWNER_ID, sessionId, { now: () => NOW, prisma: store.prisma }),
    ).rejects.toMatchObject({ code: 'session_not_found', statusCode: 404 });
    await expect(
      getAiPlanningSession(OWNER_ID, sessionId, { now: () => NOW, prisma: store.prisma }),
    ).rejects.toMatchObject({ code: 'session_expired', statusCode: 410 });
    expect(session).toMatchObject({
      draft: null,
      rawPrompt: null,
      tripName: null,
      tripDescription: null,
      planScore: null,
      status: 'EXPIRED',
    });
    expect(store.runs.values().next().value).toMatchObject({ result: 'CANCELLED' });
  });

  test('Generate replay cannot return a session at its exact expiry, even before cron', async () => {
    const store = createPlanningStore();
    const key = '00000000-0000-4000-8000-000000000039';
    const first = await createAiPlanningSession(OWNER_ID, 'Private prompt', key, {
      now: () => NOW,
      prisma: store.prisma,
    });
    const session = store.sessions.get(first.id)!;
    session.tripName = 'Private title';
    session.tripDescription = 'Private description';
    session.planScore = { score: 80 };
    await expect(
      createAiPlanningSession(OWNER_ID, 'retry', key, {
        now: () => session.expiresAt,
        prisma: store.prisma,
      }),
    ).rejects.toMatchObject({ code: 'session_expired', statusCode: 410 });
    expect(session).toMatchObject({
      draft: null,
      rawPrompt: null,
      tripName: null,
      tripDescription: null,
      planScore: null,
      status: 'EXPIRED',
    });
    expect(store.sessions).toHaveLength(1);
  });

  test('legacy applied rows are scrubbed on access and no longer readable at expiry', async () => {
    const store = createPlanningStore();
    const sessionId = '00000000-0000-4000-8000-000000000038';
    const session = makeSession(sessionId, {
      appliedTripId: '00000000-0000-4000-8000-000000000099',
      draft: explicitDraft(),
      rawPrompt: 'Private prompt',
      tripName: 'Private title',
      tripDescription: 'Private description',
      planScore: { score: 80 },
      status: 'APPLIED',
    });
    store.sessions.set(sessionId, session);
    await expect(
      getAiPlanningSession(OWNER_ID, sessionId, { now: () => NOW, prisma: store.prisma }),
    ).resolves.toMatchObject({
      appliedTripId: session.appliedTripId,
      draft: null,
      prompt: null,
      tripName: null,
      tripDescription: null,
      planScore: null,
    });
    expect(session).toMatchObject({
      draft: null,
      rawPrompt: null,
      tripName: null,
      tripDescription: null,
      planScore: null,
    });
    await expect(
      getAiPlanningSession(OWNER_ID, sessionId, {
        now: () => session.expiresAt,
        prisma: store.prisma,
      }),
    ).rejects.toMatchObject({ code: 'session_expired', statusCode: 410 });
  });

  test('every session-targeting mutation returns the same 404 for another owner', async () => {
    const store = createPlanningStore();
    const sessionId = '00000000-0000-4000-8000-000000000035';
    store.sessions.set(
      sessionId,
      makeSession(sessionId, {
        draft: explicitDraft(),
        draftRevision: 1,
        stage: 'REVIEWING',
        status: 'REVIEWING',
      }),
    );
    const calls = [
      () =>
        setAiPlanningTripDescription(OTHER_OWNER_ID, sessionId, 'Intruding description', {
          now: () => NOW,
          prisma: store.prisma,
        }),
      () =>
        setAiPlanningTripName(OTHER_OWNER_ID, sessionId, 'Intruding name', {
          now: () => NOW,
          prisma: store.prisma,
        }),
      () =>
        regenerateAiPlanningSession(
          OTHER_OWNER_ID,
          sessionId,
          'Intruding',
          1,
          '00000000-0000-4000-8000-000000000036',
          { now: () => NOW, prisma: store.prisma },
        ),
      () =>
        acknowledgeAiPlanningWarnings(OTHER_OWNER_ID, sessionId, 1, {
          now: () => NOW,
          prisma: store.prisma,
        }),
      () =>
        cancelAiPlanningSession(OTHER_OWNER_ID, sessionId, {
          now: () => NOW,
          prisma: store.prisma,
        }),
    ];

    for (const call of calls) {
      await expect(call()).rejects.toMatchObject({ code: 'session_not_found', statusCode: 404 });
    }
    await expect(
      recoverLatestAiPlanningSession(OTHER_OWNER_ID, { now: () => NOW, prisma: store.prisma }),
    ).resolves.toBeNull();
  });

  test('latest recovery selects the most recently updated active session', async () => {
    const store = createPlanningStore();
    const older = makeSession('00000000-0000-4000-8000-000000000040');
    const latest = makeSession('00000000-0000-4000-8000-000000000041', {
      status: 'FAILED',
      updatedAt: new Date(NOW.getTime() + 10),
    });
    store.sessions.set(older.id, older);
    store.sessions.set(latest.id, latest);

    await expect(
      recoverLatestAiPlanningSession(OWNER_ID, { now: () => NOW, prisma: store.prisma }),
    ).resolves.toMatchObject({ id: latest.id, status: 'failed' });
  });

  test('regeneration is idempotent and rejects stale or concurrent reservations', async () => {
    const store = createPlanningStore();
    const sessionId = '00000000-0000-4000-8000-000000000050';
    store.sessions.set(
      sessionId,
      makeSession(sessionId, { draft: explicitDraft(), draftRevision: 1, status: 'REVIEWING' }),
    );
    const key = '00000000-0000-4000-8000-000000000051';
    const first = await regenerateAiPlanningSession(OWNER_ID, sessionId, 'Try again', 1, key, {
      now: () => NOW,
      prisma: store.prisma,
    });
    const retry = await regenerateAiPlanningSession(OWNER_ID, sessionId, 'Try again', 1, key, {
      now: () => NOW,
      prisma: store.prisma,
    });
    expect(retry.pendingRunId).toBe(first.pendingRunId);
    await expect(
      regenerateAiPlanningSession(
        OWNER_ID,
        sessionId,
        'Another run',
        1,
        '00000000-0000-4000-8000-000000000052',
        { now: () => NOW, prisma: store.prisma },
      ),
    ).rejects.toMatchObject({ code: 'session_not_reviewable', statusCode: 409 });
  });
});

describe('review session safety', () => {
  test('country suggestions use only named destination countries in their draft order', () => {
    const draft = explicitDraft();
    expect(suggestedDraftCountries(draft)).toStrictEqual([]);
    draft.places.find((place) => place.id === 'place:tokyo')!.name = 'Tokyo, Japan';
    expect(suggestedDraftCountries(draft)).toStrictEqual(['JP']);
    draft.places.find((place) => place.id === 'place:museum')!.name = 'Seoul, South Korea';
    draft.trip.destinations.push({
      id: 'draft-destination:seoul',
      placeRefId: 'place:museum',
      destinationIntentId: null,
      assumptionId: null,
      source: 'model',
    });
    expect(suggestedDraftCountries(draft)).toStrictEqual(['JP', 'KR']);
  });

  test('a verified bare-city destination suggests its stored country without confirming it', async () => {
    const draft = explicitDraft();
    const destination = draft.places.find((place) => place.id === 'place:tokyo')!;
    if (destination.resolution !== 'verified') throw new Error('expected a verified destination');
    destination.name = 'Da Nang';
    const store = createPlanningStore([
      {
        customTimeZone: null,
        id: destination.placeId,
        kind: 'PROVIDER',
        providerAddress: 'Da Nang, Hai Chau, Da Nang, Vietnam',
        providerRefs: [],
      },
    ]);
    const sessionId = '00000000-0000-4000-8000-000000000161';
    store.sessions.set(
      sessionId,
      makeSession(sessionId, {
        draft,
        draftRevision: 1,
        stage: 'REVIEWING',
        status: 'REVIEWING',
      }),
    );

    const review = await getAiPlanningSession(OWNER_ID, sessionId, {
      now: () => NOW,
      prisma: store.prisma,
    });
    expect(review.suggestedCountries).toStrictEqual(['VN']);
    expect(review.reviewedCountries).toStrictEqual([]);
    const confirmed = await setAiPlanningCountries(OWNER_ID, sessionId, ['VN'], 1, {
      now: () => NOW,
      prisma: store.prisma,
    });
    expect(confirmed.countryContextChanged).toBe(false);
    expect(confirmed.suggestedCountries).toStrictEqual(['VN']);
  });

  test('country confirmation is owner-scoped, revision-checked, and separate from the draft', async () => {
    const store = createPlanningStore();
    const sessionId = '00000000-0000-4000-8000-000000000160';
    const draft = explicitDraft();
    const score = {
      ...emptyPlanScore(),
      generatedAt: NOW.toISOString(),
      evidenceAsOf: NOW.toISOString(),
      recomputeAfter: new Date(NOW.getTime() + 86400000).toISOString(),
      sourceInputRevision: draftPlanScoreInputRevision(draft),
    };
    store.sessions.set(
      sessionId,
      makeSession(sessionId, {
        draft,
        draftRevision: 2,
        planScore: score,
        stage: 'REVIEWING',
        status: 'REVIEWING',
        warningsAcknowledgedAt: NOW,
        warningsAcknowledgedRevision: 2,
      }),
    );
    const options = { now: () => NOW, prisma: store.prisma };
    await expect(
      setAiPlanningCountries(OTHER_OWNER_ID, sessionId, ['JP'], 2, options),
    ).rejects.toMatchObject({ code: 'session_not_found' });
    await expect(
      setAiPlanningCountries(OWNER_ID, sessionId, ['XX'], 2, options),
    ).rejects.toMatchObject({ code: 'invalid_countries' });
    await expect(
      setAiPlanningCountries(OWNER_ID, sessionId, ['JP'], 1, options),
    ).rejects.toMatchObject({ code: 'draft_conflict' });

    const reviewed = await setAiPlanningCountries(
      OWNER_ID,
      sessionId,
      ['jp', 'KR', 'JP'],
      2,
      options,
    );
    expect(reviewed).toMatchObject({
      countryContextChanged: true,
      countriesReviewedRevision: 2,
      draftRevision: 2,
      planScore: null,
      reviewedCountries: ['JP', 'KR'],
      suggestedCountries: [],
      warningAcknowledgement: null,
    });
    expect(store.sessions.get(sessionId)?.draft).toEqual(draft);
    expect(store.runs.size).toBe(0);
    await acknowledgeAiPlanningWarnings(OWNER_ID, sessionId, 2, options);
    const replay = await setAiPlanningCountries(OWNER_ID, sessionId, ['JP', 'KR'], 2, options);
    expect(replay.warningAcknowledgement?.revision).toBe(2);
  });

  test('older overlapping drafts remain reviewable and country-editable but cannot be applied', async () => {
    const store = createPlanningStore();
    const sessionId = '00000000-0000-4000-8000-000000000162';
    const draft = explicitDraft();
    const day = draft.days[1]!;
    day.items[1]!.schedule = { kind: 'exact', localTime: '09:30', source: 'model' };
    draft.places.find((place) => place.id === 'place:tokyo')!.name = 'Tokyo, Japan';
    store.sessions.set(
      sessionId,
      makeSession(sessionId, {
        draft,
        draftRevision: 1,
        planScore: emptyPlanScore(),
        stage: 'REVIEWING',
        status: 'REVIEWING',
      }),
    );
    const options = { now: () => NOW, prisma: store.prisma };
    const reviewed = await getAiPlanningSession(OWNER_ID, sessionId, options);
    expect(reviewed).toMatchObject({
      draft,
      lastSafeError: 'schedule_conflict',
      planScore: null,
      suggestedCountries: ['JP'],
    });
    await setAiPlanningCountries(OWNER_ID, sessionId, ['JP'], 1, options);
    await expect(
      loadReviewableAiPlanningSessionForApply(OWNER_ID, sessionId, 1, options),
    ).rejects.toMatchObject({ code: 'schedule_conflict' });
    expect(store.sessions.get(sessionId)?.draft).toStrictEqual(draft);
  });

  test('a country correction leaves score and acknowledgement intact when located destinations fix the timezone', async () => {
    const store = createPlanningStore();
    const sessionId = '00000000-0000-4000-8000-000000000161';
    const draft = explicitDraft();
    draft.places.find((place) => place.id === 'place:tokyo')!.name = 'Tokyo, Japan';
    const score = {
      ...emptyPlanScore(),
      generatedAt: NOW.toISOString(),
      evidenceAsOf: NOW.toISOString(),
      recomputeAfter: new Date(NOW.getTime() + 86400000).toISOString(),
      sourceInputRevision: draftPlanScoreInputRevision(draft),
    };
    store.sessions.set(
      sessionId,
      makeSession(sessionId, {
        draft,
        draftRevision: 1,
        planScore: score,
        stage: 'REVIEWING',
        status: 'REVIEWING',
        warningsAcknowledgedAt: NOW,
        warningsAcknowledgedRevision: 1,
      }),
    );
    const reviewed = await setAiPlanningCountries(OWNER_ID, sessionId, ['KR'], 1, {
      now: () => NOW,
      prisma: store.prisma,
    });
    expect(reviewed.suggestedCountries).toStrictEqual(['JP']);
    expect(reviewed.countryContextChanged).toBe(false);
    expect(reviewed.planScore).toEqual(score);
    expect(reviewed.warningAcknowledgement?.revision).toBe(1);
  });

  test('warning acknowledgement is revision-exact', async () => {
    const store = createPlanningStore();
    const sessionId = '00000000-0000-4000-8000-000000000062';
    store.sessions.set(
      sessionId,
      makeSession(sessionId, {
        draft: explicitDraft(),
        draftRevision: 2,
        stage: 'REVIEWING',
        status: 'REVIEWING',
      }),
    );
    await expect(
      acknowledgeAiPlanningWarnings(OWNER_ID, sessionId, 1, {
        now: () => NOW,
        prisma: store.prisma,
      }),
    ).rejects.toMatchObject({ code: 'draft_conflict', statusCode: 409 });
    await expect(
      acknowledgeAiPlanningWarnings(OWNER_ID, sessionId, 2, {
        now: () => NOW,
        prisma: store.prisma,
      }),
    ).resolves.toMatchObject({
      warningAcknowledgement: { acknowledgedAt: NOW.toISOString(), revision: 2 },
    });
  });
});

describe('dispatch quota and lifecycle completion', () => {
  test.each([
    { days: 3, accepted: true },
    { days: 14, accepted: false },
  ])(
    'dispatch rechecks status after Paid preflight for a $days-day request',
    async ({ days, accepted }) => {
      const store = createPlanningStore();
      const options = { environment: AVAILABLE_ENVIRONMENT, now: () => NOW, prisma: store.prisma };
      await store.credits.models.userEntitlement.create({
        data: { ownerId: OWNER_ID, planKey: 'paid', monthlyAnchorAt: NOW },
      });
      const session = await createAiPlanningSession(
        OWNER_ID,
        `Plan a ${days}-day trip to Tokyo`,
        '00000000-0000-4000-8000-000000000995',
        options,
      );
      const paidPeriod = await store.credits.models.aiCreditPeriod.findFirst({
        where: { ownerId: OWNER_ID, planKey: 'paid' },
      });
      await store.credits.models.userEntitlement.update({
        where: { ownerId: OWNER_ID },
        data: { subscriptionStatus: 'inactive' },
      });
      if (accepted) {
        await expect(
          claimAiPlanningDispatch(OWNER_ID, session.pendingRunId!, options),
        ).resolves.toMatchObject({ maxItineraryDays: 10 });
        const action = await store.credits.models.aiCreditAction.findFirst({
          where: { ownerId: OWNER_ID },
        });
        const freePeriod = await store.credits.models.aiCreditPeriod.findFirst({
          where: { ownerId: OWNER_ID, planKey: 'free' },
        });
        expect(action.periodId).toBe(freePeriod.id);
        expect(freePeriod.reserved).toBe(1);
      } else {
        await expect(
          claimAiPlanningDispatch(OWNER_ID, session.pendingRunId!, options),
        ).rejects.toMatchObject({ code: 'itinerary_day_limit_exceeded' });
        expect(
          await store.credits.models.aiCreditAction.count({ where: { ownerId: OWNER_ID } }),
        ).toBe(0);
        expect(store.runs.get(session.pendingRunId!)?.result).toBe('FAILED');
      }
      expect(
        await store.credits.models.aiCreditPeriod.findUnique({ where: { id: paidPeriod.id } }),
      ).toMatchObject({ used: 0, reserved: 0 });
    },
  );

  test('a valid draft consumes one reserved credit and a duplicate completion cannot consume another', async () => {
    const store = createPlanningStore();
    const options = { environment: AVAILABLE_ENVIRONMENT, now: () => NOW, prisma: store.prisma };
    const session = await createAiPlanningSession(
      OWNER_ID,
      'Plan a 3-day trip to Tokyo',
      '00000000-0000-4000-8000-000000000996',
      options,
    );
    const runId = session.pendingRunId!;
    await claimAiPlanningDispatch(OWNER_ID, runId, options);
    const metadata = {
      inputTokens: 10,
      latencyMs: 50,
      model: 'test',
      outputTokens: 20,
      provider: 'vertex',
      totalTokens: 30,
    };
    await completeAiPlanningRunSuccess(
      OWNER_ID,
      runId,
      explicitDraft(),
      emptyPlanScore(),
      metadata,
      options,
    );
    await expect(
      completeAiPlanningRunSuccess(
        OWNER_ID,
        runId,
        explicitDraft(),
        emptyPlanScore(),
        metadata,
        options,
      ),
    ).rejects.toMatchObject({ code: 'draft_conflict' });
    expect(await getAiPlanningAvailability(OWNER_ID, options)).toMatchObject({
      usedCredits: 1,
      reservedCredits: 0,
      availableCredits: 9,
    });
    expect(await store.credits.models.aiCreditEvent.count({ where: { kind: 'consume' } })).toBe(1);
  });

  test('explicit oversized requests create no generation or credit action', async () => {
    const store = createPlanningStore();
    await expect(
      createAiPlanningSession(
        OWNER_ID,
        'Plan a 14-day trip to Japan',
        '00000000-0000-4000-8000-000000000999',
        {
          environment: AVAILABLE_ENVIRONMENT,
          now: () => NOW,
          prisma: store.prisma,
        },
      ),
    ).rejects.toMatchObject({ code: 'itinerary_day_limit_exceeded', maxItineraryDays: 10 });
    expect(store.runs.size).toBe(0);
    expect(store.sessions.size).toBe(0);
    expect(await store.credits.models.aiCreditAction.count({ where: {} })).toBe(0);
  });

  test.each([false, true])(
    'user cancellation costs a credit only after dispatch (%s)',
    async (dispatch) => {
      const store = createPlanningStore();
      const options = { environment: AVAILABLE_ENVIRONMENT, now: () => NOW, prisma: store.prisma };
      const session = await createAiPlanningSession(
        OWNER_ID,
        'Plan a 3-day trip to Tokyo',
        '00000000-0000-4000-8000-000000000998',
        options,
      );
      if (dispatch) await claimAiPlanningDispatch(OWNER_ID, session.pendingRunId!, options);
      await cancelAiPlanningSession(OWNER_ID, session.id, options);
      await cancelAiPlanningSession(OWNER_ID, session.id, options);
      expect(await getAiPlanningAvailability(OWNER_ID, options)).toMatchObject({
        usedCredits: dispatch ? 1 : 0,
        reservedCredits: 0,
        availableCredits: dispatch ? 9 : 10,
      });
    },
  );

  test('failed generation refunds its reservation and telemetry deletion does not allow an idempotent redispatch', async () => {
    const store = createPlanningStore();
    const options = { environment: AVAILABLE_ENVIRONMENT, now: () => NOW, prisma: store.prisma };
    const key = '00000000-0000-4000-8000-000000000997';
    const session = await createAiPlanningSession(
      OWNER_ID,
      'Plan a 3-day trip to Tokyo',
      key,
      options,
    );
    await claimAiPlanningDispatch(OWNER_ID, session.pendingRunId!, options);
    await completeAiPlanningRunFailure(
      OWNER_ID,
      session.pendingRunId!,
      'provider_unavailable',
      null,
      options,
    );
    await completeAiPlanningRunFailure(OWNER_ID, session.pendingRunId!, 'timeout', null, options);
    expect(await getAiPlanningAvailability(OWNER_ID, options)).toMatchObject({
      availableCredits: 10,
      usedCredits: 0,
      reservedCredits: 0,
    });
    store.runs.clear();
    const replay = await createAiPlanningSession(
      OWNER_ID,
      'Plan a 3-day trip to Tokyo',
      key,
      options,
    );
    expect(replay).toMatchObject({ id: session.id, pendingRunId: null });
    expect(store.runs.size).toBe(0);
  });

  test('the minute burst limit is configurable independently of the credit allowance', async () => {
    const store = createPlanningStore();
    for (let index = 0; index < 5; index += 1) {
      const sessionId = `00000000-0000-4000-8000-${String(65 + index).padStart(12, '0')}`;
      const runId = `00000000-0000-4000-8000-${String(75 + index).padStart(12, '0')}`;
      store.addRun(
        makeRun(runId, sessionId, { dispatchedAt: NOW, result: 'SUCCEEDED' }),
        makeSession(sessionId, { status: 'REVIEWING' }),
      );
    }
    const sessionId = '00000000-0000-4000-8000-000000000070';
    const runId = '00000000-0000-4000-8000-000000000080';
    store.addRun(makeRun(runId, sessionId), makeSession(sessionId));

    await expect(
      claimAiPlanningDispatch(OWNER_ID, runId, {
        environment: { ...AVAILABLE_ENVIRONMENT, TROVE_AI_PLANNER_STARTS_PER_MINUTE: '6' },
        now: () => NOW,
        prisma: store.prisma,
      }),
    ).resolves.toMatchObject({ runId, sessionId });
    expect([...store.runs.values()].filter((run) => run.dispatchedAt)).toHaveLength(6);
  });

  test('serializes six concurrent claims so the sixth hits the minute burst guard', async () => {
    const store = createPlanningStore();
    const claims = Array.from({ length: 6 }, (_, index) => {
      const sessionId = `00000000-0000-4000-8000-${String(70 + index).padStart(12, '0')}`;
      const runId = `00000000-0000-4000-8000-${String(80 + index).padStart(12, '0')}`;
      store.addRun(makeRun(runId, sessionId), makeSession(sessionId));
      return claimAiPlanningDispatch(OWNER_ID, runId, {
        environment: AVAILABLE_ENVIRONMENT,
        now: () => NOW,
        prisma: store.prisma,
      });
    });
    const results = await Promise.allSettled(claims);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(5);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({
      reason: { code: 'rate_limited', statusCode: 429 },
      status: 'rejected',
    });
    expect([...store.runs.values()].filter((run) => run.dispatchedAt)).toHaveLength(5);
  });

  test('a refused dispatch is attributable without naming what was refused', async () => {
    const events: AiPlanningTelemetryEvent[] = [];
    setAiPlanningTelemetrySink((event) => events.push(event));

    try {
      const store = createPlanningStore();
      const sessionId = '00000000-0000-4000-8000-000000000130';
      const runId = '00000000-0000-4000-8000-000000000131';
      store.addRun(makeRun(runId, sessionId), makeSession(sessionId));

      await expect(
        claimAiPlanningDispatch(OWNER_ID, runId, {
          environment: { ...AVAILABLE_ENVIRONMENT, TROVE_AI_DISABLED: '1' },
          now: () => NOW,
          prisma: store.prisma,
        }),
      ).rejects.toMatchObject({ code: 'ai_disabled' });

      const quotaStore = createPlanningStore();
      for (let index = 0; index < 5; index += 1) {
        const usedSessionId = `00000000-0000-4000-8000-${String(140 + index).padStart(12, '0')}`;
        const usedRunId = `00000000-0000-4000-8000-${String(150 + index).padStart(12, '0')}`;
        quotaStore.addRun(
          makeRun(usedRunId, usedSessionId, { dispatchedAt: NOW, result: 'SUCCEEDED' }),
          makeSession(usedSessionId, { status: 'REVIEWING' }),
        );
      }
      const blockedSessionId = '00000000-0000-4000-8000-000000000160';
      const blockedRunId = '00000000-0000-4000-8000-000000000161';
      quotaStore.addRun(makeRun(blockedRunId, blockedSessionId), makeSession(blockedSessionId));

      await expect(
        claimAiPlanningDispatch(OWNER_ID, blockedRunId, {
          environment: AVAILABLE_ENVIRONMENT,
          now: () => NOW,
          prisma: quotaStore.prisma,
        }),
      ).rejects.toMatchObject({ code: 'rate_limited' });
    } finally {
      setAiPlanningTelemetrySink(null);
    }

    // Enough to alert on quota pressure or a flipped kill switch, and nothing
    // that says which traveller or which trip was refused.
    expect(events).toStrictEqual([
      { code: 'ai_disabled', kind: 'dispatch_rejected', occurredAt: NOW.toISOString() },
      { code: 'rate_limited', kind: 'dispatch_rejected', occurredAt: NOW.toISOString() },
    ]);
  });

  test('uses a strict rolling boundary and reports the next retry time', async () => {
    const store = createPlanningStore();
    const cutoff = new Date(NOW.getTime() - 60_000);
    for (let index = 0; index < 5; index += 1) {
      const sessionId = `00000000-0000-4000-8000-${String(100 + index).padStart(12, '0')}`;
      const runId = `00000000-0000-4000-8000-${String(110 + index).padStart(12, '0')}`;
      store.addRun(
        makeRun(runId, sessionId, {
          dispatchedAt: index === 0 ? cutoff : new Date(cutoff.getTime() + index * 1_000),
          result: 'SUCCEEDED',
        }),
        makeSession(sessionId, { status: 'REVIEWING' }),
      );
    }
    const claimSessionId = '00000000-0000-4000-8000-000000000120';
    const claimRunId = '00000000-0000-4000-8000-000000000121';
    store.addRun(makeRun(claimRunId, claimSessionId), makeSession(claimSessionId));
    await expect(
      claimAiPlanningDispatch(OWNER_ID, claimRunId, {
        environment: AVAILABLE_ENVIRONMENT,
        now: () => NOW,
        prisma: store.prisma,
      }),
    ).resolves.toMatchObject({ runId: claimRunId });

    const blockedSessionId = '00000000-0000-4000-8000-000000000122';
    const blockedRunId = '00000000-0000-4000-8000-000000000123';
    store.addRun(makeRun(blockedRunId, blockedSessionId), makeSession(blockedSessionId));
    await expect(
      claimAiPlanningDispatch(OWNER_ID, blockedRunId, {
        environment: AVAILABLE_ENVIRONMENT,
        now: () => NOW,
        prisma: store.prisma,
      }),
    ).rejects.toMatchObject({
      code: 'rate_limited',
      retryAt: new Date(cutoff.getTime() + 1_000 + 60_000),
    });
    expect(store.runs.get(blockedRunId)).toMatchObject({
      dispatchedAt: null,
      result: 'FAILED',
      errorCode: 'rate_limited',
    });
    expect(store.sessions.get(blockedSessionId)?.status).toBe('FAILED');
  });

  test.each([
    [{ TROVE_AI_DISABLED: 'true' }, 'ai_disabled'],
    [{ TROVE_AI_BUDGET_DISABLED: 'true' }, 'ai_budget_disabled'],
    [{ GOOGLE_VERTEX_PROJECT: 'trove', TROVE_AI_PROVIDER: 'invalid' }, 'configuration_invalid'],
  ])('rejects %s before dispatch with %s', async (environment, code) => {
    const store = createPlanningStore();
    const sessionId = '00000000-0000-4000-8000-000000000130';
    const runId = '00000000-0000-4000-8000-000000000131';
    const session = makeSession(sessionId);
    const run = makeRun(runId, sessionId);
    store.addRun(run, session);

    await expect(
      claimAiPlanningDispatch(OWNER_ID, runId, {
        environment,
        now: () => NOW,
        prisma: store.prisma,
      }),
    ).rejects.toMatchObject({ code, statusCode: 503 });
    expect(run).toMatchObject({ dispatchedAt: null, errorCode: code, result: 'FAILED' });
    expect(session).toMatchObject({ draftRevision: 0, status: 'FAILED' });
  });

  test('failed regeneration preserves the previous draft and reviewing revision', async () => {
    const store = createPlanningStore();
    const sessionId = '00000000-0000-4000-8000-000000000140';
    const runId = '00000000-0000-4000-8000-000000000141';
    const draft = explicitDraft();
    const session = makeSession(sessionId, {
      draft,
      draftRevision: 1,
      reviewedCountries: ['JP'],
      countriesReviewedRevision: 1,
      stage: 'GENERATING',
      status: 'GENERATING',
    });
    const run = makeRun(runId, sessionId, { baseDraftRevision: 1, dispatchedAt: NOW });
    store.addRun(run, session);
    await completeAiPlanningRunFailure(OWNER_ID, runId, 'provider_unavailable', null, {
      now: () => NOW,
      prisma: store.prisma,
    });
    expect(session).toMatchObject({
      draft,
      draftRevision: 1,
      status: 'REVIEWING',
      reviewedCountries: ['JP'],
      countriesReviewedRevision: 1,
    });
    expect(run).toMatchObject({ errorCode: 'provider_unavailable', result: 'FAILED' });
  });

  test('an overdue run becomes terminal and a late success cannot publish its draft', async () => {
    const store = createPlanningStore();
    const sessionId = '00000000-0000-4000-8000-000000000142';
    const runId = '00000000-0000-4000-8000-000000000143';
    const session = makeSession(sessionId, { stage: 'GROUNDING', status: 'GENERATING' });
    const run = makeRun(runId, sessionId, {
      deadlineAt: new Date(NOW.getTime() - 1),
      dispatchedAt: new Date(NOW.getTime() - 90_000),
    });
    store.addRun(run, session);

    const read = await getAiPlanningSession(OWNER_ID, sessionId, {
      now: () => NOW,
      prisma: store.prisma,
    });
    expect(read).toMatchObject({
      deadlineAt: null,
      draft: null,
      lastSafeError: 'timeout',
      status: 'failed',
    });
    expect(run).toMatchObject({
      errorCode: 'timeout',
      failureStage: 'grounding',
      result: 'FAILED',
    });
    await expect(
      completeAiPlanningRunSuccess(
        OWNER_ID,
        runId,
        explicitDraft(),
        emptyPlanScore(),
        {
          inputTokens: 10,
          latencyMs: 50,
          model: 'gemini-test',
          outputTokens: 20,
          provider: 'vertex',
          totalTokens: 30,
        },
        { now: () => NOW, prisma: store.prisma },
      ),
    ).rejects.toMatchObject({ code: 'draft_conflict' });
    expect(session.draft).toBeNull();
  });

  test('an overdue regeneration keeps the previous valid draft', async () => {
    const store = createPlanningStore();
    const sessionId = '00000000-0000-4000-8000-000000000144';
    const runId = '00000000-0000-4000-8000-000000000145';
    const draft = explicitDraft();
    const session = makeSession(sessionId, {
      draft,
      draftRevision: 1,
      stage: 'VALIDATING',
      status: 'GENERATING',
    });
    const run = makeRun(runId, sessionId, {
      baseDraftRevision: 1,
      deadlineAt: new Date(NOW.getTime() - 1),
      dispatchedAt: new Date(NOW.getTime() - 90_000),
    });
    store.addRun(run, session);
    const read = await getAiPlanningSession(OWNER_ID, sessionId, {
      now: () => NOW,
      prisma: store.prisma,
    });
    expect(read).toMatchObject({
      draft,
      draftRevision: 1,
      lastSafeError: 'timeout',
      status: 'reviewing',
    });
    expect(run).toMatchObject({ errorCode: 'timeout', result: 'FAILED' });
  });

  test('successful completion increments once and cancellation prevents resurrection', async () => {
    const metadata = {
      inputTokens: 10,
      latencyMs: 50,
      model: 'gemini-3.1-flash-lite',
      outputTokens: 20,
      provider: 'vertex',
      totalTokens: 30,
    };
    const store = createPlanningStore();
    const sessionId = '00000000-0000-4000-8000-000000000150';
    const runId = '00000000-0000-4000-8000-000000000151';
    const session = makeSession(sessionId, {
      stage: 'GENERATING',
      status: 'GENERATING',
      reviewedCountries: ['JP'],
      countriesReviewedRevision: 0,
      countryContextChanged: true,
    });
    const run = makeRun(runId, sessionId, { dispatchedAt: NOW });
    store.addRun(run, session);
    await completeAiPlanningRunSuccess(
      OWNER_ID,
      runId,
      explicitDraft(),
      emptyPlanScore(),
      metadata,
      {
        now: () => NOW,
        prisma: store.prisma,
      },
    );
    expect(session).toMatchObject({
      draftRevision: 1,
      status: 'REVIEWING',
      reviewedCountries: [],
      countriesReviewedRevision: null,
      countryContextChanged: false,
    });
    await expect(
      completeAiPlanningRunSuccess(OWNER_ID, runId, explicitDraft(), emptyPlanScore(), metadata, {
        now: () => NOW,
        prisma: store.prisma,
      }),
    ).rejects.toMatchObject({ code: 'draft_conflict' });

    const raceStore = createPlanningStore();
    const raceSessionId = '00000000-0000-4000-8000-000000000152';
    const raceRunId = '00000000-0000-4000-8000-000000000153';
    const raceSession = makeSession(raceSessionId, {
      stage: 'GENERATING',
      status: 'GENERATING',
    });
    raceStore.addRun(makeRun(raceRunId, raceSessionId, { dispatchedAt: NOW }), raceSession);
    await cancelAiPlanningSession(OWNER_ID, raceSessionId, {
      now: () => NOW,
      prisma: raceStore.prisma,
    });
    await expect(
      completeAiPlanningRunSuccess(
        OWNER_ID,
        raceRunId,
        explicitDraft(),
        emptyPlanScore(),
        metadata,
        {
          now: () => NOW,
          prisma: raceStore.prisma,
        },
      ),
    ).rejects.toMatchObject({ code: 'draft_conflict' });
    expect(raceSession).toMatchObject({ draft: null, rawPrompt: null, status: 'CANCELLED' });
  });

  test('repeated cancellation stays content-free and does not dispatch', async () => {
    const store = createPlanningStore();
    const sessionId = '00000000-0000-4000-8000-000000000160';
    const runId = '00000000-0000-4000-8000-000000000161';
    const session = makeSession(sessionId, {
      draft: explicitDraft(),
      draftRevision: 1,
      tripName: 'Private title',
      tripDescription: 'Private description',
      planScore: { score: 80 },
      status: 'REVIEWING',
      warningsAcknowledgedAt: NOW,
      warningsAcknowledgedRevision: 1,
    });
    const run = makeRun(runId, sessionId);
    store.addRun(run, session);
    await cancelAiPlanningSession(OWNER_ID, sessionId, { now: () => NOW, prisma: store.prisma });
    await cancelAiPlanningSession(OWNER_ID, sessionId, { now: () => NOW, prisma: store.prisma });
    expect(session).toMatchObject({
      draft: null,
      rawPrompt: null,
      tripName: null,
      tripDescription: null,
      planScore: null,
      status: 'CANCELLED',
      warningsAcknowledgedAt: null,
      warningsAcknowledgedRevision: null,
    });
    expect(run).toMatchObject({ dispatchedAt: null, result: 'CANCELLED' });
  });
});

test('the administrative scoring kill switch hides an AI assessment without changing its draft', () => {
  const previous = process.env.TROVE_PLAN_SCORE_DISABLED;
  try {
    process.env.TROVE_PLAN_SCORE_DISABLED = 'true';
    const draft = explicitDraft();
    const session = makeSession('00000000-0000-4000-8000-000000000168', {
      draft,
      planScore: emptyPlanScore(),
      draftRevision: 1,
      status: 'REVIEWING',
      stage: 'REVIEWING',
    });
    const response = serializeAiPlanningSession({ ...session, runs: [] } as never, NOW);
    expect(response.planScore).toBeNull();
    expect(response.draft).toEqual(draft);
    expect(session.planScore).not.toBeNull();
  } finally {
    if (previous === undefined) delete process.env.TROVE_PLAN_SCORE_DISABLED;
    else process.env.TROVE_PLAN_SCORE_DISABLED = previous;
  }
});

test('reopening null and legacy draft assessments recomputes locally without a generation run', async () => {
  vi.stubEnv('TROVE_PLAN_SCORE_DISABLED', 'false');
  const outbound = vi.fn(() => {
    throw new Error('unexpected model/provider request');
  });
  vi.stubGlobal('fetch', outbound);
  const places = vi.fn(async () => []);
  vi.stubGlobal('trovePrismaClient', {
    place: { findMany: places },
    placeProviderRef: { findUnique: vi.fn(async () => null) },
    travelLegCache: { findUnique: vi.fn(async () => null) },
    weatherForecastSnapshot: { findUnique: vi.fn(async () => null) },
  });
  try {
    for (const previous of [null, { ...emptyPlanScore(), schemaVersion: 6, rubricVersion: 6 }]) {
      const store = createPlanningStore();
      const draft = explicitDraft();
      const session = makeSession('00000000-0000-4000-8000-000000000170', {
        draft,
        draftRevision: 1,
        planScore: previous,
        status: 'REVIEWING',
        stage: 'REVIEWING',
      });
      store.sessions.set(session.id, session);
      const a = await getAiPlanningSession(OWNER_ID, session.id, {
        prisma: store.prisma as never,
        now: () => NOW,
      });
      const b = await getAiPlanningSession(OWNER_ID, session.id, {
        prisma: store.prisma as never,
        now: () => NOW,
      });
      expect(a.planScore?.schemaVersion).toBe(8);
      expect(b.planScore?.fingerprint).toBe(a.planScore?.fingerprint);
      expect(store.runs.size).toBe(0);
      expect(session.draft).toBe(draft);
    }
    expect(outbound).not.toHaveBeenCalled();
    expect(places).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

test('a late draft score cannot overwrite or return a concurrently regenerated session', async () => {
  vi.stubEnv('TROVE_PLAN_SCORE_DISABLED', 'false');
  const store = createPlanningStore();
  const session = makeSession('00000000-0000-4000-8000-000000000171', {
    draft: explicitDraft(),
    draftRevision: 1,
    planScore: null,
    status: 'REVIEWING',
    stage: 'REVIEWING',
  });
  store.sessions.set(session.id, session);
  const outbound = vi.fn(() => {
    throw new Error('unexpected provider request');
  });
  vi.stubGlobal('fetch', outbound);
  vi.stubGlobal('trovePrismaClient', {
    place: {
      findMany: vi.fn(async () => {
        session.status = 'GENERATING';
        session.draftRevision = 2;
        session.updatedAt = new Date(session.updatedAt.getTime() + 1);
        return [];
      }),
    },
    placeProviderRef: { findUnique: vi.fn(async () => null) },
    travelLegCache: { findUnique: vi.fn(async () => null) },
    weatherForecastSnapshot: { findUnique: vi.fn(async () => null) },
  });
  try {
    const response = await getAiPlanningSession(OWNER_ID, session.id, {
      prisma: store.prisma as never,
      now: () => NOW,
    });
    expect(response.status).toBe('generating');
    expect(response.planScore).toBeNull();
    expect(session.planScore).toBeNull();
    expect(outbound).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});
