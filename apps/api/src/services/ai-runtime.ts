import { getAiGenerationEnvironment, type AvailableAiEnvironment } from '../environment.js';
import { AiGateway, type AiGenerationProvider } from './ai-generation.js';
import { VertexAiGenerationProvider } from './vertex-ai.js';

type AiProviderFactory = (configuration: AvailableAiEnvironment) => AiGenerationProvider;

function createProvider(configuration: AvailableAiEnvironment) {
  switch (configuration.provider) {
    case 'vertex':
      return new VertexAiGenerationProvider(configuration.vertex);
  }
}

export function createAiGateway(
  options: {
    environment?: Record<string, string | undefined>;
    providerFactory?: AiProviderFactory;
  } = {},
) {
  const configuration = getAiGenerationEnvironment(options.environment);

  if (configuration.status === 'unavailable') {
    return new AiGateway({
      maxOutputTokens: configuration.maxOutputTokens,
      timeoutMs: configuration.timeoutMs,
      unavailableCode: configuration.code,
    });
  }

  return new AiGateway({
    maxOutputTokens: configuration.maxOutputTokens,
    provider: (options.providerFactory ?? createProvider)(configuration),
    timeoutMs: configuration.timeoutMs,
  });
}
