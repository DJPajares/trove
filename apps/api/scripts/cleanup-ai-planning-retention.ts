import { getPrismaClient } from '@trove/db';

import { cleanupAiPlanningRetention } from '../src/services/ai-planning-retention.js';

async function main() {
  try {
    const report = await cleanupAiPlanningRetention();
    console.log(JSON.stringify(report));
  } finally {
    await getPrismaClient().$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'AI planning retention cleanup failed.');
  process.exitCode = 1;
});
