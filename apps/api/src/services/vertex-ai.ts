import { createGoogleVertex, type GoogleVertexProviderSettings } from '@ai-sdk/google-vertex';
import {
  APICallError,
  generateText,
  LoadAPIKeyError,
  LoadSettingError,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  type LanguageModel,
  type LanguageModelUsage,
} from 'ai';

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

function mapUsage(usage: LanguageModelUsage | undefined): AiGenerationUsage {
  if (!usage) return emptyAiGenerationUsage();

  return {
    inputTokens: usage.inputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
    totalTokens: usage.totalTokens ?? null,
  };
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

  return new AiGenerationProviderError('provider_unavailable');
}

export class VertexAiGenerationProvider implements AiGenerationProvider {
  readonly modelId: string;
  readonly providerId = 'vertex';
  private readonly languageModel: LanguageModel;

  constructor(
    configuration: VertexAiConfiguration,
    options: VertexAiGenerationProviderOptions = {},
  ) {
    this.modelId = configuration.model;
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
          schema: request.schema,
        }),
        prompt: request.prompt,
      });

      return { output: result.output, usage: mapUsage(result.totalUsage) };
    } catch (error) {
      throw mapVertexError(error);
    }
  }
}
