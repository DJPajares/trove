import { expect, test } from 'vitest';

import {
  DEFAULT_AI_LOCATION,
  DEFAULT_AI_MAX_OUTPUT_TOKENS,
  DEFAULT_AI_MODEL,
  DEFAULT_AI_TIMEOUT_MS,
  getAiGenerationEnvironment,
} from '../src/environment.js';

test('Vertex defaults to ADC and bounded generation settings', () => {
  expect(getAiGenerationEnvironment({ GOOGLE_VERTEX_PROJECT: ' trove-dev ' })).toStrictEqual({
    maxOutputTokens: DEFAULT_AI_MAX_OUTPUT_TOKENS,
    provider: 'vertex',
    status: 'available',
    timeoutMs: DEFAULT_AI_TIMEOUT_MS,
    vertex: {
      credentials: null,
      location: DEFAULT_AI_LOCATION,
      model: DEFAULT_AI_MODEL,
      project: 'trove-dev',
    },
  });
});

test('Vertex accepts explicit server credentials and configuration overrides', () => {
  expect(
    getAiGenerationEnvironment({
      GOOGLE_VERTEX_CLIENT_EMAIL: ' ai@example.test ',
      GOOGLE_VERTEX_LOCATION: ' us-central1 ',
      GOOGLE_VERTEX_PRIVATE_KEY: 'line-one\\nline-two',
      GOOGLE_VERTEX_PROJECT: 'trove-preview',
      TROVE_AI_MAX_OUTPUT_TOKENS: '4096',
      TROVE_AI_MODEL: 'gemini-test',
      TROVE_AI_PROVIDER: 'vertex',
      TROVE_AI_TIMEOUT_MS: '45000',
    }),
  ).toStrictEqual({
    maxOutputTokens: 4096,
    provider: 'vertex',
    status: 'available',
    timeoutMs: 45_000,
    vertex: {
      credentials: { clientEmail: 'ai@example.test', privateKey: 'line-one\nline-two' },
      location: 'us-central1',
      model: 'gemini-test',
      project: 'trove-preview',
    },
  });
});

test('global and budget switches make AI unavailable before credential validation', () => {
  expect(getAiGenerationEnvironment({ TROVE_AI_DISABLED: 'true' })).toMatchObject({
    code: 'ai_disabled',
    status: 'unavailable',
  });
  expect(getAiGenerationEnvironment({ TROVE_AI_BUDGET_DISABLED: '1' })).toMatchObject({
    code: 'ai_budget_disabled',
    status: 'unavailable',
  });
});

test.each([
  [{}, 'configuration_missing'],
  [{ GOOGLE_VERTEX_PROJECT: 'trove', TROVE_AI_PROVIDER: 'other' }, 'configuration_invalid'],
  [{ GOOGLE_VERTEX_PROJECT: 'trove', TROVE_AI_TIMEOUT_MS: '999' }, 'configuration_invalid'],
  [
    { GOOGLE_VERTEX_PROJECT: 'trove', TROVE_AI_MAX_OUTPUT_TOKENS: '65537' },
    'configuration_invalid',
  ],
  [
    { GOOGLE_VERTEX_CLIENT_EMAIL: 'ai@example.test', GOOGLE_VERTEX_PROJECT: 'trove' },
    'configuration_invalid',
  ],
])('invalid or incomplete AI configuration is recoverable (%o)', (environment, code) => {
  expect(getAiGenerationEnvironment(environment)).toMatchObject({ code, status: 'unavailable' });
});
