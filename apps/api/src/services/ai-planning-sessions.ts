import { singleFlight } from './single-flight.js';
import { arePlanScoreProvidersDisabled } from '../environment.js';
import { getPrismaClient, Prisma } from '@trove/db';
import { AI_PLANNER_SCHEMA_VERSION } from '@trove/types';

import {
  DEFAULT_AI_MODEL,
  DEFAULT_AI_PROVIDER,
  getAiGenerationEnvironment,
} from '../environment.js';
import type { AiGenerationErrorCode, AiGenerationMetadata } from './ai-generation.js';
import {
  AI_PLANNING_PRIVATE_CONTENT_SCRUB,
  AI_PLANNING_PRIVATE_CONTENT_WHERE,
} from './ai-planning-retention.js';
import { validateAiPlannerDraft } from './ai-planning-rules.js';
import {
  countryCorrectionChangesTimeContext,
  normalizeReviewedCountries,
  suggestedDraftCountries,
  suggestedDraftCountriesFromStoredPlaces,
} from './ai-planning-countries.js';
import { readDraftPlanScore } from './ai-draft-score-reader.js';
import { originalPlanScoreTime } from './plan-score-freshness.js';
import { draftPlanScoreInputRevision } from './ai-planning-plan-score.js';
import { draftTripContext } from './trip-context.js';
import {
  parseStoredPlanScore,
  withholdNonCurrentPlanScore,
  type TripPlanScore,
} from './plan-score.js';
import {
  recordAiPlanningDispatchRejected,
  type AiPlanningDispatchRejectionCode,
} from './ai-planning-telemetry.js';

import {
  lockAiCreditOwner,
  getAiCreditSnapshot,
  resolveAiCreditPeriod,
  reserveAiCredit,
  settleAiCredit,
} from './ai-planner-credits.js';
import { EntitlementError } from './plan-entitlements.js';
import { checkAiPlannerPromptDays } from './ai-planner-preflight.js';
import type { AiPlannerEntitlementSnapshot } from '@trove/types';

export const AI_PLANNING_PROMPT_MAX_LENGTH = 10_000;
export const AI_PLANNING_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

const ACTIVE_STATUSES = ['FAILED', 'GENERATING', 'PENDING', 'REVIEWING'] as const;
/**
 * Ordered, and `updateAiPlanningStage` rejects any move backwards through it, so
 * this sequence has to match the pipeline's. The pipeline schedules before it
 * grounds: a run only looks up the places its finished itinerary stands on.
 */
const DISPATCH_STAGES = ['GENERATING', 'SCHEDULING', 'GROUNDING', 'VALIDATING'] as const;
const SESSION_EXPIRED = Symbol('session_expired');
const RUN_OVERDUE = Symbol('run_overdue');

type PlanningPrisma = ReturnType<typeof getPrismaClient>;
type PlanningTransaction = Prisma.TransactionClient;
type PlanningOptions = {
  environment?: Record<string, string | undefined>;
  now?: () => Date;
  prisma?: PlanningPrisma;
};

type PendingRun = { deadlineAt: Date | null; id: string };
type SessionRecord = {
  appliedTripId: string | null;
  createdAt: Date;
  draft: Prisma.JsonValue | null;
  draftRevision: number;
  draftMaxDays?: number;
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
  reviewedCountries: string[];
  countriesReviewedRevision: number | null;
  countryContextChanged: boolean;
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
  | 'invalid_countries'
  | 'countries_not_reviewed'
  | 'place_unresolved'
  | 'provider_unavailable'
  | 'invalid_prompt'
  | 'quota_exceeded'
  | 'itinerary_day_limit_exceeded'
  | 'rate_limited'
  | 'regenerate_required'
  | 'run_already_claimed'
  | 'schedule_conflict'
  | 'session_busy'
  | 'session_expired'
  | 'session_not_found'
  | 'session_not_reviewable'
  | 'warnings_not_acknowledged';

export type AiPlanningAvailability = Partial<AiPlannerEntitlementSnapshot> & {
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

/** Advisory display; transactional dispatch remains authoritative. */
export async function getAiPlanningAvailability(
  ownerId: string,
  options: PlanningOptions = {},
): Promise<AiPlanningAvailability> {
  const configuration = getAiGenerationEnvironment(options.environment);
  if (configuration.status === 'unavailable')
    return {
      code: configuration.code,
      remainingDispatches: null,
      retryAt: null,
      status: 'unavailable',
    };
  try {
    const snapshot = await getAiCreditSnapshot(ownerId, {
      prisma: prismaFrom(options),
      now: nowFrom(options),
      environment: options.environment,
    });
    return {
      ...snapshot,
      code: null,
      remainingDispatches: snapshot.availableCredits,
      retryAt:
        snapshot.availableCredits <= 0 && snapshot.nextRenewalAt
          ? new Date(snapshot.nextRenewalAt)
          : null,
      status: snapshot.availableCredits > 0 ? 'available' : 'quota_exhausted',
    };
  } catch (error) {
    if (!(error instanceof EntitlementError) || error.code !== 'configuration_invalid') throw error;
    return { code: error.code, remainingDispatches: null, retryAt: null, status: 'unavailable' };
  }
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
    select: { deadlineAt: true, id: true },
    take: 1,
    where: { result: 'PENDING' as const },
  },
} as const;

export function serializeAiPlanningSession(session: SessionRecord, now = new Date()) {
  const terminal = ['APPLIED', 'CANCELLED', 'EXPIRED'].includes(session.status);
  const draft =
    terminal || !session.draft
      ? null
      : validateAiPlannerDraft(session.draft, { maxItineraryDays: session.draftMaxDays });
  const timingConflict =
    draft && !draft.success && draft.issues.some((issue) => issue.code === 'overlapping_items');
  const readableDraft = timingConflict
    ? validateAiPlannerDraft(session.draft, {
        allowExactTimeOverlaps: true,
        maxItineraryDays: session.draftMaxDays,
      })
    : draft;
  const planScore = parseStoredPlanScore(session.planScore);
  return {
    appliedTripId: session.appliedTripId,
    createdAt: session.createdAt.toISOString(),
    draft: terminal ? null : session.draft,
    draftRevision: session.draftRevision,
    deadlineAt: terminal ? null : (session.runs[0]?.deadlineAt?.toISOString() ?? null),
    expiresAt: session.expiresAt.toISOString(),
    id: session.id,
    lastSafeError: terminal ? null : timingConflict ? 'schedule_conflict' : session.lastErrorCode,
    pendingRunId: terminal ? null : (session.runs[0]?.id ?? null),
    planScore:
      terminal || arePlanScoreProvidersDisabled() || session.countryContextChanged || timingConflict
        ? null
        : planScore
          ? withholdNonCurrentPlanScore(planScore, now)
          : null,
    countryContextChanged: terminal ? false : session.countryContextChanged,
    countriesReviewedRevision: terminal ? null : session.countriesReviewedRevision,
    reviewedCountries: terminal ? [] : session.reviewedCountries,
    suggestedCountries: readableDraft?.success ? suggestedDraftCountries(readableDraft.data) : [],
    prompt: terminal ? null : session.rawPrompt,
    schemaVersion: session.schemaVersion,
    stage: session.stage.toLowerCase(),
    status: session.status.toLowerCase(),
    tripDescription: terminal ? null : session.tripDescription,
    tripName: terminal ? null : session.tripName,
    updatedAt: session.updatedAt.toISOString(),
    warningAcknowledgement:
      terminal || session.warningsAcknowledgedRevision === null || !session.warningsAcknowledgedAt
        ? null
        : {
            acknowledgedAt: session.warningsAcknowledgedAt.toISOString(),
            revision: session.warningsAcknowledgedRevision,
          },
  };
}

async function serializeAiPlanningSessionWithCountries(
  session: SessionRecord,
  prisma: PlanningPrisma,
  now: Date,
  clock: () => Date = () => now,
) {
  let current = session;
  if (
    session.status === 'REVIEWING' &&
    !session.countryContextChanged &&
    !arePlanScoreProvidersDisabled()
  ) {
    const retained = validateAiPlannerDraft(session.draft, {
      maxItineraryDays: session.draftMaxDays,
    });
    const cached = parseStoredPlanScore(session.planScore);
    if (
      retained.success &&
      (!cached ||
        !originalPlanScoreTime(cached, now) ||
        cached.sourceInputRevision !== draftPlanScoreInputRevision(retained.data))
    ) {
      const score = await singleFlight(
        `draft-score:${session.id}:${session.draftRevision}:${session.updatedAt.toISOString()}:${session.reviewedCountries.join(',')}:${draftPlanScoreInputRevision(retained.data)}`,
        () => readDraftPlanScore(retained.data, clock),
      );
      const completedAt = clock();
      if (completedAt >= session.expiresAt)
        throw new AiPlanningSessionError('session_expired', 410);
      // Do not overwrite a concurrent regeneration/edit. No generation request is dispatched here.
      const updated = await prisma.aiPlanningSession.updateMany({
        where: {
          id: session.id,
          ownerId: session.ownerId,
          draftRevision: session.draftRevision,
          status: 'REVIEWING',
          countryContextChanged: false,
          expiresAt: { gt: completedAt },
          updatedAt: session.updatedAt,
        },
        data: { planScore: score as unknown as Prisma.InputJsonValue },
      });
      current =
        updated.count === 1
          ? { ...session, planScore: score as unknown as Prisma.JsonValue }
          : await findOwnedSession(prisma, session.ownerId, session.id);
    }
  }
  const serializedAt = clock();
  if (serializedAt >= session.expiresAt) throw new AiPlanningSessionError('session_expired', 410);
  const serialized = serializeAiPlanningSession(current, serializedAt);
  if (!serialized.draft || !['REVIEWING', 'FAILED'].includes(current.status)) {
    return serialized;
  }
  const draft = validateAiPlannerDraft(serialized.draft, {
    allowExactTimeOverlaps: true,
    maxItineraryDays: session.draftMaxDays,
  });
  if (!draft.success) return serialized;
  return {
    ...serialized,
    context:
      current.status === 'REVIEWING'
        ? await draftTripContext(draft.data, current.reviewedCountries, serializedAt)
        : null,
    suggestedCountries: await suggestedDraftCountriesFromStoredPlaces(draft.data, prisma),
  };
}

/** Review metadata is separate from the immutable draft and generation quota. */
export async function setAiPlanningCountries(
  ownerId: string,
  sessionId: string,
  countriesInput: readonly string[],
  expectedRevision: number,
  options: PlanningOptions = {},
) {
  const countries = normalizeReviewedCountries(countriesInput);
  if (!countries) throw new AiPlanningSessionError('invalid_countries', 400);
  const prisma = prismaFrom(options);
  const now = nowFrom(options);
  const session = await prisma.$transaction(async (transaction) => {
    await ensureAndLockOwner(transaction, ownerId);
    const found = await findOwnedSession(transaction, ownerId, sessionId);
    if (await expireIfNeeded(transaction, found, now)) return SESSION_EXPIRED;
    if (found.status !== 'REVIEWING' || !found.draft) {
      throw new AiPlanningSessionError('session_not_reviewable', 409);
    }
    if (found.draftRevision !== expectedRevision) {
      throw new AiPlanningSessionError('draft_conflict', 409);
    }
    const draft = parseStoredDraft(found.draft, true, found.draftMaxDays);
    const countryContextChanged = await countryCorrectionChangesTimeContext(
      transaction,
      ownerId,
      draft,
      countries,
    );
    const changed = found.reviewedCountries.join(',') !== countries.join(',');
    const clearAcknowledgement =
      countryContextChanged &&
      (changed ||
        !found.countryContextChanged ||
        found.countriesReviewedRevision !== expectedRevision);
    await transaction.aiPlanningSession.updateMany({
      where: { draftRevision: expectedRevision, id: sessionId, ownerId, status: 'REVIEWING' },
      data: {
        reviewedCountries: countries,
        countriesReviewedRevision: expectedRevision,
        countryContextChanged,
        ...(clearAcknowledgement
          ? {
              warningsAcknowledgedAt: null,
              warningsAcknowledgedRevision: null,
            }
          : {}),
      },
    });
    return transaction.aiPlanningSession.findFirstOrThrow({
      where: { id: sessionId, ownerId },
      include: sessionInclude,
    });
  });
  if (session === SESSION_EXPIRED) throw new AiPlanningSessionError('session_expired', 410);
  return serializeAiPlanningSessionWithCountries(session, prisma, now);
}

async function ensureAndLockOwner(transaction: PlanningTransaction, ownerId: string) {
  await lockAiCreditOwner(transaction, ownerId);
}

async function scrubExpiredSession(
  transaction: PlanningTransaction,
  ownerId: string,
  sessionId: string,
  now: Date,
) {
  const expired = await transaction.aiPlanningSession.updateMany({
    where: {
      id: sessionId,
      ownerId,
      expiresAt: { lte: now },
      status: { in: [...ACTIVE_STATUSES] },
    },
    data: {
      ...AI_PLANNING_PRIVATE_CONTENT_SCRUB,
      stage: 'COMPLETE',
      status: 'EXPIRED',
    },
  });
  if (expired.count !== 1) return false;
  const expiring = await transaction.aiGenerationRun.findMany({
    where: { ownerId, result: 'PENDING', sessionId },
    select: { id: true },
  });
  for (const run of expiring)
    await settleAiCredit(transaction, ownerId, run.id, false, 'session_expired', now);
  await transaction.aiGenerationRun.updateMany({
    where: { ownerId, result: 'PENDING', sessionId },
    data: { completedAt: now, result: 'CANCELLED' },
  });
  return true;
}

async function expireIfNeeded(
  transaction: PlanningTransaction,
  session: { expiresAt: Date; id: string; ownerId: string; status: string },
  now: Date,
) {
  if (session.status === 'EXPIRED') {
    await transaction.aiPlanningSession.updateMany({
      where: { id: session.id, ownerId: session.ownerId, ...AI_PLANNING_PRIVATE_CONTENT_WHERE },
      data: AI_PLANNING_PRIVATE_CONTENT_SCRUB,
    });
    return true;
  }
  if (session.status === 'APPLIED' || session.status === 'CANCELLED') {
    await transaction.aiPlanningSession.updateMany({
      where: { id: session.id, ownerId: session.ownerId, ...AI_PLANNING_PRIVATE_CONTENT_WHERE },
      data: AI_PLANNING_PRIVATE_CONTENT_SCRUB,
    });
    return session.expiresAt <= now;
  }
  if (session.expiresAt > now) return false;
  await scrubExpiredSession(transaction, session.ownerId, session.id, now);
  // A concurrent maintenance sweep can win the conditional update. The
  // previously loaded row is still expired and must never be serialized.
  return true;
}

async function failOverdueRun(
  transaction: PlanningTransaction,
  session: {
    draft: Prisma.JsonValue | null;
    id: string;
    ownerId: string;
    stage: string;
    status: string;
  },
  now: Date,
) {
  if (session.status !== 'GENERATING') return false;
  const run = await transaction.aiGenerationRun.findFirst({
    where: {
      deadlineAt: { lte: now },
      ownerId: session.ownerId,
      result: 'PENDING',
      sessionId: session.id,
    },
    select: { deadlineAt: true, dispatchedAt: true, id: true },
  });
  if (!run) return false;
  const stopped = await transaction.aiGenerationRun.updateMany({
    where: { deadlineAt: { lte: now }, id: run.id, ownerId: session.ownerId, result: 'PENDING' },
    data: {
      completedAt: now,
      errorCode: 'timeout',
      failureStage: session.stage.toLowerCase(),
      result: 'FAILED',
      totalLatencyMs: run.dispatchedAt
        ? Math.max(0, now.getTime() - run.dispatchedAt.getTime())
        : null,
    },
  });
  if (stopped.count !== 1) return false;
  await settleAiCredit(transaction, session.ownerId, run.id, false, 'timeout', now);
  const restoresDraft = session.draft !== null;
  await transaction.aiPlanningSession.updateMany({
    where: { id: session.id, ownerId: session.ownerId, status: 'GENERATING' },
    data: {
      lastErrorCode: 'timeout',
      stage: restoresDraft ? 'REVIEWING' : 'COMPLETE',
      status: restoresDraft ? 'REVIEWING' : 'FAILED',
    },
  });
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
    const existing =
      (await transaction.aiCreditAction.findUnique({
        where: { ownerId_idempotencyKey: { idempotencyKey, ownerId } },
        select: { sessionId: true },
      })) ??
      (await transaction.aiGenerationRun.findUnique({
        where: { ownerId_idempotencyKey: { idempotencyKey, ownerId } },
        select: { sessionId: true },
      }));
    if (existing) {
      const replay = await transaction.aiPlanningSession.findFirstOrThrow({
        where: { id: existing.sessionId, ownerId },
        include: sessionInclude,
      });
      if (await expireIfNeeded(transaction, replay, now)) return SESSION_EXPIRED;
      return replay;
    }

    const entitlement = await resolveAiCreditPeriod(transaction, ownerId, now, options.environment);
    checkAiPlannerPromptDays(prompt, entitlement.limits.maxItineraryDays);

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

  if (session === SESSION_EXPIRED) throw new AiPlanningSessionError('session_expired', 410);
  return serializeAiPlanningSessionWithCountries(session, prisma, now);
}

async function expireOwnedSessions(prisma: PlanningPrisma, ownerId: string, now: Date) {
  await prisma.$transaction(async (transaction) => {
    const active = await transaction.aiPlanningSession.findMany({
      where: { ownerId, status: 'GENERATING' },
      select: { draft: true, id: true, ownerId: true, stage: true, status: true },
    });
    for (const session of active) await failOverdueRun(transaction, session, now);
    const expired = await transaction.aiPlanningSession.findMany({
      where: { expiresAt: { lte: now }, ownerId, status: { in: [...ACTIVE_STATUSES] } },
      select: { id: true },
    });
    for (const session of expired) {
      await scrubExpiredSession(transaction, ownerId, session.id, now);
    }
    await transaction.aiPlanningSession.updateMany({
      where: {
        ownerId,
        status: { in: ['APPLIED', 'CANCELLED', 'EXPIRED'] },
        ...AI_PLANNING_PRIVATE_CONTENT_WHERE,
      },
      data: AI_PLANNING_PRIVATE_CONTENT_SCRUB,
    });
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
  return session
    ? serializeAiPlanningSessionWithCountries(
        session,
        prisma,
        now,
        options.now ?? (() => new Date()),
      )
    : null;
}

export async function getAiPlanningSession(
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
    if (await failOverdueRun(transaction, found, now)) {
      return findOwnedSession(transaction, ownerId, sessionId);
    }
    return found;
  });
  if (session === SESSION_EXPIRED) throw new AiPlanningSessionError('session_expired', 410);
  return serializeAiPlanningSessionWithCountries(
    session,
    prisma,
    now,
    options.now ?? (() => new Date()),
  );
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
    let found = await findOwnedSession(transaction, ownerId, sessionId);
    if (await expireIfNeeded(transaction, found, now)) return SESSION_EXPIRED;
    if (await failOverdueRun(transaction, found, now)) {
      found = await findOwnedSession(transaction, ownerId, sessionId);
    }
    const existing =
      (await transaction.aiCreditAction.findUnique({
        where: { ownerId_idempotencyKey: { idempotencyKey, ownerId } },
        select: { sessionId: true },
      })) ??
      (await transaction.aiGenerationRun.findUnique({
        where: { ownerId_idempotencyKey: { idempotencyKey, ownerId } },
        select: { sessionId: true },
      }));
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

    const entitlement = await resolveAiCreditPeriod(transaction, ownerId, now, options.environment);
    checkAiPlannerPromptDays(prompt, entitlement.limits.maxItineraryDays);

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
  return serializeAiPlanningSessionWithCountries(session, prisma, now);
}

function parseStoredDraft(
  value: Prisma.JsonValue | null,
  allowExactTimeOverlaps = false,
  maxItineraryDays?: number,
) {
  const validated = validateAiPlannerDraft(value, { allowExactTimeOverlaps, maxItineraryDays });
  if (!validated.success) {
    const timingConflict = validated.issues.some((issue) =>
      ['overlapping_items', 'conflicting_hard_constraints'].includes(issue.code),
    );
    throw new AiPlanningSessionError(timingConflict ? 'schedule_conflict' : 'draft_invalid', 400);
  }
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
  return serializeAiPlanningSessionWithCountries(session, prisma, now);
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
  return serializeAiPlanningSessionWithCountries(session, prisma, now);
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
  return serializeAiPlanningSessionWithCountries(session, prisma, now);
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
      const cancelledRuns = await transaction.aiGenerationRun.findMany({
        where: { ownerId, result: 'PENDING', sessionId },
        select: { id: true, dispatchedAt: true },
      });
      for (const run of cancelledRuns)
        await settleAiCredit(
          transaction,
          ownerId,
          run.id,
          run.dispatchedAt !== null,
          'user_cancelled',
          now,
        );
      await transaction.aiGenerationRun.updateMany({
        where: { ownerId, result: 'PENDING', sessionId },
        data: { completedAt: now, result: 'CANCELLED' },
      });
      await transaction.aiPlanningSession.update({
        where: { id: sessionId },
        data: {
          ...AI_PLANNING_PRIVATE_CONTENT_SCRUB,
          stage: 'COMPLETE',
          status: 'CANCELLED',
        },
      });
    }
    return transaction.aiPlanningSession.findFirstOrThrow({
      where: { id: sessionId, ownerId },
      include: sessionInclude,
    });
  });
  if (session === SESSION_EXPIRED) throw new AiPlanningSessionError('session_expired', 410);
  return serializeAiPlanningSessionWithCountries(session, prisma, now);
}

type ClaimDispatchResult = {
  maxItineraryDays: number;
  baseDraftRevision: number;
  deadlineAt: Date;
  model: string;
  prompt: string;
  provider: string;
  runId: string;
  sessionId: string;
};

export type AiRunFailureDetails = {
  stage: string;
  validationCodes?: string[];
  validationPaths?: string[];
};

async function failRunInTransaction(
  transaction: PlanningTransaction,
  run: {
    baseDraftRevision: number;
    dispatchedAt: Date | null;
    id: string;
    ownerId: string;
    session: { draft: Prisma.JsonValue | null; id: string; status: string };
  },
  code: AiGenerationErrorCode | EntitlementError['code'],
  now: Date,
  metadata: AiGenerationMetadata | null = null,
  details: AiRunFailureDetails | null = null,
) {
  if (run.session.status === 'CANCELLED' || run.session.status === 'EXPIRED') return;
  await transaction.aiGenerationRun.updateMany({
    where: { id: run.id, ownerId: run.ownerId, result: 'PENDING' },
    data: {
      completedAt: now,
      errorCode: code === 'cancelled' ? null : code,
      failureStage: details?.stage ?? null,
      finishReason: metadata?.finishReason ?? null,
      inputTokens: metadata?.inputTokens ?? null,
      latencyMs: metadata?.latencyMs ?? null,
      model: metadata?.model,
      outputTokens: metadata?.outputTokens ?? null,
      provider: metadata?.provider,
      reasoningTokens: metadata?.reasoningTokens ?? null,
      result: code === 'cancelled' ? 'CANCELLED' : 'FAILED',
      totalTokens: metadata?.totalTokens ?? null,
      totalLatencyMs: run.dispatchedAt
        ? Math.max(0, now.getTime() - run.dispatchedAt.getTime())
        : null,
      validationCodes: details?.validationCodes?.slice(0, 12) ?? [],
      validationPaths: details?.validationPaths?.slice(0, 12) ?? [],
    },
  });
  await settleAiCredit(transaction, run.ownerId, run.id, false, code, now);
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
  let now = nowFrom(options);
  const outcome = await prisma.$transaction(async (transaction) => {
    await ensureAndLockOwner(transaction, ownerId);
    now = nowFrom(options);
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

    const deadlineAt = new Date(now.getTime() + configuration.timeoutMs + 30_000);
    let maxItineraryDays: number;
    try {
      const entitlement = await resolveAiCreditPeriod(
        transaction,
        ownerId,
        now,
        options.environment,
      );
      checkAiPlannerPromptDays(run.session.rawPrompt, entitlement.limits.maxItineraryDays);
      maxItineraryDays = await reserveAiCredit(
        transaction,
        run,
        deadlineAt,
        now,
        options.environment,
      );
    } catch (error) {
      if (!(error instanceof EntitlementError)) throw error;
      // A rejected dispatch must leave a recoverable failure, not a forever-pending session.
      await failRunInTransaction(transaction, run, error.code, now);
      return { kind: 'rejected' as const, error };
    }
    const claimed = await transaction.aiGenerationRun.updateMany({
      where: { dispatchedAt: null, id: runId, ownerId, result: 'PENDING' },
      data: {
        deadlineAt,
        dispatchedAt: now,
        maxItineraryDays,
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
        maxItineraryDays,
        deadlineAt,
        model: configuration.vertex.model,
        prompt: run.session.rawPrompt,
        provider: configuration.provider,
        runId,
        sessionId: run.sessionId,
      },
    };
  });

  if (outcome.kind === 'rejected') {
    recordAiPlanningDispatchRejected(outcome.error.code as AiPlanningDispatchRejectionCode, now);
    throw outcome.error;
  }
  if (outcome.kind === 'unavailable') {
    recordAiPlanningDispatchRejected(outcome.code as AiPlanningDispatchRejectionCode, now);
    throw new AiPlanningSessionError(outcome.code, 503);
  }
  if (outcome.kind === 'expired') throw new AiPlanningSessionError('session_expired', 410);
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
    if (run.deadlineAt && run.deadlineAt <= now) {
      await failOverdueRun(transaction, run.session, now);
      return RUN_OVERDUE;
    }
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
  if (outcome === RUN_OVERDUE) throw new AiPlanningSessionError('draft_conflict', 409);
}

export async function completeAiPlanningRunSuccess(
  ownerId: string,
  runId: string,
  draftInput: unknown,
  planScore: TripPlanScore,
  metadata: AiGenerationMetadata,
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
    if (run.deadlineAt && run.deadlineAt <= now) {
      await failOverdueRun(transaction, run.session, now);
      return RUN_OVERDUE;
    }
    if (
      run.result !== 'PENDING' ||
      !run.dispatchedAt ||
      run.session.status !== 'GENERATING' ||
      run.session.draftRevision !== run.baseDraftRevision
    ) {
      throw new AiPlanningSessionError('draft_conflict', 409);
    }
    const validated = validateAiPlannerDraft(draftInput, {
      maxItineraryDays: run.maxItineraryDays ?? run.session.draftMaxDays,
    });
    if (!validated.success) throw new AiPlanningSessionError('draft_invalid', 400);
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
        draftMaxDays: run.maxItineraryDays ?? run.session.draftMaxDays,
        reviewedCountries: [],
        countriesReviewedRevision: null,
        countryContextChanged: false,
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
        finishReason: metadata.finishReason ?? null,
        inputTokens: metadata.inputTokens,
        latencyMs: metadata.latencyMs,
        model: metadata.model,
        outputTokens: metadata.outputTokens,
        provider: metadata.provider,
        reasoningTokens: metadata.reasoningTokens ?? null,
        result: 'SUCCEEDED',
        totalTokens: metadata.totalTokens,
        totalLatencyMs: Math.max(0, now.getTime() - run.dispatchedAt.getTime()),
      },
    });
    if (completed.count !== 1) throw new AiPlanningSessionError('draft_conflict', 409);
    await settleAiCredit(transaction, ownerId, runId, true, 'valid_draft', now);
    return { draftRevision: run.baseDraftRevision + 1, sessionId: run.sessionId };
  });
  if (outcome === SESSION_EXPIRED) throw new AiPlanningSessionError('session_expired', 410);
  if (outcome === RUN_OVERDUE) throw new AiPlanningSessionError('draft_conflict', 409);
  return outcome;
}

export async function completeAiPlanningRunFailure(
  ownerId: string,
  runId: string,
  code: AiGenerationErrorCode,
  metadata: AiGenerationMetadata | null,
  options: PlanningOptions = {},
  details: AiRunFailureDetails | null = null,
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
    if (run.deadlineAt && run.deadlineAt <= now) {
      await failOverdueRun(transaction, run.session, now);
      return;
    }
    if (run.session.status === 'CANCELLED' || run.session.status === 'EXPIRED') {
      await transaction.aiGenerationRun.updateMany({
        where: { id: runId, ownerId, result: 'PENDING' },
        data: { completedAt: now, result: 'CANCELLED' },
      });
      return;
    }
    await failRunInTransaction(transaction, run, code, now, metadata, details);
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
  // draft retention window; old rows are scrubbed before returning that reference.
  if (session.appliedTripId) {
    await transaction.aiPlanningSession.updateMany({
      where: { id: session.id, ownerId, ...AI_PLANNING_PRIVATE_CONTENT_WHERE },
      data: AI_PLANNING_PRIVATE_CONTENT_SCRUB,
    });
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
    draft: parseStoredDraft(session.draft, false, session.draftMaxDays),
    kind: 'reviewable' as const,
    sessionId: session.id,
    planScore: session.countryContextChanged ? null : parseStoredPlanScore(session.planScore),
    reviewedCountries: session.reviewedCountries,
    countriesReviewed: session.countriesReviewedRevision === expectedRevision,
    countryContextChanged: session.countryContextChanged,
    tripDescription: session.tripDescription,
    tripName: session.tripName,
  };
}
