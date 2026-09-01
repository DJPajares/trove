import { expect, test } from 'vitest';

import {
  DEFAULT_AI_LOCATION,
  DEFAULT_AI_MAX_OUTPUT_TOKENS,
  DEFAULT_AI_MODEL,
  DEFAULT_AI_THINKING_BUDGET_TOKENS,
  DEFAULT_AI_TIMEOUT_MS,
  getAiGenerationEnvironment,
} from '../src/environment.js';

test('Vertex uses discoverable ADC and bounded generation settings', () => {
  expect(
    getAiGenerationEnvironment({ GOOGLE_VERTEX_PROJECT: ' trove-dev ' }, () => true),
  ).toStrictEqual({
    maxOutputTokens: DEFAULT_AI_MAX_OUTPUT_TOKENS,
    provider: 'vertex',
    status: 'available',
    timeoutMs: DEFAULT_AI_TIMEOUT_MS,
    vertex: {
      credentials: null,
      location: DEFAULT_AI_LOCATION,
      model: DEFAULT_AI_MODEL,
      project: 'trove-dev',
      thinkingBudgetTokens: DEFAULT_AI_THINKING_BUDGET_TOKENS,
    },
  });
});

test('Vertex accepts explicit server credentials and configuration overrides', () => {
  expect(
    getAiGenerationEnvironment(
      {
        GOOGLE_VERTEX_CLIENT_EMAIL: ' ai@example.test ',
        GOOGLE_VERTEX_LOCATION: ' us-central1 ',
        GOOGLE_VERTEX_PRIVATE_KEY: 'line-one\\nline-two',
        GOOGLE_VERTEX_PROJECT: 'trove-preview',
        TROVE_AI_MAX_OUTPUT_TOKENS: '4096',
        TROVE_AI_MODEL: 'gemini-test',
        TROVE_AI_PROVIDER: 'vertex',
        TROVE_AI_TIMEOUT_MS: '45000',
      },
      () => false,
    ),
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
      thinkingBudgetTokens: DEFAULT_AI_THINKING_BUDGET_TOKENS,
    },
  });
});

test('an unauthenticated Vertex project is a configuration state, not an outage', () => {
  expect(
    getAiGenerationEnvironment({ GOOGLE_VERTEX_PROJECT: 'trove-dev' }, () => false),
  ).toMatchObject({ code: 'configuration_missing', status: 'unavailable' });
});

test('GOOGLE_APPLICATION_CREDENTIALS is a discoverable ADC source', () => {
  expect(
    getAiGenerationEnvironment({
      GOOGLE_APPLICATION_CREDENTIALS: '/tmp/service-account.json',
      GOOGLE_VERTEX_PROJECT: 'trove-dev',
    }),
  ).toMatchObject({ status: 'available', vertex: { credentials: null } });
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
  expect(getAiGenerationEnvironment(environment, () => true)).toMatchObject({
    code,
    status: 'unavailable',
  });
});

test('the reasoning budget is configurable and bounded', () => {
  // Reasoning shares the output allowance, so an unbounded value would let the
  // model spend the whole budget before finishing its answer.
  expect(
    getAiGenerationEnvironment(
      { GOOGLE_VERTEX_PROJECT: 'trove-dev', TROVE_AI_THINKING_BUDGET_TOKENS: '2048' },
      () => true,
    ),
  ).toMatchObject({ status: 'available', vertex: { thinkingBudgetTokens: 2048 } });

  // Zero is a legal value here; it is the provider that rejects it for pro models.
  expect(
    getAiGenerationEnvironment(
      { GOOGLE_VERTEX_PROJECT: 'trove-dev', TROVE_AI_THINKING_BUDGET_TOKENS: '0' },
      () => true,
    ),
  ).toMatchObject({ status: 'available', vertex: { thinkingBudgetTokens: 0 } });

  expect(
    getAiGenerationEnvironment(
      { GOOGLE_VERTEX_PROJECT: 'trove-dev', TROVE_AI_THINKING_BUDGET_TOKENS: '99999' },
      () => true,
    ),
  ).toMatchObject({ code: 'configuration_invalid', status: 'unavailable' });
});
