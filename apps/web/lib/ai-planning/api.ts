import type { TripPlanScore } from '@/lib/plan-score/api';
import { createBrowserSupabaseClient, getBrowserSession } from '@/lib/supabase/client';
import type { Trip } from '@/lib/trips/api';

import type { AiPlanningSessionStage, AiPlanningSessionStatus } from './presentation';

export type AiPlanningDraftItem = {
  blockType: 'activity' | 'free_time' | 'meeting' | 'transport' | 'work';
  constraintIds: string[];
  durationMinutes: number;
  durationProvenance: 'ai_estimated' | 'user_owned';
  id: string;
  isAnchor: boolean;
  label: string;
  notes: string | null;
  origin: 'model' | 'user';
  placeRefId: string | null;
  priority: 'interested' | 'maybe' | 'must_go' | null;
  schedule:
    | { dayPart: 'afternoon' | 'anytime' | 'evening' | 'morning'; kind: 'day_part' }
    | { kind: 'exact'; localTime: string; source: 'model' | 'user' };
};

export type AiPlanningDraft = {
  assumptions: Array<{
    code:
      | 'dates_defaulted'
      | 'destination_inferred'
      | 'interest_inferred'
      | 'pace_defaulted'
      | 'party_size_defaulted'
      | 'trip_name_inferred';
    fieldPath: string;
    id: string;
    rationale: string | null;
    value: boolean | null | number | string | string[];
  }>;
  days: Array<{
    dailyBaseDeparturePlaceRefId: string | null;
    dailyBasePlaceRefId: string | null;
    date: string;
    destinationId: string | null;
    items: AiPlanningDraftItem[];
  }>;
  evidence: Array<{
    checkedAt: string | null;
    code: string | null;
    id: string;
    kind: 'identity' | 'opening_hours' | 'route';
    provider: string | null;
    status: 'conflict' | 'not_checked' | 'unverified' | 'verified';
    subjectId: string;
    subjectType: 'destination' | 'item' | 'place' | 'route';
  }>;
  normalizedRequest: unknown;
  places: Array<
    | {
        attributions: Array<{ provider: string; providerUri: string | null }>;
        id: string;
        location?: { latitude: number; longitude: number };
        name: string;
        placeId: string;
        provider: 'google';
        resolution: 'verified';
      }
    | {
        id: string;
        name: string;
        note: string | null;
        resolution: 'custom';
        verification: 'not_checked' | 'unverified';
      }
  >;
  schemaVersion: number;
  trip: {
    dateAssumptionId: string | null;
    dateSource: 'default' | 'user';
    /** Null on a draft generated before the model wrote descriptions. */
    description: string | null;
    destinations: Array<{
      assumptionId: string | null;
      destinationIntentId: string | null;
      id: string;
      placeRefId: string;
      source: 'model' | 'user';
    }>;
    endDate: string;
    name: string;
    nameAssumptionId: string | null;
    nameSource: 'model' | 'user';
    pace: 'balanced' | 'packed' | 'relaxed';
    paceAssumptionId: string | null;
    paceSource: 'default' | 'user';
    partySize: number;
    partySizeAssumptionId: string | null;
    partySizeSource: 'default' | 'user';
    startDate: string;
  };
  unscheduledItems: AiPlanningDraftItem[];
  warnings: Array<{
    code: string;
    evidenceIds: string[];
    id: string;
    itemIds: string[];
    material: boolean;
  }>;
};

export type AiPlanningSession = {
  appliedTripId: string | null;
  createdAt: string;
  draft: AiPlanningDraft | null;
  draftRevision: number;
  expiresAt: string;
  id: string;
  lastSafeError: string | null;
  pendingRunId: string | null;
  /** Scored during generation from evidence that run already fetched. */
  planScore: TripPlanScore | null;
  prompt: string | null;
  schemaVersion: number;
  stage: AiPlanningSessionStage;
  status: AiPlanningSessionStatus;
  tripDescription: string | null;
  tripName: string | null;
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

/** The draft itself is immutable; a description is session metadata beside it. */
export function setAiPlanningTripDescription(sessionId: string, description: string | null) {
  return aiPlanningRequest<{ session: AiPlanningSession }>(
    `/ai/planning-sessions/${sessionId}/description`,
    {
      body: JSON.stringify({ description }),
      method: 'PATCH',
    },
  );
}

/** The draft itself is immutable; a name is session metadata beside it. */
export function setAiPlanningTripName(sessionId: string, name: string | null) {
  return aiPlanningRequest<{ session: AiPlanningSession }>(
    `/ai/planning-sessions/${sessionId}/name`,
    {
      body: JSON.stringify({ name }),
      method: 'PATCH',
    },
  );
}

export function acknowledgeAiPlanningWarnings(sessionId: string, revision: number) {
  return aiPlanningRequest<{ session: AiPlanningSession }>(
    `/ai/planning-sessions/${sessionId}/warnings/acknowledge`,
    {
      body: JSON.stringify({ revision }),
      method: 'POST',
    },
  );
}

export function applyAiPlanningSession(
  sessionId: string,
  expectedRevision: number,
  deviceTimeZone: string | undefined,
) {
  return aiPlanningRequest<{ trip: Trip }>(`/ai/planning-sessions/${sessionId}/apply`, {
    body: JSON.stringify({ deviceTimeZone, expectedRevision }),
    method: 'POST',
  });
}
