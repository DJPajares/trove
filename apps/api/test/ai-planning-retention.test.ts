import { expect, test, vi } from 'vitest';

import {
  AI_GENERATION_RUN_RETENTION_DAYS,
  AI_PLANNING_SESSION_RETENTION_DAYS,
  aiGenerationRunCutoff,
  cleanupAiPlanningRetention,
  type AiPlanningRetentionStore,
} from '../src/services/ai-planning-retention.js';
import { AI_PLANNING_SESSION_TTL_MS } from '../src/services/ai-planning-sessions.js';

test('calculates the generation-run boundary as a rolling 30-day cutoff', () => {
  const now = new Date('2026-08-30T12:00:00.000Z');

  expect(aiGenerationRunCutoff(now)).toEqual(
    new Date(now.getTime() - AI_GENERATION_RUN_RETENTION_DAYS * 24 * 60 * 60 * 1_000),
  );
});

test('expires active sessions, scrubs terminal content, and deletes old content-free runs', async () => {
  const updateMany = vi
    .fn()
    .mockResolvedValueOnce({ count: 2 })
    .mockResolvedValueOnce({ count: 1 });
  const deleteMany = vi.fn().mockResolvedValue({ count: 4 });
  const prisma = {
    aiGenerationRun: { deleteMany },
    aiPlanningSession: { updateMany },
  } as unknown as AiPlanningRetentionStore;
  const now = new Date('2026-08-30T12:00:00.000Z');

  await expect(cleanupAiPlanningRetention({ now, prisma })).resolves.toStrictEqual({
    deletedGenerationRuns: 4,
    expiredSessions: 2,
    scrubbedTerminalSessions: 1,
  });

  expect(updateMany).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      data: expect.objectContaining({ rawPrompt: null, stage: 'COMPLETE', status: 'EXPIRED' }),
      where: {
        expiresAt: { lte: now },
        status: { in: ['FAILED', 'GENERATING', 'PENDING', 'REVIEWING'] },
      },
    }),
  );
  expect(updateMany).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      data: expect.objectContaining({ rawPrompt: null }),
      where: expect.objectContaining({
        status: { in: ['APPLIED', 'CANCELLED', 'EXPIRED'] },
      }),
    }),
  );
  expect(deleteMany).toHaveBeenCalledWith({
    where: { createdAt: { lte: aiGenerationRunCutoff(now) } },
  });
});

test('the retention windows are the seven- and thirty-day boundaries the PRD sets', () => {
  expect(AI_PLANNING_SESSION_RETENTION_DAYS).toBe(7);
  expect(AI_GENERATION_RUN_RETENTION_DAYS).toBe(30);
  expect(AI_PLANNING_SESSION_TTL_MS).toBe(
    AI_PLANNING_SESSION_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
  );
});

test('cleanup boundaries include the moment they name and exclude anything newer', async () => {
  const updateMany = vi.fn().mockResolvedValue({ count: 0 });
  const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
  const now = new Date('2026-08-30T12:00:00.000Z');

  await cleanupAiPlanningRetention({
    now,
    prisma: {
      aiGenerationRun: { deleteMany },
      aiPlanningSession: { updateMany },
    } as unknown as AiPlanningRetentionStore,
  });

  const runCutoff = aiGenerationRunCutoff(now);
  const runFilter = deleteMany.mock.calls[0]?.[0]?.where?.createdAt as { lte: Date };
  const sessionFilter = updateMany.mock.calls[0]?.[0]?.where?.expiresAt as { lte: Date };

  // `lte` is the whole boundary: a run created exactly thirty days ago is inside
  // the window and goes, and one a millisecond newer stays. Reading it off the
  // emitted filter keeps the assertion tied to the query that actually runs.
  expect(runFilter.lte).toStrictEqual(runCutoff);
  expect(runCutoff.getTime()).toBeLessThanOrEqual(runFilter.lte.getTime());
  expect(new Date(runCutoff.getTime() + 1).getTime()).toBeGreaterThan(runFilter.lte.getTime());
  expect(sessionFilter.lte).toStrictEqual(now);

  // A session created exactly one TTL ago expires at `now`, so the same
  // inclusive boundary retires it on this run rather than the next one.
  const createdOneTtlAgo = new Date(now.getTime() - AI_PLANNING_SESSION_TTL_MS);
  const expiresAt = new Date(createdOneTtlAgo.getTime() + AI_PLANNING_SESSION_TTL_MS);
  expect(expiresAt.getTime()).toBeLessThanOrEqual(sessionFilter.lte.getTime());
});
