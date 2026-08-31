import type { AiPlannerDraft } from '@trove/types';

import type { AiPlanningSessionErrorCode } from './ai-planning-sessions.js';

/**
 * Operational telemetry for the planner itself, kept separate from the gateway's
 * model-usage events in `ai-generation-telemetry.ts`.
 *
 * Every field here is a count or a member of a closed vocabulary. There is
 * deliberately nowhere to put a prompt, a place name, a label, a note, a
 * provider body, or a user identifier: a dashboard needs to know that four
 * places fell back to Custom, not which four. Warning codes are mapped through
 * a known list so a code introduced later degrades to `other` rather than
 * widening the surface without anyone noticing.
 */
export const AI_PLANNING_TELEMETRY_WARNING_CODES = [
  'arrives_after_fixed_start',
  'balanced_pace_limit',
  'opening_hours_not_checked',
  'opening_hours_unavailable',
  'other',
  'outside_opening_hours',
  'overlapping_commitments',
  'place_ambiguous',
  'place_unresolved',
  'provider_cap_reached',
  'provider_unavailable',
  'real_place_item_cap_reached',
  'route_not_checked',
  'route_not_found',
  'tight_transition',
] as const;

export type AiPlanningTelemetryWarningCode = (typeof AI_PLANNING_TELEMETRY_WARNING_CODES)[number];

export type AiPlanningDispatchRejectionCode =
  | 'ai_budget_disabled'
  | 'ai_disabled'
  | 'configuration_invalid'
  | 'configuration_missing'
  | 'quota_exceeded';

/**
 * Apply rejections reuse the session error union rather than a parallel list, so
 * a new failure mode cannot quietly stop being reported. The union is closed and
 * every member is a bare code, which is what keeps this content-free.
 */
export type AiPlanningApplyOutcomeCode = AiPlanningSessionErrorCode;

export type AiPlanningDraftSummary = {
  customPlaces: number;
  days: number;
  items: number;
  materialWarnings: number;
  realPlaceItems: number;
  unscheduledItems: number;
  unverifiedPlaces: number;
  verifiedPlaces: number;
  warningCounts: Partial<Record<AiPlanningTelemetryWarningCode, number>>;
};

export type AiPlanningTelemetryEvent =
  | ({ kind: 'draft_assembled'; occurredAt: string } & AiPlanningDraftSummary)
  | {
      code: AiPlanningApplyOutcomeCode | null;
      kind: 'apply_completed';
      occurredAt: string;
      outcome: 'applied' | 'rejected' | 'replayed';
    }
  | { code: AiPlanningDispatchRejectionCode; kind: 'dispatch_rejected'; occurredAt: string };

export type AiPlanningTelemetrySink = (event: AiPlanningTelemetryEvent) => void;

let sink: AiPlanningTelemetrySink | null = null;

export function setAiPlanningTelemetrySink(next: AiPlanningTelemetrySink | null) {
  sink = next;
}

export function recordAiPlanningTelemetry(event: AiPlanningTelemetryEvent) {
  sink?.(event);
}

function telemetryWarningCode(code: string): AiPlanningTelemetryWarningCode {
  return (AI_PLANNING_TELEMETRY_WARNING_CODES as readonly string[]).includes(code) &&
    code !== 'other'
    ? (code as AiPlanningTelemetryWarningCode)
    : 'other';
}

/**
 * Reduces a reviewed draft to the counts a dashboard needs: how much was
 * planned, how much of it Google could actually identify, and how loudly the
 * deterministic rules had to complain.
 */
export function summarizeAiPlanningDraft(draft: AiPlannerDraft): AiPlanningDraftSummary {
  const warningCounts: Partial<Record<AiPlanningTelemetryWarningCode, number>> = {};
  for (const warning of draft.warnings) {
    const code = telemetryWarningCode(warning.code);
    warningCounts[code] = (warningCounts[code] ?? 0) + 1;
  }

  const verifiedPlaceIds = new Set(
    draft.places.filter((place) => place.resolution === 'verified').map((place) => place.id),
  );
  const scheduledItems = draft.days.flatMap((day) => day.items);

  return {
    customPlaces: draft.places.length - verifiedPlaceIds.size,
    days: draft.days.length,
    items: scheduledItems.length,
    materialWarnings: draft.warnings.filter((warning) => warning.material).length,
    realPlaceItems: scheduledItems.filter(
      (item) => item.placeRefId !== null && verifiedPlaceIds.has(item.placeRefId),
    ).length,
    unscheduledItems: draft.unscheduledItems.length,
    unverifiedPlaces: draft.places.filter(
      (place) => place.resolution === 'custom' && place.verification === 'unverified',
    ).length,
    verifiedPlaces: verifiedPlaceIds.size,
    warningCounts,
  };
}

export function recordAiPlanningDraftAssembled(draft: AiPlannerDraft, occurredAt: Date) {
  recordAiPlanningTelemetry({
    ...summarizeAiPlanningDraft(draft),
    kind: 'draft_assembled',
    occurredAt: occurredAt.toISOString(),
  });
}

export function recordAiPlanningDispatchRejected(
  code: AiPlanningDispatchRejectionCode,
  occurredAt: Date,
) {
  recordAiPlanningTelemetry({
    code,
    kind: 'dispatch_rejected',
    occurredAt: occurredAt.toISOString(),
  });
}

export function recordAiPlanningApplyCompleted(
  outcome: 'applied' | 'rejected' | 'replayed',
  code: AiPlanningApplyOutcomeCode | null,
  occurredAt: Date,
) {
  recordAiPlanningTelemetry({
    code,
    kind: 'apply_completed',
    occurredAt: occurredAt.toISOString(),
    outcome,
  });
}
