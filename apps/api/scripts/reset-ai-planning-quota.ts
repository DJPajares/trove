import { getPrismaClient } from '@trove/db';

import { AI_PLANNING_DISPATCH_WINDOW_MS } from '../src/services/ai-planning-sessions.js';

/**
 * Local dev only. The quota has no standalone counter row — availability and
 * dispatch both derive usage by counting `ai_generation_runs` dispatched within
 * the trailing 24h window, so resetting it means deleting those rows rather
 * than updating a value.
 *
 * Usage: pnpm --filter api ai-planning:reset-quota [ownerId]
 * With no ownerId, clears every owner's window — fine for a single-tenant
 * local database.
 */
async function main() {
  const ownerId = process.argv[2];
  const prisma = getPrismaClient();

  try {
    const cutoff = new Date(Date.now() - AI_PLANNING_DISPATCH_WINDOW_MS);
    const { count } = await prisma.aiGenerationRun.deleteMany({
      where: { dispatchedAt: { gt: cutoff }, ...(ownerId ? { ownerId } : {}) },
    });
    console.log(JSON.stringify({ deleted: count, ownerId: ownerId ?? 'all' }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'AI planning quota reset failed.');
  process.exitCode = 1;
});
