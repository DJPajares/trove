import { scoringInputRevision } from './plan-score-rules.js';
import { planScoreReferenceTargets } from './plan-score-reference-targets.js';
import { createHash } from 'node:crypto';

import { getPrismaClient } from '@trove/db';
import {
  AI_PLANNER_MAX_REAL_PLACE_ITEMS,
  type AiPlannerDraft,
  type AiPlannerDraftItem,
  type AiPlannerEvidence,
  type AiPlannerModelProposal,
} from '@trove/types';

import {
  AI_PLANNER_SCHEMA_DESCRIPTION,
  buildAiPlannerContext,
  buildAiPlannerPrompt,
  coveredDayCount,
  isSparseProposal,
} from './ai-planner-prompt.js';
import {
  AiPlannerCompactReferenceError,
  aiPlannerCompactProposalSchema,
  expandAiPlannerProposal,
} from './ai-planner-compact.js';
import { createCanonicalPlacesService } from './canonical-places.js';
import { mapWithConcurrency, PROVIDER_CONCURRENCY_LIMIT } from './concurrency.js';
import { dayPartWindow } from './day-part-windows.js';
import {
  AiGenerationError,
  type AiGenerationErrorCode,
  type AiGenerationMetadata,
  type AiStructuredGenerationRequest,
} from './ai-generation.js';
import { createAiGateway } from './ai-runtime.js';
import {
  AiPlaceGrounder,
  type AiPlaceGroundingResult,
  type GroundedPlaceContext,
} from './ai-place-grounding.js';
import { createAiPlannerProviderContext } from './ai-planner-provider-context.js';
import {
  buildPlanScoreFromEvaluations,
  placeHoursDeadlines,
  evaluateScoredDay,
  withholdNonCurrentPlanScore,
  type TripPlanScore,
} from './plan-score.js';
import { groundableDraftPlaceIds, referencedDraftPlaceIds } from './ai-planning-draft-places.js';
import { draftDayStay, draftPlanScoreInputRevision } from './ai-planning-plan-score.js';
import {
  recordAiPlanningDraftAssembled,
  recordAiPlanningProposalCoverage,
} from './ai-planning-telemetry.js';
import {
  balancedPaceAnchorRange,
  resolveAiPlannerDefaults,
  validateAiPlannerDraft,
  validateAiPlannerModelProposal,
} from './ai-planning-rules.js';
import {
  AiPlanningSessionError,
  claimAiPlanningDispatch,
  completeAiPlanningRunFailure,
  completeAiPlanningRunSuccess,
  updateAiPlanningStage,
  type AiRunFailureDetails,
} from './ai-planning-sessions.js';
import {
  evaluateFeasibility,
  type PlanScoreDayItem,
  type PlanScoreInterval,
  type PlanScorePlace,
  type PlanScoreRouteSegment,
} from './plan-score-factors.js';
import { normalizePlaceLanguageCode } from './place-language.js';
import { openingIntervalsForWeekday, weekdayForLocalDate } from './place-opening-hours.js';
import type { PlaceDetailsResult, PlaceTextSearchProvider, PlacesService } from './places.js';
import type { RoutesService } from './routes.js';
import { rememberPlaceEvidence } from './cached-places.js';
import {
  DEFAULT_DAY_START_MINUTE,
  SUGGESTED_TIME_ROUNDING_MINUTES,
  suggestItemStart,
} from './itinerary-time-suggestions-rules.js';
import { enumerateDateRange, resolveCountryPrimaryTimeZone } from './trip-rules.js';
import { planningPreferencesFromAi } from '@trove/types';
import { timeZoneAtCoordinates } from './coordinate-time-zone.js';
import { normalizeScoringItems, dayOrigin, type ScoringHours } from './plan-score-normalization.js';
import type { ScoringPlace, ScoringRouteSegment } from './plan-score-evaluation.js';

type GenerationGateway = {
  generateStructured<OUTPUT>(
    request: AiStructuredGenerationRequest<OUTPUT>,
  ): Promise<{ metadata: AiGenerationMetadata; output: OUTPUT }>;
  timeoutMs?: number;
};

type ProviderContext = {
  placesProvider: PlaceTextSearchProvider | null;
  placesService: PlacesService | null;
  routesService: RoutesService | null;
};

type GroundedCandidate = AiPlaceGroundingResult;

type PlanningLifecycle = {
  claim(ownerId: string, runId: string): ReturnType<typeof claimAiPlanningDispatch>;
  completeFailure(
    ownerId: string,
    runId: string,
    code: AiGenerationErrorCode,
    metadata: AiGenerationMetadata | null,
    details?: AiRunFailureDetails,
  ): Promise<void>;
  completeSuccess(
    ownerId: string,
    runId: string,
    draft: AiPlannerDraft,
    planScore: TripPlanScore,
    metadata: AiGenerationMetadata,
  ): Promise<unknown>;
  updateStage(
    ownerId: string,
    runId: string,
    stage: 'GROUNDING' | 'SCHEDULING' | 'VALIDATING',
  ): Promise<void>;
};

export type AiPlanningPipelineOptions = {
  clock?: () => Date;
  environment?: Record<string, string | undefined>;
  gateway?: GenerationGateway;
  groundCandidates?: (
    proposal: AiPlannerModelProposal,
    providerContext: ProviderContext,
    targetIds: ReadonlySet<string>,
    scheduledPlaceIds: ReadonlySet<string>,
    signal?: AbortSignal,
  ) => Promise<GroundedCandidate[]>;
  lifecycle?: PlanningLifecycle;
  loadHomeLocation?: (ownerId: string) => Promise<string | null>;
  providerContext?: ProviderContext;
};

class AiPlanningPipelineFailure extends Error {
  constructor(
    public readonly code: AiGenerationErrorCode,
    public readonly metadata: AiGenerationMetadata | null,
    public readonly validationCodes: string[] = [],
    public readonly validationPaths: string[] = [],
  ) {
    super(code);
    this.name = 'AiPlanningPipelineFailure';
  }
}

function safeIssuePath(path: readonly PropertyKey[]) {
  return path
    .map((part) => (typeof part === 'number' ? '[]' : String(part).replace(/[^a-zA-Z_]/g, '')))
    .join('.')
    .slice(0, 160);
}

const activeRuns = new Map<string, AbortController>();

function scopedId(scope: string, value: string) {
  return `${scope}:${createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
}

function minuteOfDay(value: string) {
  const [hour = '0', minute = '0'] = value.split(':');
  return Number(hour) * 60 + Number(minute);
}

function scheduleRank(item: AiPlannerDraftItem) {
  if (item.schedule.kind === 'exact') return minuteOfDay(item.schedule.localTime);
  const starts = { morning: 0, afternoon: 720, evening: 1_020, anytime: 1_440 } as const;
  return starts[item.schedule.dayPart];
}

function isHardItem(item: AiPlannerDraftItem, proposal: AiPlannerModelProposal) {
  const constraints = new Map(
    proposal.normalizedRequest.constraints.map((constraint) => [constraint.id, constraint]),
  );
  return item.constraintIds.some(
    (constraintId) => constraints.get(constraintId)?.strength === 'hard',
  );
}

/**
 * Where the traveller is coming from, for the planner's prompt.
 *
 * The profile holds a country rather than a city now, so this is coarser than
 * it was. English is right here: the prompt is read by a model, not shown to
 * the traveller, and the model reasons about a country by its English name.
 */
async function loadHomeLocation(ownerId: string) {
  const profile = await getPrismaClient().profile.findUnique({
    where: { id: ownerId },
    select: { homeCountryCode: true },
  });
  if (!profile?.homeCountryCode) return null;

  return new Intl.DisplayNames('en', { type: 'region' }).of(profile.homeCountryCode) ?? null;
}

function unavailableGrounding(
  candidate: AiPlannerModelProposal['places'][number],
): GroundedCandidate {
  const evidenceId = scopedId('identity', candidate.id);
  return {
    context: null,
    evidence: {
      checkedAt: null,
      code: 'provider_unavailable',
      id: evidenceId,
      kind: 'identity',
      provider: null,
      status: 'not_checked',
      subjectId: candidate.id,
      subjectType: 'place',
    },
    place: {
      id: candidate.id,
      name: candidate.name,
      note: candidate.note,
      resolution: 'custom',
      verification: 'not_checked',
    },
    warnings: [
      {
        code: 'provider_unavailable',
        evidenceIds: [evidenceId],
        id: scopedId('warning', candidate.id),
        itemIds: [],
        material: false,
      },
    ],
  };
}

function candidateLocalities(proposal: AiPlannerModelProposal) {
  const destinations = new Map(
    proposal.normalizedRequest.destinations.map((destination) => [
      destination.id,
      destination.name,
    ]),
  );
  const localities = new Map<string, string>();
  for (const item of proposal.items) {
    if (!item.candidatePlaceId || !item.destinationIntentId) continue;
    const locality = destinations.get(item.destinationIntentId);
    if (locality) localities.set(item.candidatePlaceId, locality);
  }
  return localities;
}

/**
 * Looks up only the candidates named in `targetIds`, which the assembled draft
 * decides. A candidate the model proposed and the schedule then dropped is not
 * searched at all, and deliberately carries no evidence and no warning: the
 * provider was never asked about it, so claiming it was unavailable would be a
 * lie told at the traveller's expense.
 */
async function groundCandidates(
  proposal: AiPlannerModelProposal,
  providerContext: ProviderContext,
  targetIds: ReadonlySet<string>,
  scheduledPlaceIds: ReadonlySet<string>,
  signal?: AbortSignal,
): Promise<GroundedCandidate[]> {
  const targets = proposal.places.filter((candidate) => targetIds.has(candidate.id));
  if (targets.length === 0) return [];
  if (!providerContext.placesProvider) {
    return targets.map(unavailableGrounding);
  }

  const canonical = createCanonicalPlacesService();
  const grounder = new AiPlaceGrounder(providerContext.placesProvider, canonical);
  const localities = candidateLocalities(proposal);
  const destinationPlaceIds = new Set(
    proposal.destinations.map((destination) => destination.candidatePlaceId),
  );
  return grounder.groundCandidates(
    targets.map((candidate) => ({
      ...candidate,
      detail: scheduledPlaceIds.has(candidate.id) ? 'evidence' : 'location',
      localityHint: localities.get(candidate.id),
      requireExactName: destinationPlaceIds.has(candidate.id),
      signal,
    })),
  );
}

function targetDayIndex(
  item: AiPlannerModelProposal['items'][number],
  proposal: AiPlannerModelProposal,
  dates: string[],
) {
  const constraints = new Map(
    proposal.normalizedRequest.constraints.map((constraint) => [constraint.id, constraint]),
  );
  const fixedDate = item.constraintIds
    .map((constraintId) => constraints.get(constraintId)?.date)
    .find((date): date is string => Boolean(date));
  return fixedDate ? dates.indexOf(fixedDate) : item.dayIndex;
}

function toDraftItem(item: AiPlannerModelProposal['items'][number]): AiPlannerDraftItem {
  return {
    blockType: item.blockType,
    constraintIds: item.constraintIds,
    durationMinutes: item.durationMinutes,
    durationProvenance: item.durationProvenance,
    id: item.id,
    isAnchor: item.isAnchor,
    label: item.label,
    notes: item.notes,
    origin: item.origin,
    placeRefId: item.candidatePlaceId,
    priority: item.priority,
    schedule: item.schedule,
  };
}

/**
 * Folds grounding back into the draft it was scoped to. Warnings are attributed
 * to the draft's own items rather than the proposal's, so a warning never names
 * an item the schedule already dropped.
 */
export function applyGroundingToDraft(draft: AiPlannerDraft, grounding: GroundedCandidate[]) {
  const itemIds = new Map<string, string[]>();
  for (const item of [...draft.days.flatMap((day) => day.items), ...draft.unscheduledItems]) {
    if (!item.placeRefId) continue;
    itemIds.set(item.placeRefId, [...(itemIds.get(item.placeRefId) ?? []), item.id]);
  }

  for (const result of grounding) {
    const index = draft.places.findIndex((place) => place.id === result.place.id);
    if (index === -1) continue;
    draft.places[index] = result.place;
    draft.evidence.push(result.evidence);
    for (const warning of result.warnings) {
      draft.warnings.push({ ...warning, itemIds: itemIds.get(result.place.id) ?? [] });
    }
  }
}

function enforceBalancedPace(draft: AiPlannerDraft, proposal: AiPlannerModelProposal) {
  if (draft.trip.pace !== 'balanced') return;
  draft.days.forEach((day, dayIndex) => {
    const { maximum } = balancedPaceAnchorRange(dayIndex, draft.days.length);
    let anchors = 0;
    day.items = day.items.filter((item) => {
      if (!item.isAnchor) return true;
      anchors += 1;
      if (anchors <= maximum || isHardItem(item, proposal)) return true;
      draft.unscheduledItems.push(item);
      draft.warnings.push({
        code: 'balanced_pace_limit',
        evidenceIds: [],
        id: scopedId('warning', `pace:${item.id}`),
        itemIds: [item.id],
        material: false,
      });
      return false;
    });
  });
}

/**
 * Runs before grounding, so the cap bounds the lookups a run can make rather
 * than deciding which already-billed lookups to keep. Only scheduled items are
 * counted, because only they are grounded: an unscheduled item consuming a slot
 * would tighten the plan without saving a call.
 */
function enforceRealPlaceLimit(draft: AiPlannerDraft, proposal: AiPlannerModelProposal) {
  const items = draft.days.flatMap((day) => day.items);
  const realItems = items.filter((item) => item.placeRefId);
  const ordered = realItems.toSorted((left, right) => {
    const hard = Number(isHardItem(right, proposal)) - Number(isHardItem(left, proposal));
    return hard || items.indexOf(left) - items.indexOf(right);
  });
  for (const item of ordered.slice(AI_PLANNER_MAX_REAL_PLACE_ITEMS)) {
    if (isHardItem(item, proposal)) {
      throw new AiPlanningPipelineFailure('invalid_response', null);
    }
    const original = draft.places.find((place) => place.id === item.placeRefId);
    const customId = scopedId('place-cap', item.id);
    draft.places.push({
      id: customId,
      name: original?.name ?? item.label,
      note: item.notes,
      resolution: 'custom',
      verification: 'not_checked',
    });
    item.placeRefId = customId;
    const evidenceId = scopedId('identity-cap', item.id);
    draft.evidence.push({
      checkedAt: null,
      code: 'real_place_item_cap_reached',
      id: evidenceId,
      kind: 'identity',
      provider: null,
      status: 'not_checked',
      subjectId: customId,
      subjectType: 'place',
    });
    draft.warnings.push({
      code: 'real_place_item_cap_reached',
      evidenceIds: [evidenceId],
      id: scopedId('warning', `place-cap:${item.id}`),
      itemIds: [item.id],
      material: false,
    });
  }
}

function protectWorkBlocks(draft: AiPlannerDraft, proposal: AiPlannerModelProposal) {
  for (const day of draft.days) {
    const workParts = day.items.flatMap((item) =>
      item.blockType === 'work' && isHardItem(item, proposal) && item.schedule.kind === 'day_part'
        ? [item.schedule.dayPart]
        : [],
    );
    if (!workParts.length) continue;
    day.items = day.items.filter((item) => {
      if (item.origin !== 'model' || item.schedule.kind !== 'day_part') return true;
      const itemPart = item.schedule.dayPart;
      if (
        !workParts.some((part) => part === 'anytime' || itemPart === 'anytime' || part === itemPart)
      )
        return true;
      draft.unscheduledItems.push(item);
      draft.warnings.push({
        code: 'work_block_conflict',
        evidenceIds: [],
        id: scopedId('warning', `work:${day.date}:${item.id}`),
        itemIds: [item.id],
        material: false,
      });
      return false;
    });
  }
}

/** A departure block supplies no destination arrival instant. */
function protectUnknownArrival(draft: AiPlannerDraft, proposal: AiPlannerModelProposal) {
  const firstDay = draft.days[0];
  if (!firstDay) return;
  const proposalItems = new Map(proposal.items.map((item) => [item.id, item]));
  const outbound = firstDay.items.find((item) => {
    const source = proposalItems.get(item.id);
    return (
      item.blockType === 'transport' &&
      item.origin === 'user' &&
      isHardItem(item, proposal) &&
      /\bflight\b/i.test(`${item.label} ${source?.notes ?? ''}`)
    );
  });
  if (!outbound) return;

  firstDay.items = firstDay.items.filter((item) => {
    if (item.id === outbound.id) return true;
    const source = proposalItems.get(item.id);
    const destinationActivity = Boolean(source?.destinationIntentId) || item.origin === 'model';
    if (!destinationActivity) return true;
    const hard = isHardItem(item, proposal);
    draft.warnings.push({
      code: 'arrival_time_unknown',
      evidenceIds: [],
      id: scopedId('warning', `arrival:${firstDay.date}:${item.id}`),
      itemIds: [item.id],
      material: hard,
    });
    if (hard) return true;
    draft.unscheduledItems.push(item);
    return false;
  });
}

/**
 * Turns the nights the traveller named into where each day starts and ends.
 * A night spent at a stay ends that day there and starts the next one there,
 * so a change-over day starts at one stay and ends at the next. The morning
 * after the last stay is left alone: ending it back at a hotel already
 * checked out of would invent a return trip.
 */
function assignDraftStays(
  days: AiPlannerDraft['days'],
  proposal: AiPlannerModelProposal,
  candidateIds: ReadonlySet<string>,
) {
  const start = new Map<number, string>();
  const end = new Map<number, string>();
  for (const stay of proposal.stays ?? []) {
    if (!candidateIds.has(stay.candidatePlaceId)) continue;
    for (let night = stay.firstNightDayIndex; night <= stay.lastNightDayIndex; night++) {
      if (night >= days.length) break;
      end.set(night, stay.candidatePlaceId);
      if (night + 1 < days.length) start.set(night + 1, stay.candidatePlaceId);
    }
  }
  days.forEach((day, index) => {
    const from = start.get(index) ?? null;
    const to = end.get(index) ?? null;
    if (!to) return;
    day.dailyBasePlaceRefId = from;
    day.dailyBaseDeparturePlaceRefId = from === to ? null : to;
  });
}

/**
 * A stay only helps when it is somewhere real. One the provider could not
 * verify has no location to route from, so the days fall back to their stops.
 */
export function dropUnverifiedDraftStays(draft: AiPlannerDraft) {
  const verified = new Set(
    draft.places.filter((place) => place.resolution === 'verified').map((place) => place.id),
  );
  for (const day of draft.days) {
    if (day.dailyBasePlaceRefId && !verified.has(day.dailyBasePlaceRefId))
      day.dailyBasePlaceRefId = null;
    if (day.dailyBaseDeparturePlaceRefId && !verified.has(day.dailyBaseDeparturePlaceRefId))
      day.dailyBaseDeparturePlaceRefId = null;
  }
}

/**
 * Builds and prunes the day-to-day itinerary without reaching a provider. The
 * places it emits are pending placeholders; `applyGroundingToDraft` upgrades the
 * ones that survive to here.
 */
export function assembleAiPlanningDraft(
  proposal: AiPlannerModelProposal,
  generationDate: Date,
): AiPlannerDraft {
  const defaults = resolveAiPlannerDefaults(proposal.normalizedRequest, proposal, generationDate);
  const dates = enumerateDateRange(defaults.startDate, defaults.endDate);
  const candidateIds = new Set(proposal.places.map((candidate) => candidate.id));
  const destinationIds = new Map<string, string>();
  const destinations = proposal.destinations.map((destination, index) => {
    const id = scopedId('destination', `${index}:${destination.candidatePlaceId}`);
    if (destination.destinationIntentId) destinationIds.set(destination.destinationIntentId, id);
    return {
      assumptionId: destination.assumptionId,
      destinationIntentId: destination.destinationIntentId,
      id,
      placeRefId: destination.candidatePlaceId,
      source: destination.source,
    };
  });
  const days: AiPlannerDraft['days'] = dates.map((date, index) => ({
    dailyBaseDeparturePlaceRefId: null,
    dailyBasePlaceRefId: null,
    date,
    destinationId:
      destinations.length === 0
        ? null
        : destinations[
            Math.min(
              destinations.length - 1,
              Math.floor((index * destinations.length) / dates.length),
            )
          ]!.id,
    items: [],
  }));
  assignDraftStays(days, proposal, candidateIds);
  const unscheduledItems: AiPlannerDraftItem[] = [];

  for (const proposalItem of proposal.items) {
    const item = toDraftItem(proposalItem);
    if (item.placeRefId && !candidateIds.has(item.placeRefId)) item.placeRefId = null;
    const dayIndex = targetDayIndex(proposalItem, proposal, dates);
    if (dayIndex === null || dayIndex < 0 || dayIndex >= days.length) {
      unscheduledItems.push(item);
      continue;
    }
    const day = days[dayIndex]!;
    const itemDestination = proposalItem.destinationIntentId
      ? destinationIds.get(proposalItem.destinationIntentId)
      : undefined;
    if (itemDestination) day.destinationId = itemDestination;
    day.items.push(item);
  }
  days.forEach((day) => day.items.sort((left, right) => scheduleRank(left) - scheduleRank(right)));

  const draft: AiPlannerDraft = {
    assumptions: defaults.assumptions,
    days,
    evidence: [],
    normalizedRequest: proposal.normalizedRequest,
    places: proposal.places.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      note: candidate.note,
      resolution: 'custom' as const,
      verification: 'not_checked' as const,
    })),
    schemaVersion: proposal.schemaVersion,
    trip: {
      dateAssumptionId: defaults.dateAssumptionId,
      dateSource: defaults.dateSource,
      description: defaults.description,
      destinations,
      endDate: defaults.endDate,
      name: defaults.name,
      nameAssumptionId: defaults.nameAssumptionId,
      nameSource: defaults.nameSource,
      pace: defaults.pace,
      paceAssumptionId: defaults.paceAssumptionId,
      paceSource: defaults.paceSource,
      partySize: defaults.partySize,
      partySizeAssumptionId: defaults.partySizeAssumptionId,
      partySizeSource: defaults.partySizeSource,
      startDate: defaults.startDate,
    },
    unscheduledItems,
    warnings: [],
  };
  protectWorkBlocks(draft, proposal);
  protectUnknownArrival(draft, proposal);
  enforceBalancedPace(draft, proposal);
  enforceRealPlaceLimit(draft, proposal);
  // A candidate nothing references is not part of the plan, so it should neither
  // travel with the draft nor cost a lookup.
  const referenced = referencedDraftPlaceIds(draft, {
    includeDestinations: true,
    includeUnscheduled: true,
  });
  draft.places = draft.places.filter((place) => referenced.has(place.id));
  return draft;
}

function evidenceCode(result: PlaceDetailsResult) {
  if (result.status === 'empty') return 'opening_hours_unavailable';
  if (result.status === 'unavailable') {
    return result.code === 'budget_exhausted'
      ? 'provider_cap_reached'
      : 'opening_hours_not_checked';
  }
  return null;
}

function providerTimeAllowanceExpired(signal?: AbortSignal) {
  return signal?.aborted && signal.reason === 'provider_time_allowance_exhausted';
}

function openingEvidence(
  item: AiPlannerDraftItem,
  date: string,
  result: PlaceDetailsResult | null,
): {
  evidence: AiPlannerEvidence;
  intervals: Array<{ endMinute: number; startMinute: number }> | null;
} {
  const id = scopedId('hours', `${date}:${item.id}`);
  if (!result || result.status !== 'ok') {
    return {
      evidence: {
        checkedAt: null,
        code: result ? evidenceCode(result) : 'opening_hours_not_checked',
        id,
        kind: 'opening_hours',
        provider: null,
        status: 'not_checked',
        subjectId: item.id,
        subjectType: 'item',
      },
      intervals: null,
    };
  }
  if (result.place.openingPeriods.length === 0 || result.place.utcOffsetMinutes === null) {
    return {
      evidence: {
        checkedAt: result.freshness.fetchedAt,
        code: 'opening_hours_unavailable',
        id,
        kind: 'opening_hours',
        provider: 'google',
        status: 'unverified',
        subjectId: item.id,
        subjectType: 'item',
      },
      intervals: null,
    };
  }
  return {
    evidence: {
      checkedAt: result.freshness.fetchedAt,
      code: null,
      id,
      kind: 'opening_hours',
      provider: 'google',
      status: 'verified',
      subjectId: item.id,
      subjectType: 'item',
    },
    intervals: openingIntervalsForWeekday(result.place.openingPeriods, weekdayForLocalDate(date)),
  };
}

function feasibilityItem(
  item: AiPlannerDraftItem,
  opening: Array<{ endMinute: number; startMinute: number }> | null,
  inboundTravelMinutes: number | null,
): PlanScoreDayItem {
  const window =
    item.schedule.kind === 'day_part' ? dayPartWindow(item.schedule.dayPart.toUpperCase()) : null;
  return {
    blockType: item.blockType,
    duration: {
      minutes: item.durationMinutes,
      source: item.durationProvenance === 'user_owned' ? 'USER_OWNED' : 'ESTIMATED',
    },
    fixed: item.schedule.kind === 'exact' && item.schedule.source === 'user',
    id: item.id,
    inboundTravel:
      inboundTravelMinutes === null
        ? null
        : { minutes: inboundTravelMinutes, source: 'FRESH_PROVIDER' },
    openingHours:
      item.blockType === 'activity' && opening
        ? { intervals: opening, source: 'FRESH_PROVIDER', status: 'KNOWN' }
        : { status: 'UNKNOWN' },
    start:
      item.schedule.kind === 'exact'
        ? {
            minutes: minuteOfDay(item.schedule.localTime),
            source: item.schedule.source === 'user' ? 'USER_OWNED' : 'ESTIMATED',
          }
        : null,
    startWindow: window
      ? {
          earliestMinute: window.startMinute,
          latestMinute: window.endMinute,
          source: 'ESTIMATED',
        }
      : null,
  };
}

function localTimeFromMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60) % 24;
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Refines the model's coarse dayparts only after the evidence pass has described
 * the day. The pure suggester may qualify a result with caveats, but it only
 * returns `ok` when something beyond the generic day start supports the time.
 */
export function assignAiPlannerSuggestedTimes(
  day: AiPlannerDraft['days'][number],
  intervals: Map<string, PlanScoreInterval[]>,
  inbound: Map<string, number | null>,
) {
  const noFeasibleTime: string[] = [];
  const evidenceItems = day.items.map((item) =>
    feasibilityItem(item, intervals.get(item.id) ?? null, inbound.get(item.id) ?? null),
  );

  day.items.forEach((item, index) => {
    if (item.schedule.kind !== 'day_part') return;
    // "Night flight" is a traveller constraint, but there is no flight
    // timetable in the draft. Turning Evening into 17:00 would falsely make
    // the block look like a chosen departure time.
    if (
      item.blockType === 'transport' &&
      item.origin === 'user' &&
      /\bnight\b/i.test(`${item.label} ${item.notes ?? ''}`)
    )
      return;
    if (item.blockType === 'work' && item.origin === 'user' && item.constraintIds.length > 0)
      return;

    const suggestion = suggestItemStart({
      // Previously assigned estimates occupy real time too, even though they
      // remain movable estimates rather than traveller-owned commitments.
      commitments: evidenceItems.flatMap((other) =>
        other.id !== item.id && !other.fixed && other.start
          ? [
              {
                endMinute: other.start.minutes + (other.duration?.minutes ?? 0),
                id: other.id,
                source: 'ESTIMATED' as const,
                startMinute: other.start.minutes,
              },
            ]
          : [],
      ),
      dayStartMinute: DEFAULT_DAY_START_MINUTE,
      items: evidenceItems,
      roundingMinutes: SUGGESTED_TIME_ROUNDING_MINUTES,
      targetItemId: item.id,
    });
    if (suggestion.status === 'no_feasible_time') {
      noFeasibleTime.push(item.id);
      return;
    }
    if (suggestion.status !== 'ok') return;
    if (suggestion.startMinute + item.durationMinutes > 1_440) {
      noFeasibleTime.push(item.id);
      return;
    }

    item.schedule = {
      kind: 'exact',
      localTime: localTimeFromMinutes(suggestion.startMinute),
      source: 'model',
    };
    day.items[index] = item;
    evidenceItems[index] = feasibilityItem(
      item,
      intervals.get(item.id) ?? null,
      inbound.get(item.id) ?? null,
    );
  });
  return noFeasibleTime;
}

export async function addOpeningEvidence(
  draft: AiPlannerDraft,
  proposal: AiPlannerModelProposal,
  contexts: Map<string, GroundedPlaceContext>,
  placesService: PlacesService | null,
  signal?: AbortSignal,
): Promise<{
  intervals: Map<string, PlanScoreInterval[]>;
  ratings: Map<string, number>;
  scoringPlaces: Map<string, ScoringPlace>;
  hours: Map<string, ScoringHours>;
}> {
  const requestedContexts = new Map<string, GroundedPlaceContext>();
  const contextKey = (context: GroundedPlaceContext) =>
    JSON.stringify([
      context.externalPlaceId,
      normalizePlaceLanguageCode(context.languageCode),
      context.regionCode ?? '',
    ]);
  for (const day of draft.days) {
    for (const item of day.items) {
      const context = item.placeRefId ? contexts.get(item.placeRefId) : null;
      if (!context || (item.blockType !== 'activity' && !context.evidence)) continue;
      const key = contextKey(context);
      // Prefer paid-for evidence if two candidate references resolved to one venue.
      if (!requestedContexts.has(key) || context.evidence) requestedContexts.set(key, context);
    }
  }
  const details = new Map(
    await mapWithConcurrency(
      [...requestedContexts],
      PROVIDER_CONCURRENCY_LIMIT,
      async ([key, context]) => {
        const request = {
          externalPlaceId: context.externalPlaceId,
          languageCode: context.languageCode,
          regionCode: context.regionCode,
          signal,
        };
        if (context.evidence) {
          await rememberPlaceEvidence(request, context.evidence);
          return [key, context.evidence] as const;
        }
        return [
          key,
          placesService ? await placesService.getDetails({ ...request, detail: 'evidence' }) : null,
        ] as const;
      },
    ),
  );
  const intervals = new Map<string, PlanScoreInterval[]>();
  const ratings = new Map<string, number>();
  const scoringPlaces = new Map<string, ScoringPlace>();
  const hours = new Map<string, ScoringHours>();

  for (const day of draft.days) {
    const retained: AiPlannerDraftItem[] = [];
    for (const item of day.items) {
      const context = item.placeRefId ? contexts.get(item.placeRefId) : null;
      if (!context || item.blockType !== 'activity') {
        retained.push(item);
        continue;
      }
      const result = details.get(contextKey(context)) ?? null;
      const opening = openingEvidence(item, day.date, result);
      if (opening.evidence.status === 'not_checked' && providerTimeAllowanceExpired(signal)) {
        opening.evidence.code = 'provider_time_allowance_exhausted';
      }
      const evaluated = opening.intervals
        ? evaluateFeasibility({
            commitments: [],
            items: [feasibilityItem(item, opening.intervals, null)],
          })
        : null;
      const conflict = evaluated?.conflicts.find((entry) => entry.kind === 'OUTSIDE_OPENING_HOURS');
      if (conflict) {
        opening.evidence.status = 'conflict';
        opening.evidence.code = 'outside_opening_hours';
        const hard = isHardItem(item, proposal);
        draft.warnings.push({
          code: 'outside_opening_hours',
          evidenceIds: [opening.evidence.id],
          id: scopedId('warning', `hours:${day.date}:${item.id}`),
          itemIds: [item.id],
          material: hard || conflict.severity !== 'SOFT',
        });
        if (!hard) {
          draft.unscheduledItems.push(item);
          draft.evidence.push(opening.evidence);
          continue;
        }
      } else if (opening.evidence.status !== 'verified') {
        draft.warnings.push({
          code: opening.evidence.code ?? 'opening_hours_not_checked',
          evidenceIds: [opening.evidence.id],
          id: scopedId('warning', `hours:${day.date}:${item.id}`),
          itemIds: [item.id],
          material: false,
        });
      }
      if (opening.intervals) intervals.set(item.id, opening.intervals);
      if (item.placeRefId && result?.status === 'ok' && result.place.rating !== null) {
        ratings.set(item.placeRefId, result.place.rating);
      }
      if (item.placeRefId && result?.status === 'ok') {
        const place = result.place;
        const source = result.freshness.source === 'cache' ? 'CACHED_PROVIDER' : 'FRESH_PROVIDER';
        scoringPlaces.set(item.placeRefId, {
          tripPlaceId: item.placeRefId,
          name: place.name,
          types: place.rawTypes,
          coordinates: place.location,
          source,
          rating:
            place.rating === null
              ? { status: 'UNKNOWN' }
              : {
                  status: 'KNOWN',
                  rating: place.rating,
                  reviewCount: place.userRatingCount,
                  source,
                },
        });
        hours.set(item.placeRefId, {
          periods: place.openingPeriods,
          utcOffsetMinutes: place.utcOffsetMinutes,
          timeZone: place.location ? timeZoneAtCoordinates(place.location) : null,
          fetchedAt: result.freshness.fetchedAt,
          currentPeriods: place.currentOpeningPeriods,
          validFrom: place.currentHoursValidFrom,
          validThrough: place.currentHoursValidThrough,
          source,
        });
      }
      draft.evidence.push(opening.evidence);
      retained.push(item);
    }
    day.items = retained;
  }
  return { intervals, ratings, scoringPlaces, hours };
}

/**
 * Returns the travel evidence it already computed. The legs were paid for to
 * find transition conflicts; scoring reads the same numbers rather than asking
 * for them again.
 */
async function addRouteEvidence(
  draft: AiPlannerDraft,
  proposal: AiPlannerModelProposal,
  contexts: Map<string, GroundedPlaceContext>,
  intervals: Map<string, PlanScoreInterval[]>,
  routesService: RoutesService | null,
  signal?: AbortSignal,
): Promise<{
  inbound: Map<string, number>;
  segments: Map<string, PlanScoreRouteSegment[]>;
}> {
  type RouteResult = Awaited<ReturnType<RoutesService['computeRoute']>> | null;
  const routeRequests = new Map<
    string,
    { destination: GroundedPlaceContext['location']; origin: GroundedPlaceContext['location'] }
  >();
  for (const day of draft.days) {
    for (let index = 1; index < day.items.length; index += 1) {
      const previous = day.items[index - 1]!;
      const next = day.items[index]!;
      const origin = previous.placeRefId ? contexts.get(previous.placeRefId) : null;
      const destination = next.placeRefId ? contexts.get(next.placeRefId) : null;
      if (!origin || !destination) continue;
      const key = `${origin.location.latitude}:${origin.location.longitude}:${destination.location.latitude}:${destination.location.longitude}`;
      routeRequests.set(key, { destination: destination.location, origin: origin.location });
    }
  }
  const routeResults = new Map<string, RouteResult>(
    await mapWithConcurrency(
      [...routeRequests],
      PROVIDER_CONCURRENCY_LIMIT,
      async ([key, request]) => [
        key,
        routesService
          ? await routesService.computeRoute({
              ...request,
              includePolyline: false,
              mode: 'drive',
              signal,
            })
          : null,
      ],
    ),
  );

  const inboundMinutes = new Map<string, number>();
  const daySegments = new Map<string, ScoringRouteSegment[]>();

  for (const day of draft.days) {
    const inbound = new Map<string, number | null>();
    const routeEvidenceIds = new Map<string, string>();
    const segments: ScoringRouteSegment[] = [];
    daySegments.set(day.date, segments);
    for (let index = 1; index < day.items.length; index += 1) {
      const previous = day.items[index - 1]!;
      const next = day.items[index]!;
      const origin = previous.placeRefId ? contexts.get(previous.placeRefId) : null;
      const destination = next.placeRefId ? contexts.get(next.placeRefId) : null;
      const routeId = scopedId('route', `${day.date}:${previous.id}:${next.id}`);
      // A transition nobody could route is still a transition. Reporting it as
      // an unknown segment keeps the day's travel honest, where dropping it
      // would quietly score the day as if the leg took no time.
      if (!origin || !destination) {
        segments.push({ id: routeId, scope: 'LOCAL', status: 'UNKNOWN' });
        continue;
      }
      const evidenceId = scopedId('route-evidence', routeId);
      routeEvidenceIds.set(next.id, evidenceId);
      const memoKey = `${origin.location.latitude}:${origin.location.longitude}:${destination.location.latitude}:${destination.location.longitude}`;
      const result = routeResults.get(memoKey) ?? null;
      if (result?.status === 'ok') {
        const minutes = result.estimate.durationSeconds / 60;
        inbound.set(next.id, minutes);
        inboundMinutes.set(next.id, minutes);
        segments.push({
          duration: {
            minutes,
            source: result.freshness.source === 'cache' ? 'CACHED_PROVIDER' : 'FRESH_PROVIDER',
          },
          mode: 'drive',
          distanceMeters: result.estimate.distanceMeters,
          id: routeId,
          scope: 'LOCAL',
          status: 'KNOWN',
        });
      } else {
        inbound.set(next.id, null);
        segments.push({ id: routeId, scope: 'LOCAL', status: 'UNKNOWN' });
      }
      const status =
        result?.status === 'ok'
          ? 'verified'
          : result?.status === 'empty'
            ? 'unverified'
            : 'not_checked';
      const code =
        result?.status === 'ok'
          ? null
          : result?.status === 'empty'
            ? 'route_not_found'
            : providerTimeAllowanceExpired(signal)
              ? 'provider_time_allowance_exhausted'
              : result?.status === 'unavailable' && result.code === 'budget_exhausted'
                ? 'provider_cap_reached'
                : 'route_not_checked';
      draft.evidence.push({
        checkedAt: result?.status === 'ok' ? result.freshness.fetchedAt : null,
        code,
        id: evidenceId,
        kind: 'route',
        provider: result?.status === 'ok' ? 'google' : null,
        status,
        subjectId: routeId,
        subjectType: 'route',
      });
      if (status !== 'verified') {
        draft.warnings.push({
          code: code ?? 'route_not_checked',
          evidenceIds: [evidenceId],
          id: scopedId('warning', routeId),
          itemIds: [previous.id, next.id],
          material: false,
        });
      }
    }

    const noFeasibleTime = new Set(assignAiPlannerSuggestedTimes(day, intervals, inbound));
    if (noFeasibleTime.size) {
      const previousById = new Map(
        day.items.map((item, index) => [item.id, day.items[index - 1]?.id ?? null]),
      );
      day.items = day.items.filter((item) => {
        if (!noFeasibleTime.has(item.id)) return true;
        const hard = isHardItem(item, proposal);
        draft.warnings.push({
          code: 'schedule_conflict',
          evidenceIds: [],
          id: scopedId('warning', `schedule:${day.date}:${item.id}`),
          itemIds: [item.id],
          material: hard,
        });
        if (hard) return true;
        draft.unscheduledItems.push(item);
        return false;
      });
      const byId = new Map(segments.map((segment) => [segment.id, segment]));
      segments.splice(0, segments.length);
      for (let index = 1; index < day.items.length; index += 1) {
        const previous = day.items[index - 1]!;
        const next = day.items[index]!;
        const routeId = scopedId('route', `${day.date}:${previous.id}:${next.id}`);
        segments.push(byId.get(routeId) ?? { id: routeId, scope: 'LOCAL', status: 'UNKNOWN' });
        if (previousById.get(next.id) !== previous.id) {
          inbound.delete(next.id);
          inboundMinutes.delete(next.id);
        }
      }
    }

    const feasibility = evaluateFeasibility({
      commitments: [],
      items: day.items.map((item) =>
        feasibilityItem(item, intervals.get(item.id) ?? null, inbound.get(item.id) ?? null),
      ),
    });
    for (const conflict of feasibility.conflicts.filter((entry) =>
      ['ARRIVES_AFTER_FIXED_START', 'TIGHT_TRANSITION'].includes(entry.kind),
    )) {
      const evidenceIds = conflict.subjectIds.flatMap((itemId) => {
        const id = routeEvidenceIds.get(itemId);
        if (!id) return [];
        const evidence = draft.evidence.find((entry) => entry.id === id);
        if (evidence) {
          evidence.status = 'conflict';
          evidence.code = conflict.kind.toLowerCase();
        }
        return [id];
      });
      const hard = conflict.subjectIds.every((itemId) => {
        const item = day.items.find((entry) => entry.id === itemId);
        return item ? isHardItem(item, proposal) : false;
      });
      draft.warnings.push({
        code: conflict.kind.toLowerCase(),
        evidenceIds,
        id: scopedId('warning', `route-conflict:${day.date}:${conflict.id}`),
        itemIds: conflict.subjectIds,
        material: hard || conflict.severity !== 'SOFT',
      });
    }
  }

  return { inbound: inboundMinutes, segments: daySegments };
}

/** Mirrors `toDayPlaces`, keyed on the draft's place references. */
function draftDayPlaces(
  day: AiPlannerDraft['days'][number],
  ratings: Map<string, number>,
): PlanScorePlace[] {
  const placeRefIds = [
    ...new Set(day.items.flatMap((item) => (item.placeRefId ? [item.placeRefId] : []))),
  ];
  return placeRefIds.map((placeRefId) => {
    const rating = ratings.get(placeRefId);
    return {
      rating:
        rating === undefined
          ? { status: 'UNKNOWN' as const }
          : { rating, source: 'FRESH_PROVIDER' as const, status: 'KNOWN' as const },
      tripPlaceId: placeRefId,
    };
  });
}

/**
 * Scores the finished draft from the evidence validation already gathered, so a
 * Plan Score costs no provider request of its own. This is the one pass that
 * sees both halves at once: the hours check runs before routes exist, and the
 * transition check runs before the day is final, so neither can stand in for a
 * judgement of the whole day.
 */
function scoreDraft(
  draft: AiPlannerDraft,
  evidence: {
    inbound: Map<string, number>;
    intervals: Map<string, PlanScoreInterval[]>;
    ratings: Map<string, number>;
    segments: Map<string, ScoringRouteSegment[]>;
    scoringPlaces: Map<string, ScoringPlace>;
    hours: Map<string, ScoringHours>;
  },
  evaluatedAt: Date,
) {
  const scoredItems = new Set(draft.days.flatMap((day) => day.items.map((item) => item.id)));
  const scoredRoutes = new Set(
    [...evidence.segments.values()].flatMap((segments) => segments.map((segment) => segment.id)),
  );
  const scheduledIds = [
    ...new Set(
      draft.days.flatMap((day) =>
        day.items.flatMap((item) => (item.placeRefId ? [item.placeRefId] : [])),
      ),
    ),
  ];
  // An unscheduled Must Go is exactly what this factor exists to notice, so the
  // wanted set spans the whole draft while the scheduled set spans only days.
  const mustGoIds = [
    ...new Set(
      [...draft.days.flatMap((day) => day.items), ...draft.unscheduledItems].flatMap((item) =>
        item.priority === 'must_go' && item.placeRefId ? [item.placeRefId] : [],
      ),
    ),
  ];

  const score = buildPlanScoreFromEvaluations({
    evaluatedAt,
    evidenceDeadlines: placeHoursDeadlines(
      evidence.hours,
      draft.days.map((d) => ({
        date: d.date,
        items: d.items.map((i) => ({ tripPlaceId: i.placeRefId, blockType: i.blockType })),
      })),
    ),
    evidenceTimes: draft.evidence.flatMap((entry) =>
      entry.checkedAt &&
      ((entry.kind === 'opening_hours' && scoredItems.has(entry.subjectId)) ||
        (entry.kind === 'route' && scoredRoutes.has(entry.subjectId)))
        ? [entry.checkedAt]
        : [],
    ),
    days: draft.days.map((day) => {
      const zoneByRef = new Map(
        draft.places.map((place) => [
          place.id,
          (place.resolution === 'verified' && place.location
            ? timeZoneAtCoordinates(place.location)
            : null) ?? resolveCountryPrimaryTimeZone(place.name),
        ]),
      );
      const zone =
        (day.dailyBasePlaceRefId ? zoneByRef.get(day.dailyBasePlaceRefId) : null) ??
        day.items.map((i) => (i.placeRefId ? zoneByRef.get(i.placeRefId) : null)).find(Boolean) ??
        draft.trip.destinations.map((d) => zoneByRef.get(d.placeRefId)).find(Boolean) ??
        'UTC';
      const raw = day.items.map((item, index) => ({
        ...feasibilityItem(
          item,
          evidence.intervals.get(item.id) ?? null,
          evidence.inbound.get(item.id) ?? null,
        ),
        placeId: item.placeRefId ?? undefined,
        inboundRequired: index > 0 || Boolean(draftDayStay(day).start),
      }));
      // Generation already acquires inter-item routes. Base legs are required by the
      // ordinary itinerary but are not purchased to improve a draft's score.
      const segments = [...(evidence.segments.get(day.date) ?? [])];
      if (day.items.length && draftDayStay(day).start)
        segments.unshift({ id: `base-start:${day.date}`, scope: 'LOCAL', status: 'UNKNOWN' });
      if (day.items.length && draftDayStay(day).end)
        segments.push({ id: `base-return:${day.date}`, scope: 'LOCAL', status: 'UNKNOWN' });
      const zones = new Map(
        day.items.flatMap((item) =>
          item.placeRefId && zoneByRef.get(item.placeRefId)
            ? [[item.id, zoneByRef.get(item.placeRefId)!] as const]
            : [],
        ),
      );
      return {
        date: day.date,
        evaluation: evaluateScoredDay({
          commitments: [],
          dayId: day.date,
          date: day.date,
          timeZone: zone,
          originInstant: dayOrigin(day.date, zone),
          items: normalizeScoringItems(day.date, zone, raw, { zones, hours: evidence.hours }),
          places: draftDayPlaces(day, evidence.ratings).map(
            (place) =>
              evidence.scoringPlaces.get(place.tripPlaceId) ?? {
                ...place,
                name: draft.places.find((p) => p.id === place.tripPlaceId)?.name,
              },
          ),
          segments,
          preferences: planningPreferencesFromAi(
            draft.normalizedRequest,
            draft.trip.paceSource === 'user',
            draft.assumptions.some((a) => a.code === 'interest_inferred'),
          ),
        }),
      };
    }),
    mustGoIds,
    scheduledIds,
  });
  return {
    ...withholdNonCurrentPlanScore(score, evaluatedAt),
    sourceInputRevision: draftPlanScoreInputRevision(draft),
    presentation: score.presentation
      ? {
          ...score.presentation,
          referenceTargets: planScoreReferenceTargets(score, {
            items: [
              ...draft.days.flatMap((day) =>
                day.items.map((item) => ({ id: item.id, dayId: day.date })),
              ),
              ...draft.unscheduledItems.map((item) => ({ id: item.id, dayId: null })),
            ],
            reservationIds: [],
            tripPlaceIds: draft.places.map((place) => place.id),
          }),
          revisions: {
            ...score.presentation.revisions,
            planning: draftPlanScoreInputRevision(draft),
            evidence: scoringInputRevision({
              hours: [...evidence.hours],
              ratings: [...evidence.ratings],
              places: [...evidence.scoringPlaces],
              segments: [...evidence.segments],
              times: draft.evidence
                .filter((entry) => entry.kind === 'opening_hours' || entry.kind === 'route')
                .map((entry) => [entry.subjectId, entry.checkedAt]),
            }),
          },
        }
      : undefined,
  };
}

async function validateWithProviderEvidence(
  draft: AiPlannerDraft,
  proposal: AiPlannerModelProposal,
  grounding: GroundedCandidate[],
  providerContext: ProviderContext,
  signal?: AbortSignal,
  clock: () => Date = () => new Date(),
) {
  const contexts = new Map(
    grounding.flatMap((result) =>
      result.context ? ([[result.place.id, result.context]] as const) : [],
    ),
  );
  const { intervals, ratings, scoringPlaces, hours } = await addOpeningEvidence(
    draft,
    proposal,
    contexts,
    providerContext.placesService,
    signal,
  );
  const { inbound, segments } = await addRouteEvidence(
    draft,
    proposal,
    contexts,
    intervals,
    providerContext.routesService,
    signal,
  );
  const validated = validateAiPlannerDraft(draft);
  if (!validated.success) {
    throw new AiPlanningPipelineFailure(
      validated.issues.some((issue) =>
        ['conflicting_hard_constraints', 'overlapping_items'].includes(issue.code),
      )
        ? 'schedule_conflict'
        : 'invalid_response',
      null,
      validated.issues.map((issue) => issue.code),
      validated.issues.map((issue) => safeIssuePath(issue.path)),
    );
  }

  return {
    draft: validated.data,
    planScore: scoreDraft(
      validated.data,
      { inbound, intervals, ratings, segments, scoringPlaces, hours },
      clock(),
    ),
  };
}

function defaultLifecycle(
  options: Pick<AiPlanningPipelineOptions, 'clock' | 'environment'>,
): PlanningLifecycle {
  const lifecycleOptions = { now: options.clock };
  return {
    claim: (ownerId, runId) =>
      claimAiPlanningDispatch(ownerId, runId, {
        ...lifecycleOptions,
        environment: options.environment,
      }),
    completeFailure: (ownerId, runId, code, metadata, details) =>
      completeAiPlanningRunFailure(ownerId, runId, code, metadata, lifecycleOptions, details),
    completeSuccess: (ownerId, runId, draft, planScore, metadata) =>
      completeAiPlanningRunSuccess(ownerId, runId, draft, planScore, metadata, lifecycleOptions),
    updateStage: (ownerId, runId, stage) =>
      updateAiPlanningStage(ownerId, runId, stage, lifecycleOptions),
  };
}

function failureFrom(error: unknown, metadata: AiGenerationMetadata | null) {
  if (error instanceof AiPlanningPipelineFailure) {
    return { code: error.code, metadata: error.metadata ?? metadata };
  }
  if (error instanceof AiGenerationError) return { code: error.code, metadata: error.metadata };
  if (error instanceof AiPlanningSessionError) {
    return {
      code: error.code === 'draft_invalid' ? ('invalid_response' as const) : ('cancelled' as const),
      metadata,
    };
  }
  return { code: 'provider_unavailable' as const, metadata };
}

/** Best-effort same-instance cancellation; persistence guards remain authoritative. */
export function abortActiveAiPlanningSession(sessionId: string) {
  activeRuns.get(sessionId)?.abort();
}

/**
 * Runs one already-reserved Generate/Regenerate action. Claiming is deliberately
 * the first side effect: quota, kill switches, expiry, and duplicate dispatches
 * are all decided before a model or Google request can leave the API.
 */
export async function runAiPlanningPipeline(
  ownerId: string,
  runId: string,
  options: AiPlanningPipelineOptions = {},
) {
  const clock = options.clock ?? (() => new Date());
  const lifecycle = options.lifecycle ?? defaultLifecycle(options);
  const claim = await lifecycle.claim(ownerId, runId);
  const controller = new AbortController();
  activeRuns.set(claim.sessionId, controller);
  let metadata: AiGenerationMetadata | null = null;
  let stage = 'generating';
  let deadlineReached = false;
  let providerAllowanceTimer: ReturnType<typeof setTimeout> | null = null;
  const deadlineTimer = claim.deadlineAt
    ? setTimeout(
        () => {
          deadlineReached = true;
          controller.abort();
        },
        Math.max(0, claim.deadlineAt.getTime() - clock().getTime()),
      )
    : null;
  const generationDate = clock();

  try {
    const [homeLocation, providerContext] = await Promise.all([
      (options.loadHomeLocation ?? loadHomeLocation)(ownerId),
      Promise.resolve(
        options.providerContext ??
          createAiPlannerProviderContext({ environment: options.environment }),
      ),
    ]);
    const gateway = options.gateway ?? createAiGateway({ environment: options.environment });
    const promptContext = buildAiPlannerContext({ generationDate, homeLocation });
    const generation = await gateway.generateStructured({
      prompt: buildAiPlannerPrompt(claim.prompt, promptContext),
      schema: aiPlannerCompactProposalSchema,
      schemaDescription: AI_PLANNER_SCHEMA_DESCRIPTION,
      schemaName: 'trove_ai_planner_compact_v1',
      signal: controller.signal,
    });
    metadata = generation.metadata;
    let expanded: AiPlannerModelProposal;
    try {
      const compact = aiPlannerCompactProposalSchema.safeParse(generation.output);
      if (!compact.success) {
        throw new AiPlanningPipelineFailure(
          'invalid_response',
          metadata,
          compact.error.issues.map((issue) => issue.code),
          compact.error.issues.map((issue) => safeIssuePath(issue.path)),
        );
      }
      expanded = expandAiPlannerProposal(compact.data, claim.prompt);
    } catch (error) {
      if (error instanceof AiPlannerCompactReferenceError) {
        throw new AiPlanningPipelineFailure(
          'invalid_response',
          metadata,
          ['dangling_reference'],
          [error.path],
        );
      }
      if (error instanceof AiPlanningPipelineFailure) throw error;
      throw new AiPlanningPipelineFailure('invalid_response', metadata);
    }
    const proposal = validateAiPlannerModelProposal(expanded);

    if (!proposal.success) {
      throw new AiPlanningPipelineFailure(
        'invalid_response',
        metadata,
        proposal.issues.map((issue) => issue.code),
        proposal.issues.map((issue) => safeIssuePath(issue.path)),
      );
    }
    if (controller.signal.aborted)
      throw new AiPlanningPipelineFailure(deadlineReached ? 'timeout' : 'cancelled', metadata);
    stage = 'scheduling';
    await lifecycle.updateStage(ownerId, runId, 'SCHEDULING');
    let draft: AiPlannerDraft;
    try {
      draft = assembleAiPlanningDraft(proposal.data, generationDate);
    } catch {
      throw new AiPlanningPipelineFailure('invalid_response', metadata);
    }
    recordAiPlanningProposalCoverage(
      coveredDayCount(proposal.data.items),
      draft.days.length,
      isSparseProposal(proposal.data),
      generationDate,
    );

    // Grounding follows scheduling so a lookup is only ever spent on a place the
    // finished day-to-day itinerary actually stands on.
    if (controller.signal.aborted)
      throw new AiPlanningPipelineFailure(deadlineReached ? 'timeout' : 'cancelled', metadata);
    stage = 'grounding';
    await lifecycle.updateStage(ownerId, runId, 'GROUNDING');
    const providerAllowance = new AbortController();
    if (claim.deadlineAt) {
      providerAllowanceTimer = setTimeout(
        () => providerAllowance.abort('provider_time_allowance_exhausted'),
        Math.max(0, claim.deadlineAt.getTime() - clock().getTime() - 5_000),
      );
    }
    const providerSignal = AbortSignal.any([controller.signal, providerAllowance.signal]);
    const grounding = await (options.groundCandidates ?? groundCandidates)(
      proposal.data,
      providerContext,
      groundableDraftPlaceIds(draft),
      new Set(
        draft.days.flatMap((day) =>
          day.items.flatMap((item) => (item.placeRefId ? [item.placeRefId] : [])),
        ),
      ),
      providerSignal,
    );
    applyGroundingToDraft(draft, grounding);
    dropUnverifiedDraftStays(draft);

    if (controller.signal.aborted)
      throw new AiPlanningPipelineFailure(deadlineReached ? 'timeout' : 'cancelled', metadata);
    stage = 'validating';
    await lifecycle.updateStage(ownerId, runId, 'VALIDATING');
    const validated = await validateWithProviderEvidence(
      draft,
      proposal.data,
      grounding,
      providerContext,
      providerSignal,
      clock,
    );
    recordAiPlanningDraftAssembled(validated.draft, generationDate);
    if (controller.signal.aborted)
      throw new AiPlanningPipelineFailure(deadlineReached ? 'timeout' : 'cancelled', metadata);
    await lifecycle.completeSuccess(ownerId, runId, validated.draft, validated.planScore, metadata);
  } catch (error) {
    const failure = failureFrom(error, metadata);
    const details: AiRunFailureDetails = {
      stage,
      validationCodes: error instanceof AiPlanningPipelineFailure ? error.validationCodes : [],
      validationPaths: error instanceof AiPlanningPipelineFailure ? error.validationPaths : [],
    };
    await lifecycle.completeFailure(
      ownerId,
      runId,
      deadlineReached ? 'timeout' : controller.signal.aborted ? 'cancelled' : failure.code,
      failure.metadata,
      details,
    );
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
    if (providerAllowanceTimer) clearTimeout(providerAllowanceTimer);
    if (activeRuns.get(claim.sessionId) === controller) activeRuns.delete(claim.sessionId);
  }
}
