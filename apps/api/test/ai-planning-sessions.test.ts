import Fastify from 'fastify';
import { Prisma } from '@trove/db';
import { describe, expect, test } from 'vitest';

import { registerAiPlanningSessionRoutes } from '../src/routes/ai-planning-sessions.js';
import {
  AI_PLANNING_DISPATCH_WINDOW_MS,
  AI_PLANNING_PROMPT_MAX_LENGTH,
  acknowledgeAiPlanningWarnings,
  AiPlanningSessionError,
  cancelAiPlanningSession,
  claimAiPlanningDispatch,
  completeAiPlanningRunFailure,
  completeAiPlanningRunSuccess,
  createAiPlanningSession,
  getAiPlanningSession,
  normalizeAiPlanningPrompt,
  prepareAiPlanningDraftEdit,
  recoverLatestAiPlanningSession,
  regenerateAiPlanningSession,
  replaceAiPlanningDraft,
} from '../src/services/ai-planning-sessions.js';
import { customPlaceDraft, explicitDraft } from './fixtures/ai-planning.js';

const OWNER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_OWNER_ID = '00000000-0000-4000-8000-000000000002';
const NOW = new Date('2026-08-31T12:00:00.000Z');
const AVAILABLE_ENVIRONMENT = {
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
  ownerId: string;
  rawPrompt: string | null;
  schemaVersion: number;
  stage: string;
  status: string;
  updatedAt: Date;
  warningsAcknowledgedAt: Date | null;
  warningsAcknowledgedRevision: number | null;
};

type RunState = {
  baseDraftRevision: number;
  completedAt: Date | null;
  createdAt: Date;
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

function createPlanningStore() {
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
      .map(({ id }) => ({ id }));
  const withRuns = (session: SessionState) => ({ ...session, runs: pendingRuns(session.id) });
  const sessionMatches = (session: SessionState, where: Record<string, unknown> = {}) =>
    valuesMatch(session.id, where.id) &&
    valuesMatch(session.ownerId, where.ownerId) &&
    valuesMatch(session.status, where.status) &&
    valuesMatch(session.expiresAt, where.expiresAt) &&
    valuesMatch(session.draftRevision, where.draftRevision);
  const runMatches = (run: RunState, where: Record<string, unknown> = {}) =>
    valuesMatch(run.id, where.id) &&
    valuesMatch(run.ownerId, where.ownerId) &&
    valuesMatch(run.sessionId, where.sessionId) &&
    valuesMatch(run.result, where.result) &&
    valuesMatch(run.dispatchedAt, where.dispatchedAt);
  const applySessionData = (session: SessionState, data: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(data)) {
      if (key === 'draftRevision' && value && typeof value === 'object' && 'increment' in value) {
        session.draftRevision += Number((value as { increment: number }).increment);
      } else if (key === 'draft' && value === Prisma.DbNull) {
        session.draft = null;
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

  const transaction = {
    $queryRaw(query: unknown) {
      queries.push(query);
      return Promise.resolve([{ id: OWNER_ID }]);
    },
    profile: { upsert: async () => ({ id: OWNER_ID }) },
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
          ownerId: data.ownerId,
          rawPrompt: data.rawPrompt,
          schemaVersion: 1,
          stage: 'PENDING' in data ? data.stage : 'CREATED',
          status: 'PENDING',
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
            dispatchedAt: null,
            errorCode: null,
            id: runId,
            inputTokens: null,
            latencyMs: null,
            outputTokens: null,
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
        return run
          ? where.id
            ? { ...run, session: sessions.get(run.sessionId)! }
            : { dispatchedAt: run.dispatchedAt }
          : null;
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
    ownerId: OWNER_ID,
    rawPrompt: 'Plan Tokyo',
    schemaVersion: 1,
    stage: 'CREATED',
    status: 'PENDING',
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
      { method: 'GET', url: '/ai/planning-sessions/recovery' },
      { method: 'GET', url: `/ai/planning-sessions/${sessionId}` },
      { method: 'PATCH', url: `/ai/planning-sessions/${sessionId}/draft`, payload: {} },
      { method: 'POST', url: `/ai/planning-sessions/${sessionId}/regenerate`, payload: {} },
      {
        method: 'POST',
        url: `/ai/planning-sessions/${sessionId}/warnings/acknowledge`,
        payload: {},
      },
      { method: 'POST', url: `/ai/planning-sessions/${sessionId}/cancel`, payload: {} },
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
      status: 'REVIEWING',
    });
    store.addRun(makeRun('00000000-0000-4000-8000-000000000031', sessionId), session);

    await expect(
      getAiPlanningSession(OTHER_OWNER_ID, sessionId, { now: () => NOW, prisma: store.prisma }),
    ).rejects.toMatchObject({ code: 'session_not_found', statusCode: 404 });
    await expect(
      getAiPlanningSession(OWNER_ID, sessionId, { now: () => NOW, prisma: store.prisma }),
    ).rejects.toMatchObject({ code: 'session_expired', statusCode: 410 });
    expect(session).toMatchObject({ draft: null, rawPrompt: null, status: 'EXPIRED' });
    expect(store.runs.values().next().value).toMatchObject({ result: 'CANCELLED' });
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
        replaceAiPlanningDraft(OTHER_OWNER_ID, sessionId, explicitDraft(), 1, {
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

describe('review draft safety', () => {
  test('allows review edits and promotes changed AI durations to user ownership', () => {
    const current = customPlaceDraft();
    const input = structuredClone(current);
    input.trip.name = 'My Tokyo plan';
    input.trip.partySize = 3;
    const customPlace = input.places.find((place) => place.id === 'place:custom');
    if (!customPlace || customPlace.resolution !== 'custom') throw new Error('fixture missing');
    customPlace.name = 'My quiet viewpoint';
    customPlace.note = 'Use the east entrance.';
    const item = input.unscheduledItems[0]!;
    item.durationMinutes = 75;
    item.notes = 'Bring water.';
    item.priority = 'interested';
    item.schedule = { kind: 'exact', localTime: '14:00', source: 'user' };

    const edited = prepareAiPlanningDraftEdit(current, input);
    expect(edited.trip).toMatchObject({ name: 'My Tokyo plan', nameSource: 'user', partySize: 3 });
    expect(edited.places.find((place) => place.id === 'place:custom')).toMatchObject({
      name: 'My quiet viewpoint',
      note: 'Use the east entrance.',
    });
    expect(edited.unscheduledItems[0]).toMatchObject({
      durationMinutes: 75,
      durationProvenance: 'user_owned',
      notes: 'Bring water.',
      priority: 'interested',
    });
  });

  test('rejects date, destination, evidence, verified identity, and item provenance changes', () => {
    const current = explicitDraft();
    const cases = [
      () => {
        const value = structuredClone(current);
        value.trip.startDate = '2026-10-01';
        return value;
      },
      () => {
        const value = structuredClone(current);
        value.days[0]!.destinationId = null;
        return value;
      },
      () => {
        const value = structuredClone(current);
        value.evidence[0]!.provider = 'other';
        return value;
      },
      () => {
        const value = structuredClone(current);
        const place = value.places[0]!;
        if (place.resolution === 'verified') place.name = 'Spoofed destination';
        return value;
      },
      () => {
        const value = structuredClone(current);
        value.days[1]!.items[0]!.origin = 'model';
        return value;
      },
    ];

    cases.forEach((makeValue) =>
      expect(() => prepareAiPlanningDraftEdit(current, makeValue())).toThrow(
        AiPlanningSessionError,
      ),
    );
  });

  test('full draft replacement increments once, rejects stale revisions, and resets acknowledgement', async () => {
    const store = createPlanningStore();
    const sessionId = '00000000-0000-4000-8000-000000000060';
    const session = makeSession(sessionId, {
      draft: explicitDraft(),
      draftRevision: 1,
      stage: 'REVIEWING',
      status: 'REVIEWING',
      warningsAcknowledgedAt: NOW,
      warningsAcknowledgedRevision: 1,
    });
    store.sessions.set(sessionId, session);
    const input = explicitDraft();
    input.trip.name = 'Edited Tokyo';
    const updated = await replaceAiPlanningDraft(OWNER_ID, sessionId, input, 1, {
      now: () => NOW,
      prisma: store.prisma,
    });
    expect(updated).toMatchObject({ draftRevision: 2, warningAcknowledgement: null });
    await expect(
      replaceAiPlanningDraft(OWNER_ID, sessionId, input, 1, {
        now: () => NOW,
        prisma: store.prisma,
      }),
    ).rejects.toMatchObject({ code: 'draft_conflict', statusCode: 409 });
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
  test('serializes six concurrent claims so only five consume the rolling quota', async () => {
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
      reason: { code: 'quota_exceeded', statusCode: 429 },
      status: 'rejected',
    });
    expect([...store.runs.values()].filter((run) => run.dispatchedAt)).toHaveLength(5);
  });

  test('uses a strict rolling boundary and reports the next retry time', async () => {
    const store = createPlanningStore();
    const cutoff = new Date(NOW.getTime() - AI_PLANNING_DISPATCH_WINDOW_MS);
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
      code: 'quota_exceeded',
      retryAt: new Date(cutoff.getTime() + 1_000 + AI_PLANNING_DISPATCH_WINDOW_MS),
    });
    expect(store.runs.get(blockedRunId)?.dispatchedAt).toBeNull();
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
      stage: 'GENERATING',
      status: 'GENERATING',
    });
    const run = makeRun(runId, sessionId, { baseDraftRevision: 1, dispatchedAt: NOW });
    store.addRun(run, session);
    await completeAiPlanningRunFailure(OWNER_ID, runId, 'provider_unavailable', null, {
      now: () => NOW,
      prisma: store.prisma,
    });
    expect(session).toMatchObject({ draft, draftRevision: 1, status: 'REVIEWING' });
    expect(run).toMatchObject({ errorCode: 'provider_unavailable', result: 'FAILED' });
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
    const session = makeSession(sessionId, { stage: 'GENERATING', status: 'GENERATING' });
    const run = makeRun(runId, sessionId, { dispatchedAt: NOW });
    store.addRun(run, session);
    await completeAiPlanningRunSuccess(OWNER_ID, runId, explicitDraft(), metadata, {
      now: () => NOW,
      prisma: store.prisma,
    });
    expect(session).toMatchObject({ draftRevision: 1, status: 'REVIEWING' });
    await expect(
      completeAiPlanningRunSuccess(OWNER_ID, runId, explicitDraft(), metadata, {
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
      completeAiPlanningRunSuccess(OWNER_ID, raceRunId, explicitDraft(), metadata, {
        now: () => NOW,
        prisma: raceStore.prisma,
      }),
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
      status: 'CANCELLED',
      warningsAcknowledgedAt: null,
      warningsAcknowledgedRevision: null,
    });
    expect(run).toMatchObject({ dispatchedAt: null, result: 'CANCELLED' });
  });
});
