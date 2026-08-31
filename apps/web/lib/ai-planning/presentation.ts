export const AI_PLANNING_PROMPT_MAX_LENGTH = 10_000;

export type AiPlanningSessionStage =
  'created' | 'generating' | 'grounding' | 'scheduling' | 'validating' | 'reviewing' | 'complete';

export type AiPlanningSessionStatus =
  'pending' | 'generating' | 'reviewing' | 'failed' | 'cancelled' | 'expired' | 'applied';

export function isAiPlanningPromptValid(prompt: string) {
  const trimmed = prompt.trim();
  return trimmed.length > 0 && trimmed.length <= AI_PLANNING_PROMPT_MAX_LENGTH;
}

export function isAiPlanningSessionGenerating(status: AiPlanningSessionStatus) {
  return status === 'pending' || status === 'generating';
}

export function aiPlanningErrorMessageKey(code: string | null | undefined) {
  switch (code) {
    case 'ai_budget_disabled':
    case 'ai_disabled':
    case 'configuration_invalid':
    case 'configuration_missing':
    case 'content_filtered':
    case 'invalid_prompt':
    case 'invalid_response':
    case 'place_unresolved':
    case 'provider_unavailable':
    case 'quota_exceeded':
    case 'session_expired':
    case 'timeout':
      return code;
    default:
      return 'request_failed';
  }
}
