import {
  AiGenerationProviderError,
  emptyAiGenerationUsage,
  type AiGenerationProvider,
  type AiGenerationUsage,
  type AiProviderGenerationRequest,
  type AiProviderGenerationResult,
} from '../../src/services/ai-generation.js';

type FakeAiGenerationOutcome =
  | { errorCode: ConstructorParameters<typeof AiGenerationProviderError>[0] }
  | { output: unknown; usage?: Partial<AiGenerationUsage> };

export type FakeAiGenerationCall = {
  maxOutputTokens: number;
  schemaDescription?: string;
  schemaName: string;
  signal: AbortSignal;
};

/** Deterministic structured-output adapter for gateway and planner tests. */
export class FakeAiGenerationProvider implements AiGenerationProvider {
  readonly calls: FakeAiGenerationCall[] = [];
  readonly modelId: string;
  readonly providerId: string;
  private readonly outcomes: FakeAiGenerationOutcome[];

  constructor(
    outcomes: FakeAiGenerationOutcome[],
    options: { modelId?: string; providerId?: string } = {},
  ) {
    this.modelId = options.modelId ?? 'fake-structured-model';
    this.outcomes = [...outcomes];
    this.providerId = options.providerId ?? 'fake';
  }

  async generateStructured<OUTPUT>(
    request: AiProviderGenerationRequest<OUTPUT>,
  ): Promise<AiProviderGenerationResult<OUTPUT>> {
    this.calls.push({
      maxOutputTokens: request.maxOutputTokens,
      schemaDescription: request.schemaDescription,
      schemaName: request.schemaName,
      signal: request.signal,
    });

    const outcome = this.outcomes.shift();
    if (!outcome) {
      throw new AiGenerationProviderError('provider_unavailable');
    }
    if ('errorCode' in outcome) {
      throw new AiGenerationProviderError(outcome.errorCode);
    }

    try {
      const emptyUsage = emptyAiGenerationUsage();
      return {
        output: request.schema.parse(outcome.output),
        usage: { ...emptyUsage, ...outcome.usage },
      };
    } catch {
      throw new AiGenerationProviderError('invalid_response');
    }
  }
}
