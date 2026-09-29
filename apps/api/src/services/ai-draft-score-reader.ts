import { getPrismaClient } from '@trove/db';
import { planningPreferencesFromAi, type AiPlannerDraft } from '@trove/types';
import { draftDestinationContext, draftPlanScoreInputRevision } from './ai-planning-plan-score.js';
import {
  buildPlanScoreFromEvaluations,
  loadPlaceEvidence,
  mergeScoringPlaceIdentity,
  loadScoringForecasts,
  placeHoursDeadlines,
  discardExpiredCurrentHours,
} from './plan-score.js';
import { evaluateScoredDay, type ScoringRouteSegment } from './plan-score-evaluation.js';
import { normalizeScoringItems, dayOrigin } from './plan-score-normalization.js';
import { toDayEvidenceItems } from './itinerary-day-evidence.js';
import { floatingLocalTimeToInstant, parseLocalTime } from './itinerary-rules.js';
import { timeZoneAtCoordinates } from './coordinate-time-zone.js';
import { resolveCountryPrimaryTimeZone } from './trip-rules.js';
import { readCachedRoute, routeCacheKey } from './route-evidence-cache.js';
import { planScoreReferenceTargets } from './plan-score-reference-targets.js';
import { WEATHER_FORECAST_TTL_MS } from './weather-evidence-cache.js';
import { scoringInputRevision } from './plan-score-rules.js';

/** Reopening retained drafts evaluates owned data and caches, never generation or providers. */
export async function readDraftPlanScore(draft: AiPlannerDraft, now: Date) {
  const rows = await getPrismaClient().place.findMany({
    where: {
      id: {
        in: [
          ...new Set(draft.places.flatMap((p) => (p.resolution === 'verified' ? [p.placeId] : []))),
        ],
      },
    },
    include: { providerRefs: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const evidence = await loadPlaceEvidence(
    draft.places.map((p) => ({
      id: p.id,
      externalPlaceId:
        p.resolution === 'verified'
          ? (byId.get(p.placeId)?.providerRefs.find((r) => r.provider === 'GOOGLE')
              ?.externalPlaceId ?? null)
          : null,
    })),
    now,
  );
  const zones = new Map<string, string>();
  for (const place of draft.places) {
    const row = place.resolution === 'verified' ? byId.get(place.placeId) : null;
    if (row) {
      const merged = mergeScoringPlaceIdentity(place.id, row, evidence.places.get(place.id), now);
      evidence.places.set(place.id, merged.place);
      evidence.evidenceTimes.push(...merged.times);
      const hours = evidence.hours.get(place.id);
      if (hours && !hours.timeZone && merged.place.coordinates)
        hours.timeZone = timeZoneAtCoordinates(merged.place.coordinates);
    }
    // Retained identity coordinates keep their original cached age; expired snapshots do not feed scoring.
    const coordinates = evidence.places.get(place.id)?.coordinates;
    const zone =
      (coordinates ? timeZoneAtCoordinates(coordinates) : null) ??
      resolveCountryPrimaryTimeZone(place.name);
    if (zone) zones.set(place.id, zone);
  }
  discardExpiredCurrentHours(evidence.hours, now);
  const routeMemo = new Map<string, ReturnType<typeof readCachedRoute>>();
  const routeTimes: string[] = [];
  const routeDeadlines: string[] = [];
  const context = draftDestinationContext(draft, now);
  const records = draft.days.map((day) => ({
    date: day.date,
    timeZone:
      (day.dailyBasePlaceRefId ? zones.get(day.dailyBasePlaceRefId) : null) ??
      day.items.map((i) => (i.placeRefId ? zones.get(i.placeRefId) : null)).find(Boolean) ??
      draft.trip.destinations.map((d) => zones.get(d.placeRefId)).find(Boolean) ??
      'UTC',
    items: day.items.map((i) => ({ tripPlaceId: i.placeRefId, blockType: i.blockType })),
  }));
  const forecast = await loadScoringForecasts(records, evidence.places, now);
  const days = [];
  for (const day of draft.days) {
    const zone =
      (day.dailyBasePlaceRefId ? zones.get(day.dailyBasePlaceRefId) : null) ??
      day.items.map((i) => (i.placeRefId ? zones.get(i.placeRefId) : null)).find(Boolean) ??
      draft.trip.destinations.map((d) => zones.get(d.placeRefId)).find(Boolean) ??
      'UTC';
    const points = [
      ...((day.dailyBaseDeparturePlaceRefId ?? day.dailyBasePlaceRefId)
        ? [
            {
              id: `base-start:${day.date}`,
              placeId: day.dailyBaseDeparturePlaceRefId ?? day.dailyBasePlaceRefId,
            },
          ]
        : []),
      ...day.items.map((i) => ({ id: i.id, placeId: i.placeRefId })),
      ...(day.dailyBasePlaceRefId
        ? [{ id: `base-return:${day.date}`, placeId: day.dailyBasePlaceRefId }]
        : []),
    ];
    const segments: ScoringRouteSegment[] = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!,
        b = points[i]!;
      const origin = a.placeId ? evidence.places.get(a.placeId)?.coordinates : null;
      const destination = b.placeId ? evidence.places.get(b.placeId)?.coordinates : null;
      const segment: ScoringRouteSegment = {
        id: `${a.id}:${b.id}`,
        itemIds: [a.id, b.id],
        scope: 'LOCAL',
        status: 'UNKNOWN',
        mode: 'drive',
      };
      if (origin && destination) {
        if (
          origin.latitude === destination.latitude &&
          origin.longitude === destination.longitude
        ) {
          segments.push({
            ...segment,
            status: 'KNOWN',
            duration: { minutes: 0, source: 'USER_OWNED' },
            distanceMeters: 0,
          });
          continue;
        }
        const key = JSON.stringify(routeCacheKey(origin, destination, 'drive'));
        if (!routeMemo.has(key))
          routeMemo.set(
            key,
            readCachedRoute({ origin, destination, mode: 'drive', includePolyline: false }, now),
          );
        const cached = await routeMemo.get(key)!;
        if (cached.kind === 'hit' && cached.result.status === 'ok') {
          routeTimes.push(cached.result.freshness.fetchedAt);
          routeDeadlines.push(
            new Date(Date.parse(cached.result.freshness.fetchedAt) + 30 * 86400000).toISOString(),
          );
          segments.push({
            ...segment,
            status: 'KNOWN',
            duration: {
              minutes: cached.result.estimate.durationSeconds / 60,
              source: 'CACHED_PROVIDER',
            },
            distanceMeters: cached.result.estimate.distanceMeters,
          });
          continue;
        }
      }
      segments.push(segment);
    }
    const record = {
      id: day.date,
      date: day.date,
      timeZone: zone,
      commitments: [],
      items: day.items.map((item) => {
        const exact = item.schedule.kind === 'exact' ? item.schedule.localTime : null;
        const itemZone = (item.placeRefId ? zones.get(item.placeRefId) : null) ?? zone;
        return {
          id: item.id,
          blockType: item.blockType,
          tripPlaceId: item.placeRefId,
          durationMinutes: item.durationMinutes,
          durationProvenance: item.durationProvenance.toUpperCase(),
          dayPart: item.schedule.kind === 'day_part' ? item.schedule.dayPart.toUpperCase() : null,
          localStartTime: exact ? parseLocalTime(exact) : null,
          startInstant: exact ? floatingLocalTimeToInstant(day.date, exact, itemZone) : null,
          timeSemantics: exact ? 'FLOATING_LOCAL' : null,
          timeProvenance: exact
            ? item.schedule.kind === 'exact' && item.schedule.source === 'user'
              ? 'USER_OWNED'
              : 'AI_ESTIMATED'
            : null,
          timeZone: itemZone,
          reservationCount: 0,
        };
      }),
    };
    const raw = toDayEvidenceItems(record, undefined, new Map()).map((item, index) => {
      const inbound = segments.find((s) => s.itemIds?.[1] === item.id);
      return {
        ...item,
        placeId: day.items[index]?.placeRefId ?? undefined,
        inboundRequired: Boolean(inbound),
        inboundTravel: inbound?.status === 'KNOWN' ? inbound.duration : null,
      };
    });
    const items = normalizeScoringItems(day.date, zone, raw, {
      zones: new Map(record.items.map((i) => [i.id, i.timeZone])),
      hours: evidence.hours,
    });
    days.push({
      date: day.date,
      evaluation: evaluateScoredDay({
        dayId: day.date,
        date: day.date,
        timeZone: zone,
        originInstant: dayOrigin(day.date, zone),
        commitments: [],
        items,
        segments,
        places: [...new Set(day.items.flatMap((i) => (i.placeRefId ? [i.placeRefId] : [])))].map(
          (id) =>
            evidence.places.get(id) ?? { tripPlaceId: id, rating: { status: 'UNKNOWN' as const } },
        ),
        preferences: planningPreferencesFromAi(
          draft.normalizedRequest,
          draft.trip.paceSource === 'user',
          draft.assumptions.some((a) => a.code === 'interest_inferred'),
        ),
        context: context.days.find((d) => d.dayId === day.date)?.groups,
        forecasts: forecast.forecasts.filter((f) => f.date === day.date),
      }),
    });
  }
  const score = buildPlanScoreFromEvaluations({
    days,
    destinationContext: context,
    evaluatedAt: now,
    evidenceTimes: [...evidence.evidenceTimes, ...routeTimes, ...forecast.times],
    evidenceDeadlines: [
      ...routeDeadlines,
      ...placeHoursDeadlines(evidence.hours, records),
      ...forecast.times.map((at) =>
        new Date(Date.parse(at) + WEATHER_FORECAST_TTL_MS).toISOString(),
      ),
    ],
    mustGoIds: [...draft.days.flatMap((d) => d.items), ...draft.unscheduledItems].flatMap((i) =>
      i.priority === 'must_go' && i.placeRefId ? [i.placeRefId] : [],
    ),
    scheduledIds: draft.days.flatMap((d) =>
      d.items.flatMap((i) => (i.placeRefId ? [i.placeRefId] : [])),
    ),
  });
  score.sourceInputRevision = draftPlanScoreInputRevision(draft, now);
  if (score.presentation) {
    score.presentation.referenceTargets = planScoreReferenceTargets(score, {
      items: [
        ...draft.days.flatMap((d) => d.items.map((i) => ({ id: i.id, dayId: d.date }))),
        ...draft.unscheduledItems.map((i) => ({ id: i.id, dayId: null })),
      ],
      reservationIds: [],
      tripPlaceIds: draft.places.map((p) => p.id),
    });
    score.presentation.revisions.planning = score.sourceInputRevision;
    score.presentation.revisions.evidence = scoringInputRevision({
      places: [...evidence.places],
      hours: [...evidence.hours],
      times: [...evidence.evidenceTimes, ...routeTimes],
    });
  }
  return score;
}
