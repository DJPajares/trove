import { createHash } from 'node:crypto';

import { getPrismaClient } from '@trove/db';
import {
  AI_PLANNER_MAX_REAL_PLACE_ITEMS,
  aiPlannerModelProposalSchema,
  type AiPlannerDraft,
  type AiPlannerDraftItem,
  type AiPlannerEvidence,
  type AiPlannerModelProposal,
  type AiPlannerWarning,
} from '@trove/types';

import {
  AI_PLANNER_SCHEMA_DESCRIPTION,
  buildAiPlannerContext,
  buildAiPlannerPrompt,
  coveredDayCount,
  isSparseProposal,
} from './ai-planner-prompt.js';
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
import { AiPlaceGrounder, type AiPlaceGroundingResult } from './ai-place-grounding.js';
import { createAiPlannerProviderContext } from './ai-planner-provider-context.js';
import { recordAiPlanningDraftAssembled } from './ai-planning-telemetry.js';
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
} from './ai-planning-sessions.js';
import { evaluateFeasibility, type PlanScoreDayItem } from './plan-score-factors.js';
import { openingIntervalsForWeekday, weekdayForLocalDate } from './place-opening-hours.js';
import type {
  PlaceDetailsResult,
  PlaceTextSearchProvider,
  PlacesService,
  ProviderPlaceIdentity,
} from './places.js';
import type { RoutesService } from './routes.js';
import { enumerateDateRange } from './trip-rules.js';

type GenerationGateway = {
  generateStructured<OUTPUT>(
    request: AiStructuredGenerationRequest<OUTPUT>,
  ): Promise<{ metadata: AiGenerationMetadata; output: OUTPUT }>;
};

type ProviderContext = {
  placesProvider: PlaceTextSearchProvider | null;
  placesService: PlacesService | null;
  routesService: RoutesService | null;
};

type GroundedPlaceContext = {
  externalPlaceId: string;
  location: { latitude: number; longitude: number };
};

type GroundedCandidate = AiPlaceGroundingResult & {
  context: GroundedPlaceContext | null;
};

type PlanningLifecycle = {
  claim(ownerId: string, runId: string): ReturnType<typeof claimAiPlanningDispatch>;
  completeFailure(
    ownerId: string,
    runId: string,
    code: AiGenerationErrorCode,
    metadata: AiGenerationMetadata | null,
  ): Promise<void>;
  completeSuccess(
    ownerId: string,
    runId: string,
    draft: AiPlannerDraft,
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
  ) => Promise<GroundedCandidate[]>;
  lifecycle?: PlanningLifecycle;
  loadHomeLocation?: (ownerId: string) => Promise<string | null>;
  providerContext?: ProviderContext;
};

class AiPlanningPipelineFailure extends Error {
  constructor(
    public readonly code: AiGenerationErrorCode,
    public readonly metadata: AiGenerationMetadata | null,
  ) {
    super(code);
    this.name = 'AiPlanningPipelineFailure';
  }
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

async function loadHomeLocation(ownerId: string) {
  const profile = await getPrismaClient().profile.findUnique({
    where: { id: ownerId },
    select: { homePlace: { select: { customName: true } } },
  });
  return profile?.homePlace?.customName?.trim() || null;
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

async function groundCandidates(
  proposal: AiPlannerModelProposal,
  providerContext: ProviderContext,
): Promise<GroundedCandidate[]> {
  if (!providerContext.placesProvider) {
    return proposal.places.map(unavailableGrounding);
  }

  const canonical = createCanonicalPlacesService();
  const contexts = new Map<string, GroundedPlaceContext>();
  const grounder = new AiPlaceGrounder(providerContext.placesProvider, {
    async resolveProviderPlaceFromIdentity(identity: ProviderPlaceIdentity, options) {
      const place = await canonical.resolveProviderPlaceFromIdentity(identity, options);
      contexts.set(place.id, {
        externalPlaceId: identity.externalPlaceId,
        location: identity.location,
      });
      return { id: place.id };
    },
  });
  const localities = candidateLocalities(proposal);
  const results = await grounder.groundCandidates(
    proposal.places.map((candidate) => ({
      ...candidate,
      localityHint: localities.get(candidate.id),
    })),
  );

  return results.map((result) => ({
    ...result,
    context:
      result.place.resolution === 'verified' ? (contexts.get(result.place.placeId) ?? null) : null,
  }));
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

function associateGroundingWarnings(
  warnings: AiPlannerWarning[],
  proposal: AiPlannerModelProposal,
) {
  const itemIds = new Map<string, string[]>();
  for (const item of proposal.items) {
    if (!item.candidatePlaceId) continue;
    itemIds.set(item.candidatePlaceId, [...(itemIds.get(item.candidatePlaceId) ?? []), item.id]);
  }
  return warnings.map((warning) => {
    const candidateId = warning.evidenceIds[0]
      ? proposal.places.find((candidate) =>
          warning.evidenceIds.some((id) => id === scopedId('identity', candidate.id)),
        )?.id
      : undefined;
    return candidateId ? { ...warning, itemIds: itemIds.get(candidateId) ?? [] } : warning;
  });
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

function enforceRealPlaceLimit(draft: AiPlannerDraft, proposal: AiPlannerModelProposal) {
  const verified = new Set(
    draft.places.flatMap((place) => (place.resolution === 'verified' ? [place.id] : [])),
  );
  const items = [...draft.days.flatMap((day) => day.items), ...draft.unscheduledItems];
  const realItems = items.filter((item) => item.placeRefId && verified.has(item.placeRefId));
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

export function assembleAiPlanningDraft(
  proposal: AiPlannerModelProposal,
  grounding: GroundedCandidate[],
  generationDate: Date,
): AiPlannerDraft {
  const defaults = resolveAiPlannerDefaults(proposal.normalizedRequest, proposal, generationDate);
  const dates = enumerateDateRange(defaults.startDate, defaults.endDate);
  const grounded = new Map(grounding.map((result) => [result.place.id, result]));
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
  const unscheduledItems: AiPlannerDraftItem[] = [];

  for (const proposalItem of proposal.items) {
    const item = toDraftItem(proposalItem);
    if (item.placeRefId && !grounded.has(item.placeRefId)) item.placeRefId = null;
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
    evidence: grounding.map((result) => result.evidence),
    normalizedRequest: proposal.normalizedRequest,
    places: grounding.map((result) => result.place),
    schemaVersion: proposal.schemaVersion,
    trip: {
      dateAssumptionId: defaults.dateAssumptionId,
      dateSource: defaults.dateSource,
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
    warnings: associateGroundingWarnings(
      grounding.flatMap((result) => result.warnings),
      proposal,
    ),
  };
  enforceBalancedPace(draft, proposal);
  enforceRealPlaceLimit(draft, proposal);
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
    duration: {
      minutes: item.durationMinutes,
      source: item.durationProvenance === 'user_owned' ? 'USER_OWNED' : 'ESTIMATED',
    },
    fixed: item.schedule.kind === 'exact',
    id: item.id,
    inboundTravel:
      inboundTravelMinutes === null
        ? null
        : { minutes: inboundTravelMinutes, source: 'FRESH_PROVIDER' },
    openingHours: opening
      ? { intervals: opening, source: 'FRESH_PROVIDER', status: 'KNOWN' }
      : { status: 'UNKNOWN' },
    start:
      item.schedule.kind === 'exact'
        ? { minutes: minuteOfDay(item.schedule.localTime), source: 'USER_OWNED' }
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

async function addOpeningEvidence(
  draft: AiPlannerDraft,
  proposal: AiPlannerModelProposal,
  contexts: Map<string, GroundedPlaceContext>,
  placesService: PlacesService | null,
) {
  const externalPlaceIds = [
    ...new Set(
      draft.days.flatMap((day) =>
        day.items.flatMap((item) => {
          const context = item.placeRefId ? contexts.get(item.placeRefId) : null;
          return context ? [context.externalPlaceId] : [];
        }),
      ),
    ),
  ];
  const details = new Map(
    await mapWithConcurrency(
      externalPlaceIds,
      PROVIDER_CONCURRENCY_LIMIT,
      async (externalPlaceId) =>
        [
          externalPlaceId,
          placesService
            ? await placesService.getDetails({ detail: 'evidence', externalPlaceId })
            : null,
        ] as const,
    ),
  );

  for (const day of draft.days) {
    const retained: AiPlannerDraftItem[] = [];
    for (const item of day.items) {
      const context = item.placeRefId ? contexts.get(item.placeRefId) : null;
      if (!context) {
        retained.push(item);
        continue;
      }
      const result = details.get(context.externalPlaceId) ?? null;
      const opening = openingEvidence(item, day.date, result);
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
      draft.evidence.push(opening.evidence);
      retained.push(item);
    }
    day.items = retained;
  }
}

async function addRouteEvidence(
  draft: AiPlannerDraft,
  proposal: AiPlannerModelProposal,
  contexts: Map<string, GroundedPlaceContext>,
  routesService: RoutesService | null,
) {
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
          ? await routesService.computeRoute({ ...request, includePolyline: false, mode: 'drive' })
          : null,
      ],
    ),
  );

  for (const day of draft.days) {
    const inbound = new Map<string, number | null>();
    const routeEvidenceIds = new Map<string, string>();
    for (let index = 1; index < day.items.length; index += 1) {
      const previous = day.items[index - 1]!;
      const next = day.items[index]!;
      const origin = previous.placeRefId ? contexts.get(previous.placeRefId) : null;
      const destination = next.placeRefId ? contexts.get(next.placeRefId) : null;
      if (!origin || !destination) continue;
      const routeId = scopedId('route', `${day.date}:${previous.id}:${next.id}`);
      const evidenceId = scopedId('route-evidence', routeId);
      routeEvidenceIds.set(next.id, evidenceId);
      const memoKey = `${origin.location.latitude}:${origin.location.longitude}:${destination.location.latitude}:${destination.location.longitude}`;
      const result = routeResults.get(memoKey) ?? null;
      if (result?.status === 'ok') inbound.set(next.id, result.estimate.durationSeconds / 60);
      else inbound.set(next.id, null);
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

    const feasibility = evaluateFeasibility({
      commitments: [],
      items: day.items.map((item) => feasibilityItem(item, null, inbound.get(item.id) ?? null)),
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
}

async function validateWithProviderEvidence(
  draft: AiPlannerDraft,
  proposal: AiPlannerModelProposal,
  grounding: GroundedCandidate[],
  providerContext: ProviderContext,
) {
  const contexts = new Map(
    grounding.flatMap((result) =>
      result.context ? ([[result.place.id, result.context]] as const) : [],
    ),
  );
  await addOpeningEvidence(draft, proposal, contexts, providerContext.placesService);
  await addRouteEvidence(draft, proposal, contexts, providerContext.routesService);
  const validated = validateAiPlannerDraft(draft);
  if (!validated.success) throw new AiPlanningPipelineFailure('invalid_response', null);
  return validated.data;
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
    completeFailure: (ownerId, runId, code, metadata) =>
      completeAiPlanningRunFailure(ownerId, runId, code, metadata, lifecycleOptions),
    completeSuccess: (ownerId, runId, draft, metadata) =>
      completeAiPlanningRunSuccess(ownerId, runId, draft, metadata, lifecycleOptions),
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
    const generate = (coverageRetry: boolean) =>
      gateway.generateStructured({
        prompt: buildAiPlannerPrompt(claim.prompt, promptContext, { coverageRetry }),
        schema: aiPlannerModelProposalSchema,
        schemaDescription: AI_PLANNER_SCHEMA_DESCRIPTION,
        schemaName: 'trove_ai_planner_proposal_v1',
        signal: controller.signal,
      });

    let generation = await generate(false);
    metadata = generation.metadata;
    let proposal = validateAiPlannerModelProposal(generation.output);

    // Day coverage is the one thing the model is unreliable about: identical
    // requests alternate between filling every day and filling only the first,
    // and no validation rule rejects a sparse plan. Ask once more, then keep
    // whichever attempt covered more of the trip so a retry is never a downgrade.
    // An invalid proposal is left alone — it already fails fast, and retrying it
    // would spend a second call on every malformed response.
    if (proposal.success && isSparseProposal(proposal.data)) {
      const covered = coveredDayCount(proposal.data.items);
      const retried = await generate(true);
      const retriedProposal = validateAiPlannerModelProposal(retried.output);
      if (retriedProposal.success && coveredDayCount(retriedProposal.data.items) > covered) {
        generation = retried;
        proposal = retriedProposal;
        metadata = retried.metadata;
      }
    }

    if (!proposal.success) throw new AiPlanningPipelineFailure('invalid_response', metadata);

    await lifecycle.updateStage(ownerId, runId, 'GROUNDING');
    const grounding = await (options.groundCandidates ?? groundCandidates)(
      proposal.data,
      providerContext,
    );
    await lifecycle.updateStage(ownerId, runId, 'SCHEDULING');
    let draft: AiPlannerDraft;
    try {
      draft = assembleAiPlanningDraft(proposal.data, grounding, generationDate);
    } catch {
      throw new AiPlanningPipelineFailure('invalid_response', metadata);
    }
    await lifecycle.updateStage(ownerId, runId, 'VALIDATING');
    const validated = await validateWithProviderEvidence(
      draft,
      proposal.data,
      grounding,
      providerContext,
    );
    recordAiPlanningDraftAssembled(validated, generationDate);
    await lifecycle.completeSuccess(ownerId, runId, validated, metadata);
  } catch (error) {
    const failure = failureFrom(error, metadata);
    await lifecycle.completeFailure(ownerId, runId, failure.code, failure.metadata);
  } finally {
    if (activeRuns.get(claim.sessionId) === controller) activeRuns.delete(claim.sessionId);
  }
}
