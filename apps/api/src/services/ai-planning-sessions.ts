import { getPrismaClient, Prisma } from '@trove/db';
import { AI_PLANNER_SCHEMA_VERSION } from '@trove/types';

import {
  DEFAULT_AI_MODEL,
  DEFAULT_AI_PROVIDER,
  getAiGenerationEnvironment,
  getAiPlanningDispatchLimit,
} from '../environment.js';
import type { AiGenerationErrorCode, AiGenerationMetadata } from './ai-generation.js';
import { validateAiPlannerDraft } from './ai-planning-rules.js';
import { parseStoredPlanScore, type TripPlanScore } from './plan-score.js';
import {
  recordAiPlanningDispatchRejected,
  type AiPlanningDispatchRejectionCode,
} from './ai-planning-telemetry.js';

export const AI_PLANNING_PROMPT_MAX_LENGTH = 10_000;
export const AI_PLANNING_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const AI_PLANNING_DISPATCH_WINDOW_MS = 24 * 60 * 60 * 1_000;

const ACTIVE_STATUSES = ['FAILED', 'GENERATING', 'PENDING', 'REVIEWING'] as const;
/**
 * Ordered, and `updateAiPlanningStage` rejects any move backwards through it, so
 * this sequence has to match the pipeline's. The pipeline schedules before it
 * grounds: a run only looks up the places its finished itinerary stands on.
 */
const DISPATCH_STAGES = ['GENERATING', 'SCHEDULING', 'GROUNDING', 'VALIDATING'] as const;
const SESSION_EXPIRED = Symbol('session_expired');

type PlanningPrisma = ReturnType<typeof getPrismaClient>;
type PlanningTransaction = Prisma.TransactionClient;
type PlanningOptions = {
  environment?: Record<string, string | undefined>;
  now?: () => Date;
  prisma?: PlanningPrisma;
};

type PendingRun = { id: string };
type SessionRecord = {
  appliedTripId: string | null;
  createdAt: Date;
  draft: Prisma.JsonValue | null;
  draftRevision: number;
  expiresAt: Date;
  id: string;
  lastErrorCode: string | null;
  ownerId: string;
  rawPrompt: string | null;
  runs: PendingRun[];
  schemaVersion: number;
  stage: string;
  planScore: Prisma.JsonValue | null;
  status: string;
  tripDescription: string | null;
  tripName: string | null;
  updatedAt: Date;
  warningsAcknowledgedAt: Date | null;
  warningsAcknowledgedRevision: number | null;
};

export type AiPlanningSessionErrorCode =
  | 'ai_budget_disabled'
  | 'ai_disabled'
  | 'configuration_invalid'
  | 'configuration_missing'
  | 'draft_conflict'
  | 'draft_invalid'
  | 'draft_provenance_immutable'
  | 'idempotency_key_required'
  | 'invalid_time_zone'
  | 'place_unresolved'
  | 'provider_unavailable'
  | 'invalid_prompt'
  | 'quota_exceeded'
  | 'regenerate_required'
  | 'run_already_claimed'
  | 'session_busy'
  | 'session_expired'
  | 'session_not_found'
  | 'session_not_reviewable'
  | 'warnings_not_acknowledged';

export type AiPlanningAvailability = {
  code: Extract<
    AiPlanningSessionErrorCode,
    'ai_budget_disabled' | 'ai_disabled' | 'configuration_invalid' | 'configuration_missing'
  > | null;
  remainingDispatches: number | null;
  retryAt: Date | null;
  status: 'available' | 'quota_exhausted' | 'unavailable';
};

export class AiPlanningSessionError extends Error {
  constructor(
    public readonly code: AiPlanningSessionErrorCode,
    public readonly statusCode: 400 | 404 | 409 | 410 | 429 | 503,
    public readonly retryAt: Date | null = null,
  ) {
    super(code);
    this.name = 'AiPlanningSessionError';
  }
}

function nowFrom(options: PlanningOptions) {
  return options.now?.() ?? new Date();
}

function prismaFrom(options: PlanningOptions) {
  return options.prisma ?? getPrismaClient();
}

export function normalizeAiPlanningPrompt(value: string) {
  const prompt = value.trim();
  if (!prompt || prompt.length > AI_PLANNING_PROMPT_MAX_LENGTH) {
    throw new AiPlanningSessionError('invalid_prompt', 400);
  }
  return prompt;
}

/**
 * A read-only, advisory view of the same limits `claimAiPlanningDispatch`
 * enforces. It intentionally does not lock the Profile row: another request
 * may dispatch between this read and a Generate click, and the claim remains
 * the only authority for that race.
 */
export async function getAiPlanningAvailability(
  ownerId: string,
  options: PlanningOptions = {},
): Promise<AiPlanningAvailability> {
  const configuration = getAiGenerationEnvironment(options.environment);
  if (configuration.status === 'unavailable') {
    return {
      code: configuration.code,
      remainingDispatches: null,
      retryAt: null,
      status: 'unavailable',
    };
  }

  const prisma = prismaFrom(options);
  const now = nowFrom(options);
  const dispatchLimit = getAiPlanningDispatchLimit(options.environment);
  const cutoff = new Date(now.getTime() - AI_PLANNING_DISPATCH_WINDOW_MS);
  const [dispatched, oldest] = await Promise.all([
    prisma.aiGenerationRun.count({ where: { dispatchedAt: { gt: cutoff }, ownerId } }),
    prisma.aiGenerationRun.findFirst({
      where: { dispatchedAt: { gt: cutoff }, ownerId },
      orderBy: { dispatchedAt: 'asc' },
      select: { dispatchedAt: true },
    }),
  ]);

  if (dispatched >= dispatchLimit) {
    return {
      code: null,
      remainingDispatches: 0,
      retryAt: new Date((oldest?.dispatchedAt ?? now).getTime() + AI_PLANNING_DISPATCH_WINDOW_MS),
      status: 'quota_exhausted',
    };
  }

  return {
    code: null,
    remainingDispatches: dispatchLimit - dispatched,
    retryAt: null,
    status: 'available',
  };
}

function reservationProvider(environment?: Record<string, string | undefined>) {
  const configuration = getAiGenerationEnvironment(environment);
  return configuration.status === 'available'
    ? { model: configuration.vertex.model, provider: configuration.provider }
    : { model: DEFAULT_AI_MODEL, provider: DEFAULT_AI_PROVIDER };
}

const sessionInclude = {
  runs: {
    orderBy: { createdAt: 'desc' as const },
    select: { id: true },
    take: 1,
    where: { result: 'PENDING' as const },
  },
} as const;

export function serializeAiPlanningSession(session: SessionRecord) {
  return {
    appliedTripId: session.appliedTripId,
    createdAt: session.createdAt.toISOString(),
    draft: session.draft,
    draftRevision: session.draftRevision,
    expiresAt: session.expiresAt.toISOString(),
    id: session.id,
    lastSafeError: session.lastErrorCode,
    pendingRunId: session.runs[0]?.id ?? null,
    planScore: parseStoredPlanScore(session.planScore),
    prompt: session.rawPrompt,
    schemaVersion: session.schemaVersion,
    stage: session.stage.toLowerCase(),
    status: session.status.toLowerCase(),
    tripDescription: session.tripDescription,
    tripName: session.tripName,
    updatedAt: session.updatedAt.toISOString(),
    warningAcknowledgement:
      session.warningsAcknowledgedRevision === null || !session.warningsAcknowledgedAt
        ? null
        : {
            acknowledgedAt: session.warningsAcknowledgedAt.toISOString(),
            revision: session.warningsAcknowledgedRevision,
          },
  };
}

async function ensureAndLockOwner(transaction: PlanningTransaction, ownerId: string) {
  await transaction.profile.upsert({
    where: { id: ownerId },
    create: { id: ownerId },
    update: {},
  });
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "trove"."profiles" WHERE "id" = ${ownerId}::uuid FOR UPDATE`,
  );
}

async function scrubExpiredSession(
  transaction: PlanningTransaction,
  ownerId: string,
  sessionId: string,
  now: Date,
) {
  await transaction.aiGenerationRun.updateMany({
    where: { ownerId, result: 'PENDING', sessionId },
    data: { completedAt: now, result: 'CANCELLED' },
  });
  await transaction.aiPlanningSession.updateMany({
    where: { id: sessionId, ownerId },
    data: {
      draft: Prisma.DbNull,
      lastErrorCode: null,
      rawPrompt: null,
      stage: 'COMPLETE',
      status: 'EXPIRED',
      warningsAcknowledgedAt: null,
      warningsAcknowledgedRevision: null,
    },
  });
}

async function expireIfNeeded(
  transaction: PlanningTransaction,
  session: { expiresAt: Date; id: string; ownerId: string; status: string },
  now: Date,
) {
  if (session.status !== 'EXPIRED' && session.expiresAt > now) return false;
  await scrubExpiredSession(transaction, session.ownerId, session.id, now);
  return true;
}

async function findOwnedSession(
  transaction: PlanningTransaction,
  ownerId: string,
  sessionId: string,
) {
  const session = await transaction.aiPlanningSession.findFirst({
    where: { id: sessionId, ownerId },
    include: sessionInclude,
  });
  if (!session) throw new AiPlanningSessionError('session_not_found', 404);
  return session;
}

export async function createAiPlanningSession(
  ownerId: string,
  promptInput: string,
  idempotencyKey: string,
  options: PlanningOptions = {},
) {
  const prompt = normalizeAiPlanningPrompt(promptInput);
  const prisma = prismaFrom(options);
  const now = nowFrom(options);
  const provider = reservationProvider(options.environment);

  const session = await prisma.$transaction(async (transaction) => {
    await ensureAndLockOwner(transaction, ownerId);
    const existing = await transaction.aiGenerationRun.findUnique({
      where: { ownerId_idempotencyKey: { idempotencyKey, ownerId } },
      select: { sessionId: true },
    });
    if (existing) {
      return transaction.aiPlanningSession.findFirstOrThrow({
        where: { id: existing.sessionId, ownerId },
        include: sessionInclude,
      });
    }

    // The run inherits both `sessionId` and `ownerId` from the parent session
    // through the compound relation, so neither may be passed here.
    const reservedRun: Prisma.AiGenerationRunUncheckedCreateWithoutSessionInput = {
      baseDraftRevision: 0,
      idempotencyKey,
      model: provider.model,
      provider: provider.provider,
    };

    return transaction.aiPlanningSession.create({
      data: {
        expiresAt: new Date(now.getTime() + AI_PLANNING_SESSION_TTL_MS),
        ownerId,
        rawPrompt: prompt,
        runs: { create: reservedRun },
      },
      include: sessionInclude,
    });
  });

  return serializeAiPlanningSession(session);
}

async function expireOwnedSessions(prisma: PlanningPrisma, ownerId: string, now: Date) {
  await prisma.$transaction(async (transaction) => {
    const expired = await transaction.aiPlanningSession.findMany({
      where: { expiresAt: { lte: now }, ownerId, status: { in: [...ACTIVE_STATUSES] } },
      select: { id: true },
    });
    for (const session of expired) {
      await scrubExpiredSession(transaction, ownerId, session.id, now);
    }
  });
}

export async function recoverLatestAiPlanningSession(
  ownerId: string,
  options: PlanningOptions = {},
) {
  const prisma = prismaFrom(options);
  const now = nowFrom(options);
  await expireOwnedSessions(prisma, ownerId, now);
  const session = await prisma.aiPlanningSession.findFirst({
    where: {
      expiresAt: { gt: now },
      ownerId,
      status: { in: [...ACTIVE_STATUSES] },
    },
    include: sessionInclude,
    orderBy: { updatedAt: 'desc' },
  });
  return session ? serializeAiPlanningSession(session) : null;
}

export async function getAiPlanningSession(
  ownerId: string,
  sessionId: string,
  options: PlanningOptions = {},
) {
  const prisma = prismaFrom(options);
  const now = nowFrom(options);
  const session = await prisma.$transaction(async (transaction) => {
    const found = await findOwnedSession(transaction, ownerId, sessionId);
    if (await expireIfNeeded(transaction, found, now)) return SESSION_EXPIRED;
    return found;
  });
  if (session === SESSION_EXPIRED) throw new AiPlanningSessionError('session_expired', 410);
  return serializeAiPlanningSession(session);
}

export async function regenerateAiPlanningSession(
  ownerId: string,
  sessionId: string,
  promptInput: string,
  expectedRevision: number,
  idempotencyKey: string,
  options: PlanningOptions = {},
) {
  const prompt = normalizeAiPlanningPrompt(promptInput);
  const prisma = prismaFrom(options);
  const now = nowFrom(options);
  const provider = reservationProvider(options.environment);

  const session = await prisma.$transaction(async (transaction) => {
    await ensureAndLockOwner(transaction, ownerId);
    const found = await findOwnedSession(transaction, ownerId, sessionId);
    if (await expireIfNeeded(transaction, found, now)) return SESSION_EXPIRED;
    const existing = await transaction.aiGenerationRun.findUnique({
      where: { ownerId_idempotencyKey: { idempotencyKey, ownerId } },
      select: { sessionId: true },
    });
    if (existing) {
      if (existing.sessionId !== sessionId) {
        throw new AiPlanningSessionError('draft_conflict', 409);
      }
      return transaction.aiPlanningSession.findFirstOrThrow({
        where: { id: sessionId, ownerId },
        include: sessionInclude,
      });
    }

    if (!['FAILED', 'REVIEWING'].includes(found.status)) {
      throw new AiPlanningSessionError('session_not_reviewable', 409);
    }
    if (found.draftRevision !== expectedRevision) {
      throw new AiPlanningSessionError('draft_conflict', 409);
    }
    if (found.runs.length > 0) throw new AiPlanningSessionError('session_busy', 409);

    // A top-level create owns both relation scalars directly, unlike the
    // nested reservation in `createAiPlanningSession`.
    const reservedRun: Prisma.AiGenerationRunUncheckedCreateInput = {
      baseDraftRevision: found.draftRevision,
      idempotencyKey,
      model: provider.model,
      ownerId,
      provider: provider.provider,
      sessionId,
    };
    await transaction.aiGenerationRun.create({ data: reservedRun });
    return transaction.aiPlanningSession.update({
      where: { id: sessionId },
      data: {
        lastErrorCode: null,
        rawPrompt: prompt,
        stage: 'CREATED',
        status: 'PENDING',
        warningsAcknowledgedAt: null,
        warningsAcknowledgedRevision: null,
      },
      include: sessionInclude,
    });
  });

  if (session === SESSION_EXPIRED) throw new AiPlanningSessionError('session_expired', 410);
  return serializeAiPlanningSession(session);
}

function parseStoredDraft(value: Prisma.JsonValue | null) {
  const validated = validateAiPlannerDraft(value);
  if (!validated.success) throw new AiPlanningSessionError('draft_invalid', 400);
  return validated.data;
}

/**
 * The one field of a reviewed session a traveller can change. It is session
 * metadata rather than part of the plan, so it never touches the draft JSON and
 * never moves `draftRevision`: a description cannot change what was generated,
 * and must not invalidate the evidence or the Plan Score computed against it.
 */
export async function setAiPlanningTripDescription(
  ownerId: string,
  sessionId: string,
  description: string | null,
  options: PlanningOptions = {},
) {
  const prisma = prismaFrom(options);
  const now = nowFrom(options);
  const session = await prisma.$transaction(async (transaction) => {
    await ensureAndLockOwner(transaction, ownerId);
    const found = await findOwnedSession(transaction, ownerId, sessionId);
    if (await expireIfNeeded(transaction, found, now)) return SESSION_EXPIRED;
    if (found.status !== 'REVIEWING' || !found.draft) {
      throw new AiPlanningSessionError('session_not_reviewable', 409);
    }
    await transaction.aiPlanningSession.updateMany({
      where: { id: sessionId, ownerId, status: 'REVIEWING' },
      data: { tripDescription: description?.trim() || null },
    });
    return transaction.aiPlanningSession.findFirstOrThrow({
      where: { id: sessionId, ownerId },
      include: sessionInclude,
    });
  });
  if (session === SESSION_EXPIRED) throw new AiPlanningSessionError('session_expired', 410);
  return serializeAiPlanningSession(session);
}

/**
 * Same contract as `setAiPlanningTripDescription`: session metadata beside the
 * draft, so it never moves `draftRevision` and never clears a warning
 * acknowledgement. A regenerate still surfaces the model's fresh title
 * whenever the traveller has not chosen their own.
 */
export async function setAiPlanningTripName(
  ownerId: string,
  sessionId: string,
  name: string | null,
  options: PlanningOptions = {},
) {
  const prisma = prismaFrom(options);
  const now = nowFrom(options);
  const session = await prisma.$transaction(async (transaction) => {
    await ensureAndLockOwner(transaction, ownerId);
    const found = await findOwnedSession(transaction, ownerId, sessionId);
    if (await expireIfNeeded(transaction, found, now)) return SESSION_EXPIRED;
    if (found.status !== 'REVIEWING' || !found.draft) {
      throw new AiPlanningSessionError('session_not_reviewable', 409);
    }
    await transaction.aiPlanningSession.updateMany({
      where: { id: sessionId, ownerId, status: 'REVIEWING' },
      data: { tripName: name?.trim() || null },
    });
    return transaction.aiPlanningSession.findFirstOrThrow({
      where: { id: sessionId, ownerId },
      include: sessionInclude,
    });
  });
  if (session === SESSION_EXPIRED) throw new AiPlanningSessionError('session_expired', 410);
  return serializeAiPlanningSession(session);
}

export async function acknowledgeAiPlanningWarnings(
  ownerId: string,
  sessionId: string,
  revision: number,
  options: PlanningOptions = {},
) {
  const prisma = prismaFrom(options);
  const now = nowFrom(options);
  const session = await prisma.$transaction(async (transaction) => {
    await ensureAndLockOwner(transaction, ownerId);
    const found = await findOwnedSession(transaction, ownerId, sessionId);
    if (await expireIfNeeded(transaction, found, now)) return SESSION_EXPIRED;
    if (found.status !== 'REVIEWING' || !found.draft) {
      throw new AiPlanningSessionError('session_not_reviewable', 409);
    }
    if (found.draftRevision !== revision) {
      throw new AiPlanningSessionError('draft_conflict', 409);
    }
    const updated = await transaction.aiPlanningSession.updateMany({
      where: { draftRevision: revision, id: sessionId, ownerId, status: 'REVIEWING' },
      data: { warningsAcknowledgedAt: now, warningsAcknowledgedRevision: revision },
    });
    if (updated.count !== 1) throw new AiPlanningSessionError('draft_conflict', 409);
    return transaction.aiPlanningSession.findFirstOrThrow({
      where: { id: sessionId, ownerId },
      include: sessionInclude,
    });
  });
  if (session === SESSION_EXPIRED) throw new AiPlanningSessionError('session_expired', 410);
  return serializeAiPlanningSession(session);
}

export async function cancelAiPlanningSession(
  ownerId: string,
  sessionId: string,
  options: PlanningOptions = {},
) {
  const prisma = prismaFrom(options);
  const now = nowFrom(options);
  const session = await prisma.$transaction(async (transaction) => {
    await ensureAndLockOwner(transaction, ownerId);
    const found = await findOwnedSession(transaction, ownerId, sessionId);
    if (await expireIfNeeded(transaction, found, now)) return SESSION_EXPIRED;
    if (found.status === 'APPLIED') {
      throw new AiPlanningSessionError('session_not_reviewable', 409);
    }
    if (found.status !== 'CANCELLED') {
      await transaction.aiGenerationRun.updateMany({
        where: { ownerId, result: 'PENDING', sessionId },
        data: { completedAt: now, result: 'CANCELLED' },
      });
      await transaction.aiPlanningSession.update({
        where: { id: sessionId },
        data: {
          draft: Prisma.DbNull,
          lastErrorCode: null,
          rawPrompt: null,
          stage: 'COMPLETE',
          status: 'CANCELLED',
          warningsAcknowledgedAt: null,
          warningsAcknowledgedRevision: null,
        },
      });
    }
    return transaction.aiPlanningSession.findFirstOrThrow({
      where: { id: sessionId, ownerId },
      include: sessionInclude,
    });
  });
  if (session === SESSION_EXPIRED) throw new AiPlanningSessionError('session_expired', 410);
  return serializeAiPlanningSession(session);
}

type ClaimDispatchResult = {
  baseDraftRevision: number;
  model: string;
  prompt: string;
  provider: string;
  runId: string;
  sessionId: string;
};

async function failRunInTransaction(
  transaction: PlanningTransaction,
  run: {
    baseDraftRevision: number;
    id: string;
    ownerId: string;
    session: { draft: Prisma.JsonValue | null; id: string; status: string };
  },
  code: AiGenerationErrorCode,
  now: Date,
  metadata: AiGenerationMetadata | null = null,
) {
  if (run.session.status === 'CANCELLED' || run.session.status === 'EXPIRED') return;
  await transaction.aiGenerationRun.updateMany({
    where: { id: run.id, ownerId: run.ownerId, result: 'PENDING' },
    data: {
      completedAt: now,
      errorCode: code === 'cancelled' ? null : code,
      inputTokens: metadata?.inputTokens ?? null,
      latencyMs: metadata?.latencyMs ?? null,
      model: metadata?.model,
      outputTokens: metadata?.outputTokens ?? null,
      provider: metadata?.provider,
      result: code === 'cancelled' ? 'CANCELLED' : 'FAILED',
      totalTokens: metadata?.totalTokens ?? null,
    },
  });
  const restoresDraft = run.baseDraftRevision > 0 && run.session.draft !== null;
  await transaction.aiPlanningSession.updateMany({
    where: {
      id: run.session.id,
      ownerId: run.ownerId,
      status: { in: ['GENERATING', 'PENDING'] },
    },
    data: {
      lastErrorCode: code,
      stage: restoresDraft ? 'REVIEWING' : 'COMPLETE',
      status: restoresDraft ? 'REVIEWING' : 'FAILED',
    },
  });
}

export async function claimAiPlanningDispatch(
  ownerId: string,
  runId: string,
  options: PlanningOptions = {},
): Promise<ClaimDispatchResult> {
  const prisma = prismaFrom(options);
  const now = nowFrom(options);
  const outcome = await prisma.$transaction(async (transaction) => {
    await ensureAndLockOwner(transaction, ownerId);
    const run = await transaction.aiGenerationRun.findFirst({
      where: { id: runId, ownerId },
      include: { session: true },
    });
    if (!run) throw new AiPlanningSessionError('session_not_found', 404);
    if (await expireIfNeeded(transaction, run.session, now)) {
      return { kind: 'expired' as const };
    }
    if (run.result !== 'PENDING' || run.dispatchedAt) {
      throw new AiPlanningSessionError('run_already_claimed', 409);
    }
    if (!['FAILED', 'PENDING', 'REVIEWING'].includes(run.session.status)) {
      throw new AiPlanningSessionError('session_not_reviewable', 409);
    }
    if (!run.session.rawPrompt) throw new AiPlanningSessionError('session_not_reviewable', 409);

    const configuration = getAiGenerationEnvironment(options.environment);
    if (configuration.status === 'unavailable') {
      await failRunInTransaction(transaction, run, configuration.code, now);
      return {
        code: configuration.code as AiPlanningSessionErrorCode,
        kind: 'unavailable' as const,
      };
    }

    const dispatchLimit = getAiPlanningDispatchLimit(options.environment);
    const cutoff = new Date(now.getTime() - AI_PLANNING_DISPATCH_WINDOW_MS);
    const dispatched = await transaction.aiGenerationRun.count({
      where: { dispatchedAt: { gt: cutoff }, ownerId },
    });
    if (dispatched >= dispatchLimit) {
      const oldest = await transaction.aiGenerationRun.findFirst({
        where: { dispatchedAt: { gt: cutoff }, ownerId },
        orderBy: { dispatchedAt: 'asc' },
        select: { dispatchedAt: true },
      });
      return {
        kind: 'quota' as const,
        retryAt: new Date((oldest?.dispatchedAt ?? now).getTime() + AI_PLANNING_DISPATCH_WINDOW_MS),
      };
    }

    const claimed = await transaction.aiGenerationRun.updateMany({
      where: { dispatchedAt: null, id: runId, ownerId, result: 'PENDING' },
      data: {
        dispatchedAt: now,
        model: configuration.vertex.model,
        provider: configuration.provider,
      },
    });
    if (claimed.count !== 1) throw new AiPlanningSessionError('run_already_claimed', 409);
    const activated = await transaction.aiPlanningSession.updateMany({
      where: {
        draftRevision: run.baseDraftRevision,
        expiresAt: { gt: now },
        id: run.sessionId,
        ownerId,
        status: { in: ['FAILED', 'PENDING', 'REVIEWING'] },
      },
      data: { lastErrorCode: null, stage: 'GENERATING', status: 'GENERATING' },
    });
    if (activated.count !== 1) throw new AiPlanningSessionError('draft_conflict', 409);
    return {
      kind: 'claimed' as const,
      value: {
        baseDraftRevision: run.baseDraftRevision,
        model: configuration.vertex.model,
        prompt: run.session.rawPrompt,
        provider: configuration.provider,
        runId,
        sessionId: run.sessionId,
      },
    };
  });

  if (outcome.kind === 'unavailable') {
    recordAiPlanningDispatchRejected(outcome.code as AiPlanningDispatchRejectionCode, now);
    throw new AiPlanningSessionError(outcome.code, 503);
  }
  if (outcome.kind === 'expired') throw new AiPlanningSessionError('session_expired', 410);
  if (outcome.kind === 'quota') {
    recordAiPlanningDispatchRejected('quota_exceeded', now);
    throw new AiPlanningSessionError('quota_exceeded', 429, outcome.retryAt);
  }
  return outcome.value;
}

export async function updateAiPlanningStage(
  ownerId: string,
  runId: string,
  stage: Exclude<(typeof DISPATCH_STAGES)[number], 'GENERATING'>,
  options: PlanningOptions = {},
) {
  const prisma = prismaFrom(options);
  const now = nowFrom(options);
  const outcome = await prisma.$transaction(async (transaction) => {
    await ensureAndLockOwner(transaction, ownerId);
    const run = await transaction.aiGenerationRun.findFirst({
      where: { id: runId, ownerId },
      include: { session: true },
    });
    if (!run) throw new AiPlanningSessionError('session_not_found', 404);
    if (await expireIfNeeded(transaction, run.session, now)) return SESSION_EXPIRED;
    if (run.result !== 'PENDING' || !run.dispatchedAt || run.session.status !== 'GENERATING') {
      throw new AiPlanningSessionError('run_already_claimed', 409);
    }
    const currentIndex = DISPATCH_STAGES.indexOf(
      run.session.stage as (typeof DISPATCH_STAGES)[number],
    );
    const nextIndex = DISPATCH_STAGES.indexOf(stage);
    if (nextIndex < currentIndex) throw new AiPlanningSessionError('draft_conflict', 409);
    if (nextIndex > currentIndex) {
      await transaction.aiPlanningSession.updateMany({
        where: { id: run.sessionId, ownerId, status: 'GENERATING' },
        data: { stage },
      });
    }
  });
  if (outcome === SESSION_EXPIRED) throw new AiPlanningSessionError('session_expired', 410);
}

export async function completeAiPlanningRunSuccess(
  ownerId: string,
  runId: string,
  draftInput: unknown,
  planScore: TripPlanScore,
  metadata: AiGenerationMetadata,
  options: PlanningOptions = {},
) {
  const validated = validateAiPlannerDraft(draftInput);
  if (!validated.success) throw new AiPlanningSessionError('draft_invalid', 400);
  const prisma = prismaFrom(options);
  const now = nowFrom(options);
  const outcome = await prisma.$transaction(async (transaction) => {
    await ensureAndLockOwner(transaction, ownerId);
    const run = await transaction.aiGenerationRun.findFirst({
      where: { id: runId, ownerId },
      include: { session: true },
    });
    if (!run) throw new AiPlanningSessionError('session_not_found', 404);
    if (await expireIfNeeded(transaction, run.session, now)) return SESSION_EXPIRED;
    if (
      run.result !== 'PENDING' ||
      !run.dispatchedAt ||
      run.session.status !== 'GENERATING' ||
      run.session.draftRevision !== run.baseDraftRevision
    ) {
      throw new AiPlanningSessionError('draft_conflict', 409);
    }
    const updated = await transaction.aiPlanningSession.updateMany({
      where: {
        draftRevision: run.baseDraftRevision,
        expiresAt: { gt: now },
        id: run.sessionId,
        ownerId,
        status: 'GENERATING',
      },
      data: {
        draft: validated.data as unknown as Prisma.InputJsonValue,
        draftRevision: { increment: 1 },
        lastErrorCode: null,
        planScore: planScore as unknown as Prisma.InputJsonValue,
        schemaVersion: AI_PLANNER_SCHEMA_VERSION,
        stage: 'REVIEWING',
        status: 'REVIEWING',
        warningsAcknowledgedAt: null,
        warningsAcknowledgedRevision: null,
      },
    });
    if (updated.count !== 1) throw new AiPlanningSessionError('draft_conflict', 409);
    const completed = await transaction.aiGenerationRun.updateMany({
      where: { id: runId, ownerId, result: 'PENDING' },
      data: {
        completedAt: now,
        inputTokens: metadata.inputTokens,
        latencyMs: metadata.latencyMs,
        model: metadata.model,
        outputTokens: metadata.outputTokens,
        provider: metadata.provider,
        result: 'SUCCEEDED',
        totalTokens: metadata.totalTokens,
      },
    });
    if (completed.count !== 1) throw new AiPlanningSessionError('draft_conflict', 409);
    return { draftRevision: run.baseDraftRevision + 1, sessionId: run.sessionId };
  });
  if (outcome === SESSION_EXPIRED) throw new AiPlanningSessionError('session_expired', 410);
  return outcome;
}

export async function completeAiPlanningRunFailure(
  ownerId: string,
  runId: string,
  code: AiGenerationErrorCode,
  metadata: AiGenerationMetadata | null,
  options: PlanningOptions = {},
) {
  const prisma = prismaFrom(options);
  const now = nowFrom(options);
  const outcome = await prisma.$transaction(async (transaction) => {
    await ensureAndLockOwner(transaction, ownerId);
    const run = await transaction.aiGenerationRun.findFirst({
      where: { id: runId, ownerId },
      include: { session: true },
    });
    if (!run) throw new AiPlanningSessionError('session_not_found', 404);
    if (run.result !== 'PENDING') return;
    if (await expireIfNeeded(transaction, run.session, now)) return SESSION_EXPIRED;
    if (run.session.status === 'CANCELLED' || run.session.status === 'EXPIRED') {
      await transaction.aiGenerationRun.updateMany({
        where: { id: runId, ownerId, result: 'PENDING' },
        data: { completedAt: now, result: 'CANCELLED' },
      });
      return;
    }
    await failRunInTransaction(transaction, run, code, now, metadata);
  });
  if (outcome === SESSION_EXPIRED) throw new AiPlanningSessionError('session_expired', 410);
}

export async function loadReviewableAiPlanningSessionForApply(
  ownerId: string,
  sessionId: string,
  expectedRevision: number,
  options: PlanningOptions = {},
) {
  const prisma = prismaFrom(options);
  const now = nowFrom(options);
  const outcome = await prisma.$transaction(async (transaction) => {
    return loadAiPlanningSessionForApplyInTransaction(
      transaction,
      ownerId,
      sessionId,
      expectedRevision,
      now,
    );
  });
  if (outcome === SESSION_EXPIRED) throw new AiPlanningSessionError('session_expired', 410);
  if (outcome.kind === 'applied') {
    throw new AiPlanningSessionError('session_not_reviewable', 409);
  }
  const { kind: _kind, ...reviewable } = outcome;
  return reviewable;
}

export async function loadAiPlanningSessionForApplyInTransaction(
  transaction: PlanningTransaction,
  ownerId: string,
  sessionId: string,
  expectedRevision: number,
  now: Date,
) {
  await ensureAndLockOwner(transaction, ownerId);
  const session = await findOwnedSession(transaction, ownerId, sessionId);

  // Applied is a terminal idempotent result. It remains recoverable after the
  // draft retention window because the content has already been scrubbed.
  if (session.appliedTripId) {
    return { kind: 'applied' as const, sessionId: session.id, tripId: session.appliedTripId };
  }

  if (await expireIfNeeded(transaction, session, now)) return SESSION_EXPIRED;
  if (
    session.status !== 'REVIEWING' ||
    session.draftRevision !== expectedRevision ||
    !session.draft
  ) {
    throw new AiPlanningSessionError('draft_conflict', 409);
  }

  return {
    draft: parseStoredDraft(session.draft),
    kind: 'reviewable' as const,
    sessionId: session.id,
    planScore: parseStoredPlanScore(session.planScore),
    tripDescription: session.tripDescription,
    tripName: session.tripName,
    warningAcknowledged:
      session.warningsAcknowledgedRevision === expectedRevision &&
      session.warningsAcknowledgedAt !== null,
  };
}
