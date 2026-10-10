import { EntitlementError, plannerContractMaxDays } from './plan-entitlements.js';
import { checkAiPlannerDateDays } from './ai-planner-preflight.js';
import { createHash } from 'node:crypto';

import { getPrismaClient } from '@trove/db';
import {
  AI_PLANNER_MAX_REAL_PLACE_ITEMS,
  type AiPlannerDraft,
  type AiPlannerDraftItem,
  type AiPlannerEvidence,
  type AiPlannerLegMode,
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
  createAiPlannerCompactProposalSchema,
  expandAiPlannerProposal,
} from './ai-planner-compact.js';
import { AiPlannerRepairLog } from './ai-planner-repair-log.js';
import { repairAiPlannerModelProposal, repairCompactOutput } from './ai-planner-repair.js';
import { createCanonicalPlacesService } from './canonical-places.js';
import { finalizeDraftDayTitles } from './ai-planning-day-titles.js';
import { readDraftPlanScore } from './ai-draft-score-reader.js';
import { draftDayStay } from './ai-planning-plan-score.js';
import { preferredLegMode } from './ai-planning-travel-modes.js';
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
  groundFromKnownPlaces,
  type AiPlaceGroundingResult,
  type GroundedPlaceContext,
  type KnownPlace,
} from './ai-place-grounding.js';
import { loadSavedPlacesForPlanner, plannerSavedPlaces } from './ai-planner-saved-places.js';
import { createAiPlannerProviderContext } from './ai-planner-provider-context.js';
import type { TripPlanScore } from './plan-score.js';
import { groundableDraftPlaceIds, referencedDraftPlaceIds } from './ai-planning-draft-places.js';
import {
  recordAiPlanningDraftAssembled,
  recordAiPlanningProposalCoverage,
  recordAiPlanningProposalRepaired,
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
import { enumerateDateRange } from './trip-rules.js';
import { timeZoneAtCoordinates } from './coordinate-time-zone.js';
import type { ScoringHours } from './plan-score-normalization.js';
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
    knownPlaces?: readonly KnownPlace[],
  ) => Promise<GroundedCandidate[]>;
  lifecycle?: PlanningLifecycle;
  loadHomeLocation?: (ownerId: string) => Promise<string | null>;
  /** The traveller's Saved Places the planner may prefer; storage only. */
  loadSavedPlaces?: (ownerId: string, now: Date) => Promise<KnownPlace[]>;
  providerContext?: ProviderContext;
  /** Test seam; production always uses the shared cache-only draft reader. */
  readDraftScore?: typeof readDraftPlanScore;
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
  knownPlaces: readonly KnownPlace[] = [],
): Promise<GroundedCandidate[]> {
  const targets = proposal.places.filter((candidate) => targetIds.has(candidate.id));
  if (targets.length === 0) return [];

  const localities = candidateLocalities(proposal);
  const destinationPlaceIds = new Set(
    proposal.destinations.map((destination) => destination.candidatePlaceId),
  );
  const prepared = targets.map((candidate) => ({
    ...candidate,
    detail: scheduledPlaceIds.has(candidate.id) ? ('evidence' as const) : ('location' as const),
    localityHint: localities.get(candidate.id),
    requireExactName: destinationPlaceIds.has(candidate.id),
    signal,
  }));

  // A place the traveller already saved is grounded on what Trove stored for
  // it, with no Text Search; only the rest go to the provider.
  const known = new Map(
    prepared.flatMap((candidate) => {
      const result = groundFromKnownPlaces(candidate, knownPlaces);
      return result ? [[candidate.id, result] as const] : [];
    }),
  );
  const remaining = prepared.filter((candidate) => !known.has(candidate.id));
  const searched = !remaining.length
    ? []
    : providerContext.placesProvider
      ? await new AiPlaceGrounder(
          providerContext.placesProvider,
          createCanonicalPlacesService(),
        ).groundCandidates(remaining)
      : remaining.map(unavailableGrounding);

  const byId = new Map(searched.map((result, index) => [remaining[index]!.id, result]));
  return prepared.map((candidate) => known.get(candidate.id) ?? byId.get(candidate.id)!);
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
  // Hard items sort first, so one only reaches here when the traveller named
  // more real places than a run may look up. It keeps its slot in the plan as
  // a Custom Place, like any other over the cap.
  for (const item of ordered.slice(AI_PLANNER_MAX_REAL_PLACE_ITEMS)) {
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
      material: false,
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
 * No two timed items on a day may overlap, and the plan settles that itself
 * rather than handing the traveller a contradiction to sort out. Of each
 * overlapping pair a suggestion gives way first, moving to Unscheduled. Two of
 * the traveller's own commitments cannot both stand at once: the earlier keeps
 * its time and the later starts as soon as the earlier ends, its constraint
 * relaxed to flexible so the plan no longer claims to hold the original time,
 * and a note names both so the change is never silent.
 */
export function resolveScheduleOverlaps(
  draft: AiPlannerDraft,
  proposal: AiPlannerModelProposal,
  log = new AiPlannerRepairLog(),
) {
  const constraints = new Map(
    proposal.normalizedRequest.constraints.map((constraint) => [constraint.id, constraint]),
  );
  for (const day of draft.days) {
    for (let guard = 0; guard <= day.items.length; guard += 1) {
      const timed = day.items
        .flatMap((item) =>
          item.schedule.kind === 'exact'
            ? [{ item, start: minuteOfDay(item.schedule.localTime) }]
            : [],
        )
        .sort((left, right) => left.start - right.start);
      let pair: [(typeof timed)[number], (typeof timed)[number]] | null = null;
      for (let left = 0; left < timed.length && !pair; left += 1) {
        for (let right = left + 1; right < timed.length; right += 1) {
          const a = timed[left]!;
          const b = timed[right]!;
          if (b.start < a.start + a.item.durationMinutes) {
            pair = [a, b];
            break;
          }
        }
      }
      if (!pair) break;
      const [earlier, later] = pair;
      const suggestion = [later, earlier].find(
        ({ item }) => item.origin === 'model' && !isHardItem(item, proposal),
      );
      if (suggestion) {
        day.items = day.items.filter((item) => item.id !== suggestion.item.id);
        draft.unscheduledItems.push(suggestion.item);
        draft.warnings.push({
          code: 'schedule_conflict',
          evidenceIds: [],
          id: scopedId('warning', `schedule:${day.date}:${suggestion.item.id}`),
          itemIds: [suggestion.item.id],
          material: false,
        });
        log.add('overlap_unscheduled');
        continue;
      }

      const moved = later.item;
      for (const id of moved.constraintIds) {
        const constraint = constraints.get(id);
        if (constraint?.strength === 'hard') constraint.strength = 'flexible';
      }
      const end = earlier.start + earlier.item.durationMinutes;
      const start =
        Math.ceil(end / SUGGESTED_TIME_ROUNDING_MINUTES) * SUGGESTED_TIME_ROUNDING_MINUTES;
      draft.warnings.push({
        code: 'schedule_adjusted',
        evidenceIds: [],
        id: scopedId('warning', `adjusted:${day.date}:${earlier.item.id}:${moved.id}`),
        itemIds: [earlier.item.id, moved.id],
        material: false,
      });
      log.add('commitment_retimed');
      if (start + moved.durationMinutes <= 1_440) {
        moved.schedule = { kind: 'exact', localTime: localTimeFromMinutes(start), source: 'model' };
        day.items.sort((left, right) => scheduleRank(left) - scheduleRank(right));
      } else {
        // No room left in the day: it stays the traveller's item, unscheduled.
        day.items = day.items.filter((item) => item.id !== moved.id);
        draft.unscheduledItems.push(moved);
      }
    }
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
  log = new AiPlannerRepairLog(),
  maxItineraryDays = plannerContractMaxDays(),
): AiPlannerDraft {
  const defaults = resolveAiPlannerDefaults(
    proposal.normalizedRequest,
    proposal,
    generationDate,
    maxItineraryDays,
  );
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
  resolveScheduleOverlaps(draft, proposal, log);
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
          material: false,
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
  log = new AiPlannerRepairLog(),
): Promise<{
  inbound: Map<string, number>;
  legModes: Map<string, AiPlannerLegMode>;
  segments: Map<string, PlanScoreRouteSegment[]>;
}> {
  type RouteResult = Awaited<ReturnType<RoutesService['computeRoute']>> | null;
  type RoutedLeg = { mode: AiPlannerLegMode; result: RouteResult };
  const legKey = (
    origin: GroundedPlaceContext['location'],
    destination: GroundedPlaceContext['location'],
  ) => `${origin.latitude}:${origin.longitude}:${destination.latitude}:${destination.longitude}`;
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
      routeRequests.set(legKey(origin.location, destination.location), {
        destination: destination.location,
        origin: origin.location,
      });
    }
  }
  // Each leg is routed the way a traveller would make it: walked when short,
  // by public transport across a city. Only where the provider finds no such
  // route is the same leg asked again by car, so a leg costs one call unless
  // the area has no transit at all.
  const routeResults = new Map<string, RoutedLeg>(
    await mapWithConcurrency(
      [...routeRequests],
      PROVIDER_CONCURRENCY_LIMIT,
      async ([key, request]): Promise<[string, RoutedLeg]> => {
        const preferred = preferredLegMode(request.origin, request.destination);
        if (!routesService) return [key, { mode: preferred, result: null }];
        const route = (mode: AiPlannerLegMode) =>
          routesService.computeRoute({ ...request, includePolyline: false, mode, signal });
        const result = await route(preferred);
        if (result.status !== 'empty' || preferred === 'drive') {
          return [key, { mode: preferred, result }];
        }
        return [key, { mode: 'drive', result: await route('drive') }];
      },
    ),
  );

  const inboundMinutes = new Map<string, number>();
  const legModes = new Map<string, AiPlannerLegMode>();
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
      const routed = routeResults.get(legKey(origin.location, destination.location)) ?? null;
      const result = routed?.result ?? null;
      if (routed) legModes.set(`${day.date}:${previous.id}:${next.id}`, routed.mode);
      if (result?.status === 'ok') {
        const minutes = result.estimate.durationSeconds / 60;
        inbound.set(next.id, minutes);
        inboundMinutes.set(next.id, minutes);
        segments.push({
          duration: {
            minutes,
            source: result.freshness.source === 'cache' ? 'CACHED_PROVIDER' : 'FRESH_PROVIDER',
          },
          mode: routed!.mode,
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

    const previousById = new Map(
      day.items.map((item, index) => [item.id, day.items[index - 1]?.id ?? null]),
    );
    const plannedSchedules = new Map(day.items.map((item) => [item.id, item.schedule]));
    let noFeasibleTime = new Set(assignAiPlannerSuggestedTimes(day, intervals, inbound));
    let removed = false;
    // The traveller's own commitment is never the one to give way. A suggestion
    // crowding it out moves to Unscheduled, nearest first, and the day is timed
    // again from its planned dayparts, until the commitment fits or nothing
    // movable is left in front of it.
    for (;;) {
      const blocked = day.items.find(
        (item) => noFeasibleTime.has(item.id) && isHardItem(item, proposal),
      );
      if (!blocked) break;
      const at = day.items.indexOf(blocked);
      const partOf = (item: AiPlannerDraftItem) => {
        const planned = plannedSchedules.get(item.id);
        return planned?.kind === 'day_part' ? planned.dayPart : null;
      };
      // Only a suggestion competing for the same part of the day can make room.
      const competes = (item: AiPlannerDraftItem) =>
        [partOf(item), partOf(blocked)].includes('anytime') || partOf(item) === partOf(blocked);
      const movable = (item: AiPlannerDraftItem) =>
        item.id !== blocked.id &&
        !isHardItem(item, proposal) &&
        item.origin === 'model' &&
        competes(item);
      const yielding =
        day.items.slice(0, at).findLast(movable) ?? day.items.slice(at + 1).find(movable);
      if (!yielding) break;
      day.items = day.items.filter((item) => item.id !== yielding.id);
      draft.unscheduledItems.push(yielding);
      draft.warnings.push({
        code: 'schedule_conflict',
        evidenceIds: [],
        id: scopedId('warning', `schedule:${day.date}:${yielding.id}`),
        itemIds: [yielding.id],
        material: false,
      });
      log.add('blocking_item_unscheduled');
      removed = true;
      for (const item of day.items) item.schedule = plannedSchedules.get(item.id) ?? item.schedule;
      for (const [index, item] of day.items.entries()) {
        if (previousById.get(item.id) !== (day.items[index - 1]?.id ?? null)) {
          inbound.delete(item.id);
          inboundMinutes.delete(item.id);
        }
      }
      noFeasibleTime = new Set(assignAiPlannerSuggestedTimes(day, intervals, inbound));
    }
    const rechain = () => {
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
    };
    const unschedule = (item: AiPlannerDraftItem) => {
      draft.unscheduledItems.push(item);
      draft.warnings.push({
        code: 'schedule_conflict',
        evidenceIds: [],
        id: scopedId('warning', `schedule:${day.date}:${item.id}`),
        itemIds: [item.id],
        material: false,
      });
    };
    if (noFeasibleTime.size || removed) {
      day.items = day.items.filter((item) => {
        if (!noFeasibleTime.has(item.id)) return true;
        // A commitment that still cannot be timed keeps the traveller's own
        // daypart; it is theirs to keep, not the plan's to drop.
        if (isHardItem(item, proposal)) return true;
        unschedule(item);
        return false;
      });
      rechain();
    }

    const transitionConflicts = () =>
      evaluateFeasibility({
        commitments: [],
        items: day.items.map((item) =>
          feasibilityItem(item, intervals.get(item.id) ?? null, inbound.get(item.id) ?? null),
        ),
      }).conflicts.filter((entry) =>
        ['ARRIVES_AFTER_FIXED_START', 'TIGHT_TRANSITION'].includes(entry.kind),
      );
    let conflicts = transitionConflicts();
    // A suggestion that cannot be reached in time gives way, the later one of
    // each pair, so the plan never asks the traveller to be in two places.
    const yielding = new Set(
      conflicts.flatMap((conflict) => {
        const movable = day.items.filter(
          (item) =>
            conflict.subjectIds.includes(item.id) &&
            item.origin === 'model' &&
            !isHardItem(item, proposal),
        );
        return movable.length ? [movable.at(-1)!.id] : [];
      }),
    );
    if (yielding.size) {
      day.items = day.items.filter((item) => {
        if (!yielding.has(item.id)) return true;
        unschedule(item);
        log.add('blocking_item_unscheduled');
        return false;
      });
      rechain();
      conflicts = transitionConflicts();
    }
    for (const conflict of conflicts) {
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
      draft.warnings.push({
        code: conflict.kind.toLowerCase(),
        evidenceIds,
        id: scopedId('warning', `route-conflict:${day.date}:${conflict.id}`),
        itemIds: conflict.subjectIds,
        material: false,
      });
    }
    assignDraftLegModes(day, contexts, legModes);
  }

  return { inbound: inboundMinutes, legModes, segments: daySegments };
}

/**
 * Records how each of the day's legs is travelled, over the same chain the
 * applied itinerary routes: stay to first located stop, located stop to the
 * next, last located stop back to the stay. A leg the run routed keeps the
 * mode it was routed with; any other is chosen by distance alone, which costs
 * nothing.
 */
export function assignDraftLegModes(
  day: AiPlannerDraft['days'][number],
  contexts: ReadonlyMap<string, Pick<GroundedPlaceContext, 'location'>>,
  /** Modes legs were routed with, keyed `date:fromItemId:toItemId`. */
  routedModes: ReadonlyMap<string, AiPlannerLegMode> = new Map(),
) {
  // A re-chained day is assigned afresh, so no leg keeps a mode for a
  // neighbour it no longer has.
  for (const item of day.items) delete item.travelModeToNext;
  delete day.routeStartTravelMode;
  const locate = (placeRefId: string | null) =>
    placeRefId ? (contexts.get(placeRefId)?.location ?? null) : null;
  const located = day.items.flatMap((item) => {
    const location = locate(item.placeRefId);
    return location ? [{ item, location }] : [];
  });
  const stay = draftDayStay(day);
  const start = locate(stay.start);
  const end = locate(stay.end);
  const first = located[0];
  if (start && first) day.routeStartTravelMode = preferredLegMode(start, first.location);
  located.forEach(({ item, location }, index) => {
    const next = located[index + 1];
    if (next) {
      item.travelModeToNext =
        routedModes.get(`${day.date}:${item.id}:${next.item.id}`) ??
        preferredLegMode(location, next.location);
    } else if (end) {
      item.travelModeToNext = preferredLegMode(location, end);
    }
  });
}

const HARD_CONSTRAINT_ISSUES = new Set([
  'conflicting_hard_constraints',
  'hard_constraint_changed',
  'hard_constraint_missing',
  'hard_constraint_unscheduled',
]);

async function validateWithProviderEvidence(
  draft: AiPlannerDraft,
  proposal: AiPlannerModelProposal,
  grounding: GroundedCandidate[],
  providerContext: ProviderContext,
  signal?: AbortSignal,
  log = new AiPlannerRepairLog(),
  maxItineraryDays = plannerContractMaxDays(),
) {
  const contexts = new Map(
    grounding.flatMap((result) =>
      result.context ? ([[result.place.id, result.context]] as const) : [],
    ),
  );
  const { intervals } = await addOpeningEvidence(
    draft,
    proposal,
    contexts,
    providerContext.placesService,
    signal,
  );
  const { legModes } = await addRouteEvidence(
    draft,
    proposal,
    contexts,
    intervals,
    providerContext.routesService,
    signal,
    log,
  );
  let validated = validateAiPlannerDraft(draft, { maxItineraryDays });
  // The evidence passes move and retime items; whatever they leave
  // inconsistent is settled here too, rather than failing a finished plan.
  const constraints = proposal.normalizedRequest.constraints;
  for (let attempt = 0; !validated.success && attempt < 3; attempt += 1) {
    let changed = false;
    if (validated.issues.some((issue) => issue.code === 'overlapping_items')) {
      resolveScheduleOverlaps(draft, proposal, log);
      changed = true;
    }
    for (const issue of validated.issues) {
      if (!HARD_CONSTRAINT_ISSUES.has(issue.code) || !issue.subjectId) continue;
      const constraint = constraints.find(
        (entry) =>
          entry.strength === 'hard' &&
          (entry.id === issue.subjectId || issue.subjectId!.endsWith(`:${entry.id}`)),
      );
      if (!constraint) continue;
      constraint.strength = 'flexible';
      log.add('commitment_relaxed');
      changed = true;
    }
    if (!changed) break;
    for (const day of draft.days) assignDraftLegModes(day, contexts, legModes);
    for (const item of draft.unscheduledItems) delete item.travelModeToNext;
    validated = validateAiPlannerDraft(draft, { maxItineraryDays });
  }
  if (!validated.success) {
    throw new AiPlanningPipelineFailure(
      'invalid_response',
      null,
      validated.issues.map((issue) => issue.code),
      validated.issues.map((issue) => safeIssuePath(issue.path)),
    );
  }

  return { draft: validated.data };
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
  if (error instanceof EntitlementError && error.code === 'itinerary_day_limit_exceeded')
    return { code: error.code, metadata };
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
    const [homeLocation, providerContext, savedPlaces] = await Promise.all([
      (options.loadHomeLocation ?? loadHomeLocation)(ownerId),
      Promise.resolve(
        options.providerContext ??
          createAiPlannerProviderContext({ environment: options.environment }),
      ),
      // A failure here only means the plan is made without them.
      (options.loadSavedPlaces ?? loadSavedPlacesForPlanner)(ownerId, generationDate).catch(
        () => [] as KnownPlace[],
      ),
    ]);
    const gateway = options.gateway ?? createAiGateway({ environment: options.environment });
    const promptContext = buildAiPlannerContext({
      generationDate,
      maxItineraryDays: claim.maxItineraryDays,
      homeLocation,
      savedPlaces: plannerSavedPlaces(savedPlaces),
    });
    const generation = await gateway.generateStructured({
      prompt: buildAiPlannerPrompt(claim.prompt, promptContext),
      schema: createAiPlannerCompactProposalSchema(claim.maxItineraryDays),
      schemaDescription: AI_PLANNER_SCHEMA_DESCRIPTION,
      schemaName: 'trove_ai_planner_compact_v1',
      signal: controller.signal,
    });
    metadata = generation.metadata;
    // The harness repairs what the model got wrong rather than failing the run:
    // only output that is not an object at all, or a repair the validator
    // still rejects, ends a run here.
    const repairs = new AiPlannerRepairLog();
    let expanded: AiPlannerModelProposal;
    try {
      const compact = repairCompactOutput(generation.output, claim.prompt, repairs);
      if (!compact) {
        throw new AiPlanningPipelineFailure('invalid_response', metadata, ['unusable_output']);
      }
      if (compact.normalizedRequest.datePreference.kind === 'exact') {
        checkAiPlannerDateDays(
          compact.normalizedRequest.datePreference.startDate,
          compact.normalizedRequest.datePreference.endDate,
          claim.maxItineraryDays,
        );
      }
      expanded = repairAiPlannerModelProposal(
        expandAiPlannerProposal(compact, claim.prompt, repairs),
        repairs,
        claim.maxItineraryDays,
      );
    } catch (error) {
      if (error instanceof AiPlanningPipelineFailure || error instanceof EntitlementError)
        throw error;
      throw new AiPlanningPipelineFailure('invalid_response', metadata, ['repair_failed']);
    }
    const proposal = validateAiPlannerModelProposal(expanded, claim.maxItineraryDays);

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
      draft = assembleAiPlanningDraft(
        proposal.data,
        generationDate,
        repairs,
        claim.maxItineraryDays,
      );
    } catch {
      throw new AiPlanningPipelineFailure('invalid_response', metadata);
    }
    checkAiPlannerDateDays(draft.trip.startDate, draft.trip.endDate, claim.maxItineraryDays);
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
      savedPlaces,
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
      repairs,
      claim.maxItineraryDays,
    );
    finalizeDraftDayTitles(validated.draft, proposal.data.daySummaries);
    // The provider run has finished acquiring its ordinary evidence. Reuse the
    // same cache-only normalizer as a retained draft, with the clock read after
    // its asynchronous evidence reads rather than before generation began.
    const planScore = await (options.readDraftScore ?? readDraftPlanScore)(validated.draft, clock);
    recordAiPlanningDraftAssembled(validated.draft, generationDate);
    recordAiPlanningProposalRepaired(repairs.counts, generationDate);
    if (controller.signal.aborted)
      throw new AiPlanningPipelineFailure(deadlineReached ? 'timeout' : 'cancelled', metadata);
    await lifecycle.completeSuccess(ownerId, runId, validated.draft, planScore, metadata);
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
