import { createGoogleVertex, type GoogleVertexProviderSettings } from '@ai-sdk/google-vertex';
import {
  APICallError,
  generateText,
  jsonSchema,
  LoadAPIKeyError,
  LoadSettingError,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  type LanguageModel,
  type LanguageModelUsage,
} from 'ai';
import { z, type ZodType } from 'zod';

import {
  AiGenerationProviderError,
  emptyAiGenerationUsage,
  type AiGenerationProvider,
  type AiGenerationUsage,
  type AiProviderGenerationRequest,
  type AiProviderGenerationResult,
} from './ai-generation.js';

export type VertexAiConfiguration = {
  credentials: { clientEmail: string; privateKey: string } | null;
  location: string;
  model: string;
  project: string;
  thinkingBudgetTokens: number;
};

type VertexAiGenerationProviderOptions = {
  languageModel?: LanguageModel;
  providerFactory?: typeof createGoogleVertex;
};

export function getVertexProviderSettings(
  configuration: VertexAiConfiguration,
): GoogleVertexProviderSettings {
  return {
    location: configuration.location,
    project: configuration.project,
    ...(configuration.credentials
      ? {
          googleAuthOptions: {
            credentials: {
              client_email: configuration.credentials.clientEmail,
              private_key: configuration.credentials.privateKey,
            },
          },
        }
      : {}),
  };
}

type JsonSchemaNode = Record<string, unknown>;

/**
 * Vertex's responseSchema is narrower than the JSON Schema Zod emits, in two
 * ways that fail differently:
 *
 * - `enum`/`const` is permitted only on STRING, so a numeric `z.literal()`
 *   makes the whole request a 400 before the model runs.
 * - `oneOf` is ignored rather than rejected, so a `z.discriminatedUnion()`
 *   silently loses its shape and comes back as a bare string or `{}`.
 *
 * The constraint Vertex cannot enforce moves into the node's description so the
 * model still sees it. Nothing here relaxes validation: the caller's Zod schema
 * remains the authority on the response.
 */
function adaptNodeForVertex(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(adaptNodeForVertex);
  if (value === null || typeof value !== 'object') return value;

  const node: JsonSchemaNode = {};
  for (const [key, nested] of Object.entries(value)) {
    node[key] = adaptNodeForVertex(nested);
  }

  if ('oneOf' in node) {
    node.anyOf = node.oneOf;
    delete node.oneOf;
  }

  const allowed = Array.isArray(node.enum) ? node.enum : 'const' in node ? [node.const] : null;

  if (allowed && node.type !== 'string') {
    delete node.enum;
    delete node.const;
    const hint = `Allowed values: ${allowed.map((entry) => JSON.stringify(entry)).join(', ')}.`;
    node.description = typeof node.description === 'string' ? `${node.description} ${hint}` : hint;
  }

  return node;
}

export function vertexResponseSchema(schema: ZodType<unknown>): JsonSchemaNode {
  return adaptNodeForVertex(z.toJSONSchema(schema, { io: 'output' })) as JsonSchemaNode;
}

function mapUsage(usage: LanguageModelUsage | undefined): AiGenerationUsage {
  if (!usage) return emptyAiGenerationUsage();

  return {
    inputTokens: usage.inputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
    totalTokens: usage.totalTokens ?? null,
  };
}

/**
 * google-auth-library reports an unresolvable credential chain as a bare Error,
 * so it reaches this mapper untyped and would otherwise be classified as a
 * transient outage. The message is read only to pick a code and is never
 * retained: the returned error carries the code alone.
 */
const CREDENTIAL_RESOLUTION_FAILURE =
  /could not load the default credentials|unable to detect a project id/i;

function isCredentialResolutionFailure(error: unknown) {
  return error instanceof Error && CREDENTIAL_RESOLUTION_FAILURE.test(error.message);
}

function mapVertexError(error: unknown) {
  if (NoObjectGeneratedError.isInstance(error)) {
    return new AiGenerationProviderError(
      error.finishReason === 'content-filter' ? 'content_filtered' : 'invalid_response',
      mapUsage(error.usage),
    );
  }

  if (NoOutputGeneratedError.isInstance(error)) {
    return new AiGenerationProviderError('invalid_response');
  }

  if (LoadAPIKeyError.isInstance(error) || LoadSettingError.isInstance(error)) {
    return new AiGenerationProviderError('configuration_missing');
  }

  if (APICallError.isInstance(error)) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      return new AiGenerationProviderError('configuration_invalid');
    }
    if (error.statusCode === 408) {
      return new AiGenerationProviderError('timeout');
    }
    if (error.statusCode === 429) {
      return new AiGenerationProviderError('quota_exceeded');
    }
    if (error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500) {
      return new AiGenerationProviderError('invalid_response');
    }
  }

  if (isCredentialResolutionFailure(error)) {
    return new AiGenerationProviderError('configuration_missing');
  }

  return new AiGenerationProviderError('provider_unavailable');
}

export class VertexAiGenerationProvider implements AiGenerationProvider {
  readonly modelId: string;
  readonly providerId = 'vertex';
  private readonly languageModel: LanguageModel;
  private readonly thinkingBudgetTokens: number;

  constructor(
    configuration: VertexAiConfiguration,
    options: VertexAiGenerationProviderOptions = {},
  ) {
    this.modelId = configuration.model;
    this.thinkingBudgetTokens = configuration.thinkingBudgetTokens;
    this.languageModel =
      options.languageModel ??
      (options.providerFactory ?? createGoogleVertex)(getVertexProviderSettings(configuration))(
        configuration.model,
      );
  }

  async generateStructured<OUTPUT>(
    request: AiProviderGenerationRequest<OUTPUT>,
  ): Promise<AiProviderGenerationResult<OUTPUT>> {
    try {
      const result = await generateText({
        abortSignal: request.signal,
        maxOutputTokens: request.maxOutputTokens,
        maxRetries: 0,
        model: this.languageModel,
        output: Output.object({
          description: request.schemaDescription,
          name: request.schemaName,
          // `jsonSchema` performs no runtime checking on its own, so the
          // caller's Zod schema stays the authority through `validate`.
          schema: jsonSchema<OUTPUT>(vertexResponseSchema(request.schema), {
            validate: (value) => {
              const result = request.schema.safeParse(value);
              return result.success
                ? { success: true, value: result.data }
                : { success: false, error: result.error };
            },
          }),
        }),
        prompt: request.prompt,
        // Reasoning is billed against `maxOutputTokens`, so an uncapped
        // thinking model can exhaust the allowance mid-JSON and finish with
        // `length` rather than a parseable object.
        providerOptions: {
          google: { thinkingConfig: { thinkingBudget: this.thinkingBudgetTokens } },
        },
      });

      return { output: result.output, usage: mapUsage(result.totalUsage) };
    } catch (error) {
      throw mapVertexError(error);
    }
  }
}
