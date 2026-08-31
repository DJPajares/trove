import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, vi } from 'vitest';
import { z } from 'zod';

import { createAiGateway } from '../src/services/ai-runtime.js';
import { getAiPlanningAvailability } from '../src/services/ai-planning-sessions.js';
import {
  setAiPlanningTelemetrySink,
  type AiPlanningTelemetryEvent,
} from '../src/services/ai-planning-telemetry.js';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OWNER_ID = '00000000-0000-4000-8000-000000000001';

const request = {
  prompt: 'Plan three days in Tokyo.',
  schema: z.object({ destination: z.string() }),
  schemaName: 'destination',
};

/** Any database use at all is a failure for the paths under test. */
const forbiddenPrisma = new Proxy(
  {},
  {
    get(_target, model: string) {
      throw new Error(`a disabled AI path must not query ${model}`);
    },
  },
) as never;

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return entry.endsWith('.ts') ? [path] : [];
  });
}

test.each([
  ['TROVE_AI_DISABLED', 'ai_disabled'],
  ['TROVE_AI_BUDGET_DISABLED', 'ai_budget_disabled'],
] as const)('%s stops dispatch before a provider is ever constructed', async (variable, code) => {
  const providerFactory = vi.fn();
  const gateway = createAiGateway({
    environment: {
      GOOGLE_VERTEX_PROJECT: 'trove-prod',
      [variable]: '1',
    },
    providerFactory,
  });

  await expect(gateway.generateStructured(request)).rejects.toMatchObject({ code });

  // The switch has to bite before credentials are read, or turning AI off would
  // still depend on the credentials being valid.
  expect(providerFactory).not.toHaveBeenCalled();
});

test.each([
  ['TROVE_AI_DISABLED', 'ai_disabled'],
  ['TROVE_AI_BUDGET_DISABLED', 'ai_budget_disabled'],
] as const)(
  '%s reports availability without spending a database round trip',
  async (variable, code) => {
    await expect(
      getAiPlanningAvailability(OWNER_ID, {
        environment: { GOOGLE_VERTEX_PROJECT: 'trove-prod', [variable]: '1' },
        prisma: forbiddenPrisma,
      }),
    ).resolves.toStrictEqual({
      code,
      remainingDispatches: null,
      retryAt: null,
      status: 'unavailable',
    });
  },
);

test('a disabled gateway rejects without emitting planner telemetry', async () => {
  const events: AiPlanningTelemetryEvent[] = [];
  setAiPlanningTelemetrySink((event) => events.push(event));

  try {
    const gateway = createAiGateway({
      environment: { GOOGLE_VERTEX_PROJECT: 'trove-prod', TROVE_AI_DISABLED: 'true' },
      providerFactory: () => {
        throw new Error('a disabled gateway must not build a provider');
      },
    });
    await expect(gateway.generateStructured(request)).rejects.toMatchObject({
      code: 'ai_disabled',
    });
  } finally {
    setAiPlanningTelemetrySink(null);
  }

  // The dispatch-rejected event belongs to `claimAiPlanningDispatch`, which is
  // where a refusal is actually attributable to a run. A bare gateway call has
  // no run behind it and must stay silent.
  expect(events).toStrictEqual([]);
});

test('the kill switches can only disable AI, never manual trip creation', () => {
  const environmentModule = join(apiRoot, 'src/environment.ts');
  const switches = ['TROVE_AI_DISABLED', 'TROVE_AI_BUDGET_DISABLED'];

  const readers = sourceFiles(join(apiRoot, 'src')).filter((path) => {
    const contents = readFileSync(path, 'utf8');
    return switches.some((name) => contents.includes(name));
  });

  // Exactly one module may read them, and it turns them into an `unavailable`
  // AI configuration. Nothing on the manual trip, itinerary, or places paths can
  // therefore observe the switch at all, which is what keeps flipping it a
  // narrow action rather than an outage.
  expect(readers).toStrictEqual([environmentModule]);

  const trips = readFileSync(join(apiRoot, 'src/services/trips.ts'), 'utf8');
  expect(trips).not.toContain('getAiGenerationEnvironment');
  expect(trips).not.toContain('ai-planning');
});
