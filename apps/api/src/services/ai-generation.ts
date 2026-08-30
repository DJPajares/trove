import type { ZodType } from 'zod';

import {
  recordAiGenerationTelemetry,
  type AiGenerationTelemetrySink,
} from './ai-generation-telemetry.js';

export const AI_GENERATION_ERROR_CODES = [
  'ai_budget_disabled',
  'ai_disabled',
  'cancelled',
  'configuration_invalid',
  'configuration_missing',
  'content_filtered',
  'invalid_response',
  'provider_unavailable',
  'quota_exceeded',
  'timeout',
] as const;

export type AiGenerationErrorCode = (typeof AI_GENERATION_ERROR_CODES)[number];

export type AiGenerationUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type AiGenerationMetadata = AiGenerationUsage & {
  latencyMs: number;
  model: string;
  provider: string;
};

export type AiStructuredGenerationRequest<OUTPUT> = {
  prompt: string;
  schema: ZodType<OUTPUT>;
  schemaDescription?: string;
  schemaName: string;
  signal?: AbortSignal;
};

export type AiProviderGenerationRequest<OUTPUT> = AiStructuredGenerationRequest<OUTPUT> & {
  maxOutputTokens: number;
  signal: AbortSignal;
};

export type AiProviderGenerationResult<OUTPUT> = {
  output: OUTPUT;
  usage: AiGenerationUsage;
};

export interface AiGenerationProvider {
  readonly modelId: string;
  readonly providerId: string;
  generateStructured<OUTPUT>(
    request: AiProviderGenerationRequest<OUTPUT>,
  ): Promise<AiProviderGenerationResult<OUTPUT>>;
}

type AiGenerationProviderErrorCode = Exclude<
  AiGenerationErrorCode,
  'ai_budget_disabled' | 'ai_disabled' | 'cancelled'
>;

/**
 * Provider adapters discard their original SDK error and retain only this safe
 * classification plus optional token counts. Never attach a provider error as
 * `cause`: AI SDK errors may contain the request body and raw response.
 */
export class AiGenerationProviderError extends Error {
  constructor(
    public readonly code: AiGenerationProviderErrorCode,
    public readonly usage: AiGenerationUsage = emptyAiGenerationUsage(),
  ) {
    super(code);
    this.name = 'AiGenerationProviderError';
  }
}

export class AiGenerationError extends Error {
  constructor(
    public readonly code: AiGenerationErrorCode,
    public readonly metadata: AiGenerationMetadata | null = null,
  ) {
    super(code);
    this.name = 'AiGenerationError';
  }

  toJSON() {
    return { code: this.code, metadata: this.metadata };
  }
}

export type AiGenerationResult<OUTPUT> = {
  metadata: AiGenerationMetadata;
  output: OUTPUT;
};

export type AiGatewayOptions = {
  clock?: () => number;
  maxOutputTokens: number;
  now?: () => Date;
  provider?: AiGenerationProvider;
  telemetrySink?: AiGenerationTelemetrySink;
  timeoutMs: number;
  unavailableCode?: Extract<
    AiGenerationErrorCode,
    'ai_budget_disabled' | 'ai_disabled' | 'configuration_invalid' | 'configuration_missing'
  >;
};

const ABORTED = Symbol('ai_generation_aborted');

export function emptyAiGenerationUsage(): AiGenerationUsage {
  return { inputTokens: null, outputTokens: null, totalTokens: null };
}

function metadataFor(
  provider: AiGenerationProvider,
  usage: AiGenerationUsage,
  startedAt: number,
  clock: () => number,
): AiGenerationMetadata {
  return {
    ...usage,
    latencyMs: Math.max(0, Math.round(clock() - startedAt)),
    model: provider.modelId,
    provider: provider.providerId,
  };
}

/**
 * Provider-neutral, single-dispatch structured generation boundary.
 * Planner code supplies a schema and never sees a Vertex or AI SDK type.
 */
export class AiGateway {
  private readonly clock: () => number;
  private readonly maxOutputTokens: number;
  private readonly now: () => Date;
  private readonly provider?: AiGenerationProvider;
  private readonly telemetrySink: AiGenerationTelemetrySink;
  private readonly timeoutMs: number;
  private readonly unavailableCode?: AiGatewayOptions['unavailableCode'];

  constructor(options: AiGatewayOptions) {
    this.clock = options.clock ?? (() => performance.now());
    this.maxOutputTokens = options.maxOutputTokens;
    this.now = options.now ?? (() => new Date());
    this.provider = options.provider;
    this.telemetrySink = options.telemetrySink ?? recordAiGenerationTelemetry;
    this.timeoutMs = options.timeoutMs;
    this.unavailableCode = options.unavailableCode;
  }

  async generateStructured<OUTPUT>(
    request: AiStructuredGenerationRequest<OUTPUT>,
  ): Promise<AiGenerationResult<OUTPUT>> {
    if (this.unavailableCode || !this.provider) {
      throw new AiGenerationError(this.unavailableCode ?? 'configuration_missing');
    }

    if (request.signal?.aborted) {
      throw new AiGenerationError('cancelled');
    }

    const provider = this.provider;
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), this.timeoutMs);
    const signal = request.signal
      ? AbortSignal.any([request.signal, timeoutController.signal])
      : timeoutController.signal;
    const startedAt = this.clock();
    let removeAbortListener = () => {};

    const aborted = new Promise<never>((_, reject) => {
      const onAbort = () => reject(ABORTED);
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      removeAbortListener = () => signal.removeEventListener('abort', onAbort);
    });

    try {
      const providerCall = Promise.resolve().then(() =>
        provider.generateStructured({
          ...request,
          maxOutputTokens: this.maxOutputTokens,
          signal,
        }),
      );
      const result = await Promise.race([providerCall, aborted]);
      const metadata = metadataFor(provider, result.usage, startedAt, this.clock);

      this.telemetrySink({
        ...metadata,
        completedAt: this.now().toISOString(),
        result: 'succeeded',
      });

      return { metadata, output: result.output };
    } catch (error) {
      const code: AiGenerationErrorCode = request.signal?.aborted
        ? 'cancelled'
        : timeoutController.signal.aborted
          ? 'timeout'
          : error instanceof AiGenerationProviderError
            ? error.code
            : 'provider_unavailable';
      const usage =
        error instanceof AiGenerationProviderError ? error.usage : emptyAiGenerationUsage();
      const metadata = metadataFor(provider, usage, startedAt, this.clock);

      this.telemetrySink({
        ...metadata,
        completedAt: this.now().toISOString(),
        errorCode: code,
        result: code === 'cancelled' ? 'cancelled' : 'failed',
      });

      throw new AiGenerationError(code, metadata);
    } finally {
      clearTimeout(timeout);
      removeAbortListener();
    }
  }
}
