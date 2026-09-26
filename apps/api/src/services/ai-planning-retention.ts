import { getPrismaClient, Prisma } from '@trove/db';

export const AI_PLANNING_SESSION_RETENTION_DAYS = 7;
export const AI_GENERATION_RUN_RETENTION_DAYS = 30;

const EXPIRABLE_SESSION_STATUSES = ['FAILED', 'GENERATING', 'PENDING', 'REVIEWING'] as const;
const CONTENT_FREE_SESSION_STATUSES = ['APPLIED', 'CANCELLED', 'EXPIRED'] as const;

export const AI_PLANNING_PRIVATE_CONTENT_WHERE: Prisma.AiPlanningSessionWhereInput = {
  OR: [
    { draft: { not: Prisma.DbNull } },
    { rawPrompt: { not: null } },
    { tripName: { not: null } },
    { tripDescription: { not: null } },
    { planScore: { not: Prisma.DbNull } },
    { warningsAcknowledgedAt: { not: null } },
    { warningsAcknowledgedRevision: { not: null } },
    { lastErrorCode: { not: null } },
  ],
};

export const AI_PLANNING_PRIVATE_CONTENT_SCRUB: Prisma.AiPlanningSessionUpdateManyMutationInput = {
  draft: Prisma.DbNull,
  rawPrompt: null,
  tripName: null,
  tripDescription: null,
  planScore: Prisma.DbNull,
  lastErrorCode: null,
  warningsAcknowledgedAt: null,
  warningsAcknowledgedRevision: null,
};

type TrovePrismaClient = ReturnType<typeof getPrismaClient>;

export type AiPlanningRetentionStore = {
  aiGenerationRun: Pick<TrovePrismaClient['aiGenerationRun'], 'deleteMany'>;
  aiPlanningSession: Pick<
    TrovePrismaClient['aiPlanningSession'],
    'count' | 'findFirst' | 'updateMany'
  >;
};

export type AiPlanningRetentionReport = {
  deletedGenerationRuns: number;
  expiredSessions: number;
  scrubbedTerminalSessions: number;
  overdueSessionsAtStart: number;
  oldestOverdueAgeSeconds: number | null;
  remainingOverdueSessions: number;
};

export function aiGenerationRunCutoff(now: Date) {
  return new Date(now.getTime() - AI_GENERATION_RUN_RETENTION_DAYS * 24 * 60 * 60 * 1_000);
}

/**
 * Idempotently enforces the content-retention boundaries from PRD 7.6.5.
 *
 * Scheduling belongs to deployment operations; keeping the work in one small
 * service lets a cron, worker, or guarded maintenance command invoke the same
 * behavior without duplicating sensitive-data rules.
 */
export async function cleanupAiPlanningRetention(
  options: { now?: Date; prisma?: AiPlanningRetentionStore } = {},
): Promise<AiPlanningRetentionReport> {
  const now = options.now ?? new Date();
  const prisma = options.prisma ?? getPrismaClient();

  const overdueWhere: Prisma.AiPlanningSessionWhereInput = {
    expiresAt: { lte: now },
    ...AI_PLANNING_PRIVATE_CONTENT_WHERE,
  };
  const [overdueSessionsAtStart, oldestOverdue] = await Promise.all([
    prisma.aiPlanningSession.count({ where: overdueWhere }),
    prisma.aiPlanningSession.findFirst({
      where: overdueWhere,
      orderBy: { expiresAt: 'asc' },
      select: { expiresAt: true },
    }),
  ]);

  const [expiredSessions, scrubbedTerminalSessions, deletedGenerationRuns] = await Promise.all([
    prisma.aiPlanningSession.updateMany({
      where: {
        expiresAt: { lte: now },
        status: { in: [...EXPIRABLE_SESSION_STATUSES] },
      },
      data: { ...AI_PLANNING_PRIVATE_CONTENT_SCRUB, stage: 'COMPLETE', status: 'EXPIRED' },
    }),
    prisma.aiPlanningSession.updateMany({
      where: {
        ...AI_PLANNING_PRIVATE_CONTENT_WHERE,
        status: { in: [...CONTENT_FREE_SESSION_STATUSES] },
      },
      data: AI_PLANNING_PRIVATE_CONTENT_SCRUB,
    }),
    prisma.aiGenerationRun.deleteMany({
      where: { createdAt: { lte: aiGenerationRunCutoff(now) } },
    }),
  ]);
  const remainingOverdueSessions = await prisma.aiPlanningSession.count({ where: overdueWhere });

  return {
    deletedGenerationRuns: deletedGenerationRuns.count,
    expiredSessions: expiredSessions.count,
    scrubbedTerminalSessions: scrubbedTerminalSessions.count,
    overdueSessionsAtStart,
    oldestOverdueAgeSeconds: oldestOverdue
      ? Math.max(0, Math.floor((now.getTime() - oldestOverdue.expiresAt.getTime()) / 1_000))
      : null,
    remainingOverdueSessions,
  };
}
