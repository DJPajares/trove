import { z } from 'zod';

import { AiGenerationError } from '../src/services/ai-generation.js';
import { createAiGateway } from '../src/services/ai-runtime.js';

const verificationSchema = z.object({ status: z.literal('ready') });

async function main() {
  try {
    const result = await createAiGateway().generateStructured({
      prompt: 'Return the requested readiness status.',
      schema: verificationSchema,
      schemaDescription: 'A minimal readiness response for the Trove AI gateway.',
      schemaName: 'trove_ai_readiness',
    });

    console.info(
      JSON.stringify({
        metadata: result.metadata,
        status: 'succeeded',
      }),
    );
  } catch (error) {
    const failure =
      error instanceof AiGenerationError
        ? { code: error.code, metadata: error.metadata, status: 'failed' }
        : { code: 'provider_unavailable', metadata: null, status: 'failed' };

    console.error(JSON.stringify(failure));
    process.exitCode = 1;
  }
}

await main();
