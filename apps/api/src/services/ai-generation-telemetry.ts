export type AiGenerationTelemetryEvent = {
  completedAt: string;
  errorCode?: string;
  finishReason?: string | null;
  inputTokens: number | null;
  latencyMs: number;
  model: string;
  outputTokens: number | null;
  provider: string;
  reasoningTokens?: number | null;
  result: 'cancelled' | 'failed' | 'succeeded';
  totalTokens: number | null;
};

export type AiGenerationTelemetrySink = (event: AiGenerationTelemetryEvent) => void;

let sink: AiGenerationTelemetrySink | null = null;

/**
 * The only process-wide AI telemetry boundary. Its event type deliberately has
 * nowhere to put a prompt, generated object, credential, URL, or provider body.
 */
export function setAiGenerationTelemetrySink(next: AiGenerationTelemetrySink | null) {
  sink = next;
}

export function recordAiGenerationTelemetry(event: AiGenerationTelemetryEvent) {
  sink?.(event);
}
