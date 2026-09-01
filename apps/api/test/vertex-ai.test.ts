import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { expect, test } from 'vitest';
import { z } from 'zod';

import { AiGenerationProviderError } from '../src/services/ai-generation.js';
import {
  getVertexProviderSettings,
  VertexAiGenerationProvider,
  vertexResponseSchema,
} from '../src/services/vertex-ai.js';

const configuration = {
  credentials: null,
  location: 'global',
  model: 'gemini-3.1-flash-lite',
  project: 'trove-test',
  thinkingBudgetTokens: 512,
};
const schema = z.object({ destination: z.string() });

function request(signal = new AbortController().signal) {
  return {
    maxOutputTokens: 321,
    prompt: 'Choose Kyoto.',
    schema,
    schemaDescription: 'One destination.',
    schemaName: 'destination',
    signal,
  };
}

function usage(inputTokens = 10, outputTokens = 4) {
  return {
    inputTokens: {
      cacheRead: undefined,
      cacheWrite: undefined,
      noCache: inputTokens,
      total: inputTokens,
    },
    outputTokens: { reasoning: undefined, text: outputTokens, total: outputTokens },
  };
}

test('Vertex settings use ADC by default and map explicit service credentials when present', () => {
  expect(getVertexProviderSettings(configuration)).toStrictEqual({
    location: 'global',
    project: 'trove-test',
  });
  expect(
    getVertexProviderSettings({
      ...configuration,
      credentials: { clientEmail: 'ai@example.test', privateKey: 'private-key' },
    }),
  ).toStrictEqual({
    googleAuthOptions: {
      credentials: { client_email: 'ai@example.test', private_key: 'private-key' },
    },
    location: 'global',
    project: 'trove-test',
  });
});

test('the Vertex adapter requests schema-constrained output and maps usage', async () => {
  const model = new MockLanguageModelV4({
    modelId: configuration.model,
    provider: 'google.vertex',
    doGenerate: async () => ({
      content: [{ text: '{"destination":"Kyoto"}', type: 'text' }],
      finishReason: { raw: undefined, unified: 'stop' },
      usage: usage(),
      warnings: [],
    }),
  });
  const provider = new VertexAiGenerationProvider(configuration, { languageModel: model });
  const signal = new AbortController().signal;

  await expect(provider.generateStructured(request(signal))).resolves.toStrictEqual({
    output: { destination: 'Kyoto' },
    usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
  });
  expect(model.doGenerateCalls).toHaveLength(1);
  expect(model.doGenerateCalls[0]).toMatchObject({
    abortSignal: signal,
    maxOutputTokens: 321,
    prompt: [{ content: [{ text: 'Choose Kyoto.', type: 'text' }], role: 'user' }],
    responseFormat: {
      description: 'One destination.',
      name: 'destination',
      type: 'json',
    },
  });
  expect(model.doGenerateCalls[0]?.responseFormat).toHaveProperty('schema');
});

test('the Vertex adapter normalizes quota errors without retaining SDK request data', async () => {
  const secret = 'credential-and-private-prompt';
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      throw new APICallError({
        message: secret,
        requestBodyValues: { prompt: secret },
        responseBody: secret,
        statusCode: 429,
        url: `https://vertex.example/${secret}`,
      });
    },
  });
  const provider = new VertexAiGenerationProvider(configuration, { languageModel: model });

  const error = await provider.generateStructured(request()).catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(AiGenerationProviderError);
  expect(error).toMatchObject({ code: 'quota_exceeded' });
  expect(JSON.stringify(error)).not.toContain(secret);
});

test('an unresolvable credential chain is configuration, not a provider outage', async () => {
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error(
        'Could not load the default credentials. Browse to https://cloud.google.com/docs/authentication/getting-started for more information.',
      );
    },
  });
  const provider = new VertexAiGenerationProvider(configuration, { languageModel: model });

  const error = await provider.generateStructured(request()).catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(AiGenerationProviderError);
  expect(error).toMatchObject({ code: 'configuration_missing' });
  expect(JSON.stringify(error)).not.toContain('default credentials');
});

test('an unrecognized provider error stays a generic outage', async () => {
  const secret = 'raw-provider-body-and-key';
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error(secret);
    },
  });
  const provider = new VertexAiGenerationProvider(configuration, { languageModel: model });

  const error = await provider.generateStructured(request()).catch((caught: unknown) => caught);

  expect(error).toMatchObject({ code: 'provider_unavailable' });
  expect(JSON.stringify(error)).not.toContain(secret);
});

test('the Vertex response schema drops constraints Vertex rejects or ignores', () => {
  const adapted = vertexResponseSchema(
    z.object({
      pace: z.enum(['relaxed', 'balanced']),
      schedule: z.discriminatedUnion('kind', [
        z.object({ dayPart: z.string(), kind: z.literal('day_part') }).strict(),
        z.object({ kind: z.literal('exact'), localTime: z.string() }).strict(),
      ]),
      schemaVersion: z.literal(1),
      selectedDurationDays: z.union([z.literal(3), z.literal(5), z.literal(7)]).nullable(),
    }),
  );
  const serialized = JSON.stringify(adapted);

  // Vertex ignores `oneOf`, so a discriminated union would lose its shape.
  expect(serialized).not.toContain('"oneOf"');
  expect(serialized).toContain('"anyOf"');

  // Vertex 400s on `enum`/`const` anywhere the type is not STRING.
  const offenders: string[] = [];
  (function walk(node: unknown, path: string) {
    if (Array.isArray(node))
      return node.forEach((entry, index) => walk(entry, `${path}[${index}]`));
    if (node === null || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (('enum' in record || 'const' in record) && record.type !== 'string') offenders.push(path);
    for (const [key, nested] of Object.entries(record)) walk(nested, `${path}.${key}`);
  })(adapted, '$');
  expect(offenders).toStrictEqual([]);

  // The dropped constraint has to survive somewhere the model can read it.
  const properties = adapted.properties as Record<string, Record<string, unknown> | undefined>;
  expect(properties.schemaVersion).toMatchObject({
    description: expect.stringContaining('Allowed values: 1.'),
    type: 'number',
  });

  // String enums and literals are already valid for Vertex and stay untouched.
  expect(properties.pace).toStrictEqual({ enum: ['relaxed', 'balanced'], type: 'string' });
  expect(serialized).toContain('"const":"day_part"');
});

test('the Vertex adapter still enforces the caller schema over the relaxed one', async () => {
  // `schemaVersion` reaches Vertex without its `const`, so the model can return
  // a wrong value; Zod must still reject it rather than passing it through.
  const strictSchema = z.object({ schemaVersion: z.literal(1) });
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ text: '{"schemaVersion":2}', type: 'text' }],
      finishReason: { raw: undefined, unified: 'stop' },
      usage: usage(),
      warnings: [],
    }),
  });
  const provider = new VertexAiGenerationProvider(configuration, { languageModel: model });

  await expect(
    provider.generateStructured({ ...request(), schema: strictSchema }),
  ).rejects.toMatchObject({ code: 'invalid_response' });
});

test("the Vertex adapter caps the model's reasoning budget", async () => {
  // Reasoning is billed against maxOutputTokens, so leaving it uncapped lets a
  // thinking model spend the allowance before finishing its JSON.
  let seen: unknown;
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      seen = options.providerOptions;
      return {
        content: [{ text: '{"destination":"Kyoto"}', type: 'text' }],
        finishReason: { raw: undefined, unified: 'stop' },
        usage: usage(),
        warnings: [],
      };
    },
  });
  const provider = new VertexAiGenerationProvider(configuration, { languageModel: model });

  await provider.generateStructured(request());

  expect(seen).toMatchObject({ google: { thinkingConfig: { thinkingBudget: 512 } } });
});

test('the Vertex adapter rejects malformed structured output with a safe code', async () => {
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ text: '{"destination":42}', type: 'text' }],
      finishReason: { raw: undefined, unified: 'stop' },
      usage: usage(),
      warnings: [],
    }),
  });
  const provider = new VertexAiGenerationProvider(configuration, { languageModel: model });

  await expect(provider.generateStructured(request())).rejects.toMatchObject({
    code: 'invalid_response',
  });
});
