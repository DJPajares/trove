import { expect, test, vi } from 'vitest';

import {
  AI_GENERATION_RUN_RETENTION_DAYS,
  aiGenerationRunCutoff,
  cleanupAiPlanningRetention,
  type AiPlanningRetentionStore,
} from '../src/services/ai-planning-retention.js';

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
