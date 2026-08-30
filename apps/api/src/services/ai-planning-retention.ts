import { getPrismaClient, Prisma } from '@trove/db';

export const AI_PLANNING_SESSION_RETENTION_DAYS = 7;
export const AI_GENERATION_RUN_RETENTION_DAYS = 30;

const EXPIRABLE_SESSION_STATUSES = ['FAILED', 'GENERATING', 'PENDING', 'REVIEWING'] as const;
const CONTENT_FREE_SESSION_STATUSES = ['APPLIED', 'CANCELLED', 'EXPIRED'] as const;

type TrovePrismaClient = ReturnType<typeof getPrismaClient>;

export type AiPlanningRetentionStore = {
  aiGenerationRun: Pick<TrovePrismaClient['aiGenerationRun'], 'deleteMany'>;
  aiPlanningSession: Pick<TrovePrismaClient['aiPlanningSession'], 'updateMany'>;
};

export type AiPlanningRetentionReport = {
  deletedGenerationRuns: number;
  expiredSessions: number;
  scrubbedTerminalSessions: number;
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

  const [expiredSessions, scrubbedTerminalSessions, deletedGenerationRuns] = await Promise.all([
    prisma.aiPlanningSession.updateMany({
      where: {
        expiresAt: { lte: now },
        status: { in: [...EXPIRABLE_SESSION_STATUSES] },
      },
      data: {
        draft: Prisma.DbNull,
        rawPrompt: null,
        stage: 'COMPLETE',
        status: 'EXPIRED',
      },
    }),
    prisma.aiPlanningSession.updateMany({
      where: {
        OR: [{ draft: { not: Prisma.DbNull } }, { rawPrompt: { not: null } }],
        status: { in: [...CONTENT_FREE_SESSION_STATUSES] },
      },
      data: { draft: Prisma.DbNull, rawPrompt: null },
    }),
    prisma.aiGenerationRun.deleteMany({
      where: { createdAt: { lte: aiGenerationRunCutoff(now) } },
    }),
  ]);

  return {
    deletedGenerationRuns: deletedGenerationRuns.count,
    expiredSessions: expiredSessions.count,
    scrubbedTerminalSessions: scrubbedTerminalSessions.count,
  };
}
