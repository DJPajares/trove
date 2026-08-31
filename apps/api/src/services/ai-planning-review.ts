import { createHash } from 'node:crypto';

import { getPrismaClient } from '@trove/db';
import type { AiPlannerDraft, AiPlannerEvidence, AiPlannerWarning } from '@trove/types';

import { createCanonicalPlacesService } from './canonical-places.js';
import { AiPlaceGrounder } from './ai-place-grounding.js';
import { createAiPlannerProviderContext } from './ai-planner-provider-context.js';
import {
  AiPlanningSessionError,
  loadReviewableAiPlanningSessionForApply,
  replaceAiPlanningReviewDraft,
} from './ai-planning-sessions.js';
import { ProviderCallBudget } from './provider-usage.js';

/** A review refresh is deliberately a small, traveller-directed operation. */
export const AI_PLANNING_REVIEW_PROVIDER_CALL_LIMIT = 10;

type ReviewOptions = {
  environment?: Record<string, string | undefined>;
};

function scopedId(scope: string, value: string) {
  return `${scope}:${createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
}

function allItems(draft: AiPlannerDraft) {
  return [...draft.days.flatMap((day) => day.items), ...draft.unscheduledItems];
}

function replaceAt<T extends { id: string }>(values: readonly T[], next: T) {
  const index = values.findIndex((value) => value.id === next.id);
  return index < 0
    ? [...values, next]
    : values.map((value) => (value.id === next.id ? next : value));
}

function withoutEvidenceWarnings(
  warnings: readonly AiPlannerWarning[],
  evidenceIds: ReadonlySet<string>,
) {
  return warnings.filter((warning) => !warning.evidenceIds.some((id) => evidenceIds.has(id)));
}

function replaceDraftItem(
  draft: AiPlannerDraft,
  itemId: string,
  mutate: (
    item: AiPlannerDraft['days'][number]['items'][number],
  ) => AiPlannerDraft['days'][number]['items'][number],
) {
  let found = false;
  const days = draft.days.map((day) => ({
    ...day,
    items: day.items.map((item) => {
      if (item.id !== itemId) return item;
      found = true;
      return mutate(item);
    }),
  }));
  const unscheduledItems = draft.unscheduledItems.map((item) => {
    if (item.id !== itemId) return item;
    found = true;
    return mutate(item);
  });
  if (!found) throw new AiPlanningSessionError('draft_invalid', 400);
  return { ...draft, days, unscheduledItems };
}

function providerError(code: string) {
  if (code === 'quota_exceeded' || code === 'rate_limited') {
    return new AiPlanningSessionError('provider_unavailable', 503);
  }
  if (code === 'configuration_missing') {
    return new AiPlanningSessionError('configuration_missing', 503);
  }
  return new AiPlanningSessionError('provider_unavailable', 503);
}

async function loadReviewDraft(ownerId: string, sessionId: string, expectedRevision: number) {
  return (await loadReviewableAiPlanningSessionForApply(ownerId, sessionId, expectedRevision))
    .draft;
}

async function externalPlaceId(placeId: string) {
  const reference = await getPrismaClient().placeProviderRef.findFirst({
    where: { placeId, provider: 'GOOGLE' },
    select: { externalPlaceId: true },
  });
  return reference?.externalPlaceId ?? null;
}

function openingEvidence(
  itemId: string,
  result: Awaited<
    ReturnType<
      NonNullable<ReturnType<typeof createAiPlannerProviderContext>['placesService']>['getDetails']
    >
  >,
): { evidence: AiPlannerEvidence; warning: AiPlannerWarning | null } {
  const id = scopedId('review-hours', itemId);
  if (result.status === 'ok') {
    const available =
      result.place.openingPeriods.length > 0 && result.place.utcOffsetMinutes !== null;
    return {
      evidence: {
        checkedAt: result.freshness.fetchedAt,
        code: available ? null : 'opening_hours_unavailable',
        id,
        kind: 'opening_hours',
        provider: 'google',
        status: available ? 'verified' : 'unverified',
        subjectId: itemId,
        subjectType: 'item',
      },
      warning: available
        ? null
        : {
            code: 'opening_hours_unavailable',
            evidenceIds: [id],
            id: scopedId('review-warning', id),
            itemIds: [itemId],
            material: false,
          },
    };
  }

  const code =
    result.status === 'unavailable' && result.code === 'budget_exhausted'
      ? 'provider_cap_reached'
      : 'opening_hours_not_checked';
  return {
    evidence: {
      checkedAt: null,
      code,
      id,
      kind: 'opening_hours',
      provider: null,
      status: 'not_checked',
      subjectId: itemId,
      subjectType: 'item',
    },
    warning: {
      code,
      evidenceIds: [id],
      id: scopedId('review-warning', id),
      itemIds: [itemId],
      material: false,
    },
  };
}

type ReviewRoutePair = {
  dayDate: string;
  destination: AiPlannerDraft['days'][number]['items'][number];
  origin: AiPlannerDraft['days'][number]['items'][number];
};

function routePairsForItem(draft: AiPlannerDraft, itemId: string): ReviewRoutePair[] {
  const pairs: ReviewRoutePair[] = [];
  for (const day of draft.days) {
    for (let index = 1; index < day.items.length; index += 1) {
      const origin = day.items[index - 1]!;
      const destination = day.items[index]!;
      if (origin.id === itemId || destination.id === itemId) {
        pairs.push({ dayDate: day.date, destination, origin });
      }
    }
  }
  return pairs;
}

async function routeEvidenceForItem(
  draft: AiPlannerDraft,
  itemId: string,
  routesService: ReturnType<typeof createAiPlannerProviderContext>['routesService'],
) {
  const evidence: AiPlannerEvidence[] = [];
  const warnings: AiPlannerWarning[] = [];
  const pairs = routePairsForItem(draft, itemId);
  for (const pair of pairs) {
    const routeId = scopedId('route', `${pair.dayDate}:${pair.origin.id}:${pair.destination.id}`);
    const evidenceId = scopedId('route-evidence', routeId);
    const originPlace = pair.origin.placeRefId
      ? draft.places.find((place) => place.id === pair.origin.placeRefId)
      : null;
    const destinationPlace = pair.destination.placeRefId
      ? draft.places.find((place) => place.id === pair.destination.placeRefId)
      : null;
    const origin =
      originPlace?.resolution === 'verified' && originPlace.location ? originPlace.location : null;
    const destination =
      destinationPlace?.resolution === 'verified' && destinationPlace.location
        ? destinationPlace.location
        : null;
    const result =
      origin && destination && routesService
        ? await routesService.computeRoute({
            destination,
            includePolyline: false,
            mode: 'drive',
            origin,
          })
        : null;
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
    evidence.push({
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
      warnings.push({
        code: code ?? 'route_not_checked',
        evidenceIds: [evidenceId],
        id: scopedId('review-warning', routeId),
        itemIds: [pair.origin.id, pair.destination.id],
        material: false,
      });
    }
  }
  return { evidence, warnings };
}

function replaceItemEvidence(
  draft: AiPlannerDraft,
  itemId: string,
  opening: ReturnType<typeof openingEvidence>,
  routes: Awaited<ReturnType<typeof routeEvidenceForItem>>,
) {
  const replacedEvidenceIds = new Set(
    draft.evidence
      .filter((evidence) => evidence.kind === 'opening_hours' && evidence.subjectId === itemId)
      .map((evidence) => evidence.id),
  );
  for (const evidence of routes.evidence) {
    replacedEvidenceIds.add(evidence.id);
  }
  return {
    evidence: [
      ...draft.evidence.filter((entry) => !replacedEvidenceIds.has(entry.id)),
      opening.evidence,
      ...routes.evidence,
    ],
    warnings: [
      ...withoutEvidenceWarnings(draft.warnings, replacedEvidenceIds),
      ...(opening.warning ? [opening.warning] : []),
      ...routes.warnings,
    ],
  };
}

/**
 * Refreshes opening-hours plus at most the two adjacent route legs for exactly
 * one reviewed item. This keeps a one-click review action bounded and avoids
 * fanning a small edit out across a whole itinerary.
 */
export async function recheckAiPlanningItem(
  ownerId: string,
  sessionId: string,
  itemId: string,
  expectedRevision: number,
  options: ReviewOptions = {},
) {
  const draft = await loadReviewDraft(ownerId, sessionId, expectedRevision);
  const item = allItems(draft).find((candidate) => candidate.id === itemId);
  const place = item?.placeRefId
    ? draft.places.find((candidate) => candidate.id === item.placeRefId)
    : null;
  if (!item || !place || place.resolution !== 'verified') {
    throw new AiPlanningSessionError('place_unresolved', 409);
  }
  const externalId = await externalPlaceId(place.placeId);
  if (!externalId) throw new AiPlanningSessionError('place_unresolved', 409);

  const context = createAiPlannerProviderContext({
    budget: new ProviderCallBudget(AI_PLANNING_REVIEW_PROVIDER_CALL_LIMIT),
    environment: options.environment,
    source: 'ai-planner-review',
  });
  if (!context.placesService) throw new AiPlanningSessionError('configuration_missing', 503);

  const result = await context.placesService.getDetails({
    detail: 'evidence',
    externalPlaceId: externalId,
  });
  const next = openingEvidence(item.id, result);
  const routes = await routeEvidenceForItem(draft, item.id, context.routesService);
  const refreshed = replaceItemEvidence(draft, item.id, next, routes);
  return replaceAiPlanningReviewDraft(
    ownerId,
    sessionId,
    { ...draft, ...refreshed },
    expectedRevision,
  );
}

/** Resolve a Custom Place from its visible text without ever inventing a map location. */
export async function verifyAiPlanningCustomPlace(
  ownerId: string,
  sessionId: string,
  placeRefId: string,
  expectedRevision: number,
  options: ReviewOptions = {},
) {
  const draft = await loadReviewDraft(ownerId, sessionId, expectedRevision);
  const place = draft.places.find((candidate) => candidate.id === placeRefId);
  if (!place || place.resolution !== 'custom') {
    throw new AiPlanningSessionError('place_unresolved', 409);
  }
  const context = createAiPlannerProviderContext({
    budget: new ProviderCallBudget(AI_PLANNING_REVIEW_PROVIDER_CALL_LIMIT),
    environment: options.environment,
    source: 'ai-planner-review',
  });
  if (!context.placesProvider) throw new AiPlanningSessionError('configuration_missing', 503);

  const canonical = createCanonicalPlacesService();
  const grounder = new AiPlaceGrounder(context.placesProvider, {
    async resolveProviderPlaceFromIdentity(identity, resolutionOptions) {
      const resolved = await canonical.resolveProviderPlaceFromIdentity(
        identity,
        resolutionOptions,
      );
      return { id: resolved.id };
    },
  });
  const grounded = await grounder.groundCandidate({
    id: place.id,
    name: place.name,
    note: place.note,
    searchQuery: place.name,
  });
  const replacedEvidenceIds = new Set(
    draft.evidence
      .filter((evidence) => evidence.kind === 'identity' && evidence.subjectId === place.id)
      .map((evidence) => evidence.id),
  );
  const evidence = replaceAt(
    draft.evidence.filter((entry) => !replacedEvidenceIds.has(entry.id)),
    grounded.evidence,
  );
  const warnings = [
    ...withoutEvidenceWarnings(draft.warnings, replacedEvidenceIds),
    ...grounded.warnings,
  ];
  return replaceAiPlanningReviewDraft(
    ownerId,
    sessionId,
    { ...draft, evidence, places: replaceAt(draft.places, grounded.place), warnings },
    expectedRevision,
  );
}

/**
 * The browser may choose an autocomplete result, but the server fetches and
 * records the durable provider identity before it touches the review draft.
 */
export async function replaceAiPlanningItemPlace(
  ownerId: string,
  sessionId: string,
  itemId: string,
  expectedRevision: number,
  input: { externalPlaceId: string; sessionToken?: string },
  options: ReviewOptions = {},
) {
  const draft = await loadReviewDraft(ownerId, sessionId, expectedRevision);
  const item = allItems(draft).find((candidate) => candidate.id === itemId);
  if (!item) throw new AiPlanningSessionError('draft_invalid', 400);
  const context = createAiPlannerProviderContext({
    budget: new ProviderCallBudget(AI_PLANNING_REVIEW_PROVIDER_CALL_LIMIT),
    environment: options.environment,
    source: 'ai-planner-review',
  });
  if (!context.placesService) throw new AiPlanningSessionError('configuration_missing', 503);
  const result = await context.placesService.getDetails({
    detail: 'location',
    externalPlaceId: input.externalPlaceId,
    sessionToken: input.sessionToken,
  });
  if (result.status !== 'ok' || !result.place.location) {
    throw providerError(result.status === 'unavailable' ? result.code : 'not_found');
  }
  const canonical = createCanonicalPlacesService();
  const identity = { ...result.place, location: result.place.location };
  const resolved = await canonical.resolveProviderPlaceFromIdentity(identity, {
    fetchedAt: new Date(result.freshness.fetchedAt),
  });
  const placeRefId = scopedId('review-place', `${item.id}:${input.externalPlaceId}`);
  const nextPlace = {
    attributions: result.place.attributions,
    id: placeRefId,
    location: result.place.location,
    name: result.place.name,
    placeId: resolved.id,
    provider: 'google' as const,
    resolution: 'verified' as const,
  };
  const identityEvidence: AiPlannerEvidence = {
    checkedAt: result.freshness.fetchedAt,
    code: null,
    id: scopedId('review-identity', placeRefId),
    kind: 'identity',
    provider: 'google',
    status: 'verified',
    subjectId: placeRefId,
    subjectType: 'place',
  };
  const updated = replaceDraftItem(draft, itemId, (current) => ({
    ...current,
    label: result.place.name,
    placeRefId,
  }));
  const draftWithPlace = {
    ...updated,
    evidence: replaceAt(updated.evidence, identityEvidence),
    places: replaceAt(updated.places, nextPlace),
  };
  const evidenceResult = await context.placesService.getDetails({
    detail: 'evidence',
    externalPlaceId: input.externalPlaceId,
    sessionToken: input.sessionToken,
  });
  const refreshed = replaceItemEvidence(
    draftWithPlace,
    item.id,
    openingEvidence(item.id, evidenceResult),
    await routeEvidenceForItem(draftWithPlace, item.id, context.routesService),
  );
  return replaceAiPlanningReviewDraft(
    ownerId,
    sessionId,
    { ...draftWithPlace, ...refreshed },
    expectedRevision,
  );
}
