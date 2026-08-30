import { expect, test, vi } from 'vitest';
import { z } from 'zod';

import {
  AiGateway,
  AiGenerationError,
  type AiGenerationProvider,
} from '../src/services/ai-generation.js';
import { createAiGateway } from '../src/services/ai-runtime.js';
import { FakeAiGenerationProvider } from './support/fake-ai-generation.js';

const outputSchema = z.object({ destination: z.string() });
const request = {
  prompt: 'private prompt: visit Kyoto',
  schema: outputSchema,
  schemaDescription: 'A test destination.',
  schemaName: 'destination',
};

test('the gateway returns typed output and content-free metadata after one provider call', async () => {
  const provider = new FakeAiGenerationProvider([
    {
      output: { destination: 'Kyoto' },
      usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
    },
  ]);
  const telemetry = vi.fn();
  const clockValues = [100, 125];
  const gateway = new AiGateway({
    clock: () => clockValues.shift() ?? 125,
    maxOutputTokens: 512,
    now: () => new Date('2026-08-30T00:00:00.000Z'),
    provider,
    telemetrySink: telemetry,
    timeoutMs: 1_000,
  });

  await expect(gateway.generateStructured(request)).resolves.toStrictEqual({
    metadata: {
      inputTokens: 12,
      latencyMs: 25,
      model: 'fake-structured-model',
      outputTokens: 4,
      provider: 'fake',
      totalTokens: 16,
    },
    output: { destination: 'Kyoto' },
  });
  expect(provider.calls).toHaveLength(1);
  expect(provider.calls[0]).toMatchObject({
    maxOutputTokens: 512,
    schemaDescription: 'A test destination.',
    schemaName: 'destination',
  });
  expect(telemetry).toHaveBeenCalledOnce();
  expect(telemetry).toHaveBeenCalledWith({
    completedAt: '2026-08-30T00:00:00.000Z',
    inputTokens: 12,
    latencyMs: 25,
    model: 'fake-structured-model',
    outputTokens: 4,
    provider: 'fake',
    result: 'succeeded',
    totalTokens: 16,
  });
  expect(JSON.stringify(telemetry.mock.calls)).not.toContain('private prompt');
  expect(JSON.stringify(telemetry.mock.calls)).not.toContain('Kyoto');
});

test.each([
  ['TROVE_AI_DISABLED', 'ai_disabled'],
  ['TROVE_AI_BUDGET_DISABLED', 'ai_budget_disabled'],
] as const)('%s prevents provider construction and dispatch', async (switchName, code) => {
  const providerFactory = vi.fn();
  const gateway = createAiGateway({
    environment: { [switchName]: '1' },
    providerFactory,
  });

  await expect(gateway.generateStructured(request)).rejects.toMatchObject({ code });
  expect(providerFactory).not.toHaveBeenCalled();
});

test('the gateway aborts a bounded request and reports a normalized timeout', async () => {
  let receivedSignal: AbortSignal | undefined;
  const telemetry = vi.fn();
  const provider: AiGenerationProvider = {
    modelId: 'slow-model',
    providerId: 'fake',
    async generateStructured(providerRequest) {
      receivedSignal = providerRequest.signal;
      return await new Promise((_, reject) => {
        providerRequest.signal.addEventListener('abort', () => reject(new Error('private body')), {
          once: true,
        });
      });
    },
  };
  const gateway = new AiGateway({
    maxOutputTokens: 100,
    provider,
    telemetrySink: telemetry,
    timeoutMs: 5,
  });

  await expect(gateway.generateStructured(request)).rejects.toMatchObject({ code: 'timeout' });
  expect(receivedSignal?.aborted).toBe(true);
  expect(telemetry).toHaveBeenCalledWith(
    expect.objectContaining({
      errorCode: 'timeout',
      result: 'failed',
    }),
  );
});

test('caller cancellation is distinguished from timeout', async () => {
  const controller = new AbortController();
  const provider: AiGenerationProvider = {
    modelId: 'cancel-model',
    providerId: 'fake',
    async generateStructured(providerRequest) {
      return await new Promise((_, reject) => {
        providerRequest.signal.addEventListener('abort', () => reject(new Error('cancelled')), {
          once: true,
        });
      });
    },
  };
  const gateway = new AiGateway({ maxOutputTokens: 100, provider, timeoutMs: 1_000 });
  const generation = gateway.generateStructured({ ...request, signal: controller.signal });

  controller.abort();

  await expect(generation).rejects.toMatchObject({ code: 'cancelled' });
});

test('an already-cancelled request never dispatches to the provider', async () => {
  const controller = new AbortController();
  const provider = new FakeAiGenerationProvider([{ output: { destination: 'Kyoto' } }]);
  const gateway = new AiGateway({ maxOutputTokens: 100, provider, timeoutMs: 1_000 });
  controller.abort();

  await expect(
    gateway.generateStructured({ ...request, signal: controller.signal }),
  ).rejects.toMatchObject({ code: 'cancelled' });
  expect(provider.calls).toHaveLength(0);
});

test('unknown provider errors cannot expose provider bodies, prompts, or credentials', async () => {
  const secret = 'private-key-and-provider-body';
  const provider: AiGenerationProvider = {
    modelId: 'unsafe-model',
    providerId: 'fake',
    async generateStructured() {
      throw new Error(secret);
    },
  };
  const telemetry = vi.fn();
  const gateway = new AiGateway({
    maxOutputTokens: 100,
    provider,
    telemetrySink: telemetry,
    timeoutMs: 1_000,
  });

  const error = await gateway.generateStructured(request).catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(AiGenerationError);
  expect(error).toMatchObject({ code: 'provider_unavailable' });
  expect(JSON.stringify(error)).not.toContain(secret);
  expect(JSON.stringify(error)).not.toContain(request.prompt);
  expect(JSON.stringify(telemetry.mock.calls)).not.toContain(secret);
  expect(JSON.stringify(telemetry.mock.calls)).not.toContain(request.prompt);
});

test('the fake adapter validates deterministic output against the requested schema', async () => {
  const provider = new FakeAiGenerationProvider([{ output: { destination: 42 } }]);
  const gateway = new AiGateway({ maxOutputTokens: 100, provider, timeoutMs: 1_000 });

  await expect(gateway.generateStructured(request)).rejects.toMatchObject({
    code: 'invalid_response',
  });
});
