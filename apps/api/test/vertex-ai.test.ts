import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { expect, test } from 'vitest';
import { z } from 'zod';

import { AiGenerationProviderError } from '../src/services/ai-generation.js';
import {
  getVertexProviderSettings,
  VertexAiGenerationProvider,
} from '../src/services/vertex-ai.js';

const configuration = {
  credentials: null,
  location: 'global',
  model: 'gemini-3.1-flash-lite',
  project: 'trove-test',
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
