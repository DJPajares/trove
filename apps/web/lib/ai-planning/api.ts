import { createBrowserSupabaseClient, getBrowserSession } from '@/lib/supabase/client';

import type { AiPlanningSessionStage, AiPlanningSessionStatus } from './presentation';

export type AiPlanningSession = {
  appliedTripId: string | null;
  createdAt: string;
  draft: unknown | null;
  draftRevision: number;
  expiresAt: string;
  id: string;
  lastSafeError: string | null;
  pendingRunId: string | null;
  prompt: string | null;
  schemaVersion: number;
  stage: AiPlanningSessionStage;
  status: AiPlanningSessionStatus;
  updatedAt: string;
  warningAcknowledgement: { acknowledgedAt: string; revision: number } | null;
};

export type AiPlanningAvailability = {
  code: string | null;
  remainingDispatches: number | null;
  retryAt: string | null;
  status: 'available' | 'quota_exhausted' | 'unavailable';
};

export class AiPlanningApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly retryAt: string | null = null,
  ) {
    super(code);
  }
}

const apiUrl = process.env.NEXT_PUBLIC_TROVE_API_URL ?? 'http://localhost:3001';

async function aiPlanningRequest<T>(path: string, init?: RequestInit) {
  const supabase = createBrowserSupabaseClient();
  if (!supabase) throw new AiPlanningApiError('supabase_not_configured', 500);

  const session = await getBrowserSession();
  if (!session) throw new AiPlanningApiError('not_authenticated', 401);

  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
  } catch {
    throw new AiPlanningApiError('request_failed', 503);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { code?: string; retryAt?: string };
    throw new AiPlanningApiError(
      body.code ?? 'request_failed',
      response.status,
      body.retryAt ?? null,
    );
  }

  return response.json() as Promise<T>;
}

export function fetchAiPlanningAvailability() {
  return aiPlanningRequest<{ availability: AiPlanningAvailability }>(
    '/ai/planning-sessions/availability',
  );
}

export function recoverAiPlanningSession() {
  return aiPlanningRequest<{ session: AiPlanningSession | null }>('/ai/planning-sessions/recovery');
}

export function fetchAiPlanningSession(sessionId: string) {
  return aiPlanningRequest<{ session: AiPlanningSession }>(`/ai/planning-sessions/${sessionId}`);
}

export function createAiPlanningSession(prompt: string, idempotencyKey: string) {
  return aiPlanningRequest<{ session: AiPlanningSession }>('/ai/planning-sessions', {
    body: JSON.stringify({ prompt }),
    headers: { 'Idempotency-Key': idempotencyKey },
    method: 'POST',
  });
}

export function regenerateAiPlanningSession(
  sessionId: string,
  prompt: string,
  expectedRevision: number,
  idempotencyKey: string,
) {
  return aiPlanningRequest<{ session: AiPlanningSession }>(
    `/ai/planning-sessions/${sessionId}/regenerate`,
    {
      body: JSON.stringify({ expectedRevision, prompt }),
      headers: { 'Idempotency-Key': idempotencyKey },
      method: 'POST',
    },
  );
}

export function cancelAiPlanningSession(sessionId: string) {
  return aiPlanningRequest<{ session: AiPlanningSession }>(
    `/ai/planning-sessions/${sessionId}/cancel`,
    {
      body: JSON.stringify({}),
      method: 'POST',
    },
  );
}
