import { getPrismaClient } from '@trove/db';
import { planningPreferencesFromAi, type AiPlannerDraft } from '@trove/types';
import { draftDayStay, draftPlanScoreInputRevision } from './ai-planning-plan-score.js';
import {
  buildPlanScoreFromEvaluations,
  destinationContextByDay,
  loadPlaceEvidence,
  mergeScoringPlaceIdentity,
  loadScoringForecasts,
  placeHoursDeadlines,
  discardExpiredCurrentHours,
} from './plan-score.js';
import { estimateLegMinutes, legCalibration } from './plan-score-estimates.js';
import { haversineKm } from './plan-score-route-comparison.js';
import { draftTripContext } from './trip-context.js';
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
export async function readDraftPlanScore(draft: AiPlannerDraft, clock: Date | (() => Date)) {
  const now = typeof clock === 'function' ? clock() : clock;
  const scheduledRefs = new Set(
    draft.days.flatMap((day) =>
      day.items.flatMap((item) => (item.placeRefId ? [item.placeRefId] : [])),
    ),
  );
  const relevantRefs = new Set([
    ...scheduledRefs,
    ...draft.days.flatMap((day) => {
      const stay = draftDayStay(day);
      return [stay.start, stay.end].filter((id): id is string => Boolean(id));
    }),
    ...draft.trip.destinations.map((destination) => destination.placeRefId),
  ]);
  const rows = await getPrismaClient().place.findMany({
    where: {
      id: {
        in: [
          ...new Set(
            draft.places.flatMap((p) =>
              relevantRefs.has(p.id) && p.resolution === 'verified' ? [p.placeId] : [],
            ),
          ),
        ],
      },
    },
    include: { providerRefs: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const evidence = await loadPlaceEvidence(
    draft.places
      .filter((p) => scheduledRefs.has(p.id))
      .map((p) => ({
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
    if (!relevantRefs.has(place.id)) continue;
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
  // Countries are left to each day's zone here, so a draft's score depends only
  // on the draft; climate is read from the cache and never fetched.
  const destination = destinationContextByDay(await draftTripContext(draft, [], now));
  const legsOf = (day: (typeof draft.days)[number]) => {
    const stay = draftDayStay(day);
    const points = [
      ...(stay.start ? [{ id: `base-start:${day.date}`, placeId: stay.start }] : []),
      ...day.items.map((i) => ({ id: i.id, placeId: i.placeRefId })),
      ...(stay.end ? [{ id: `base-return:${day.date}`, placeId: stay.end }] : []),
    ];
    return points.slice(1).map((b, index) => {
      const a = points[index]!;
      return {
        a,
        b,
        origin: a.placeId ? (evidence.places.get(a.placeId)?.coordinates ?? null) : null,
        destination: b.placeId ? (evidence.places.get(b.placeId)?.coordinates ?? null) : null,
      };
    });
  };
  const cachedLeg = (
    origin: { latitude: number; longitude: number },
    destination: { latitude: number; longitude: number },
  ) => {
    const key = JSON.stringify(routeCacheKey(origin, destination, 'drive'));
    if (!routeMemo.has(key))
      routeMemo.set(
        key,
        readCachedRoute({ origin, destination, mode: 'drive', includePolyline: false }, now),
      );
    return routeMemo.get(key)!;
  };
  // The draft's own routed legs scale every estimate, as they do for a trip.
  const samples: Array<{ mode: string; km: number; minutes: number }> = [];
  for (const day of draft.days)
    for (const { origin, destination: end } of legsOf(day)) {
      if (!origin || !end) continue;
      if (origin.latitude === end.latitude && origin.longitude === end.longitude) continue;
      const cached = await cachedLeg(origin, end);
      if (cached.kind === 'hit' && cached.result.status === 'ok')
        samples.push({
          mode: 'drive',
          km: haversineKm(origin, end),
          minutes: cached.result.estimate.durationSeconds / 60,
        });
    }
  const calibration = legCalibration(samples);
  const days = [];
  for (const day of draft.days) {
    const zone =
      (day.dailyBasePlaceRefId ? zones.get(day.dailyBasePlaceRefId) : null) ??
      day.items.map((i) => (i.placeRefId ? zones.get(i.placeRefId) : null)).find(Boolean) ??
      draft.trip.destinations.map((d) => zones.get(d.placeRefId)).find(Boolean) ??
      'UTC';
    const segments: ScoringRouteSegment[] = [];
    for (const { a, b, origin, destination } of legsOf(day)) {
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
        const cached = await cachedLeg(origin, destination);
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
        const minutes = estimateLegMinutes(origin, destination, 'drive', calibration);
        if (minutes !== null) {
          segments.push({
            ...segment,
            status: 'KNOWN',
            duration: { minutes, source: 'ESTIMATED' },
            distanceMeters: null,
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
    const holiday = destination.holidays.get(day.date) ?? null;
    const items = normalizeScoringItems(day.date, zone, raw, {
      zones: new Map(record.items.map((i) => [i.id, i.timeZone])),
      hours: evidence.hours,
      holiday: holiday !== null,
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
        forecasts: forecast.forecasts.filter((f) => f.date === day.date),
        holiday,
        climate: destination.climate.get(day.date) ?? null,
      }),
    });
  }
  const evaluatedAt = typeof clock === 'function' ? clock() : now;
  const rawDeadlines = [
    ...routeDeadlines,
    ...placeHoursDeadlines(evidence.hours, records),
    ...forecast.times.map((at) => new Date(Date.parse(at) + WEATHER_FORECAST_TTL_MS).toISOString()),
    ...evidence.evidenceTimes.map((at) => new Date(Date.parse(at) + 30 * 86400000).toISOString()),
  ];
  if (
    typeof clock === 'function' &&
    rawDeadlines.some((at) => {
      const boundary = Date.parse(at);
      return (
        Number.isFinite(boundary) && boundary > now.getTime() && boundary <= evaluatedAt.getTime()
      );
    })
  )
    return readDraftPlanScore(draft, evaluatedAt);
  const score = buildPlanScoreFromEvaluations({
    days,
    evaluatedAt,
    evidenceTimes: [...evidence.evidenceTimes, ...routeTimes, ...forecast.times],
    evidenceDeadlines: rawDeadlines,
    mustGoIds: [...draft.days.flatMap((d) => d.items), ...draft.unscheduledItems].flatMap((i) =>
      i.priority === 'must_go' && i.placeRefId ? [i.placeRefId] : [],
    ),
    scheduledIds: draft.days.flatMap((d) =>
      d.items.flatMap((i) => (i.placeRefId ? [i.placeRefId] : [])),
    ),
  });
  score.sourceInputRevision = draftPlanScoreInputRevision(draft);
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
    score.presentation.revisions.destinationContext = scoringInputRevision({
      holidays: [...destination.holidays],
      climate: [...destination.climate],
    });
    score.presentation.revisions.evidence = scoringInputRevision({
      places: [...evidence.places],
      hours: [...evidence.hours],
      times: [...evidence.evidenceTimes, ...routeTimes],
    });
  }
  return score;
}
