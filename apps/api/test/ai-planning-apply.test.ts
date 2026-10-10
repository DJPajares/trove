import { scoreDay, toPlanScoreDayPayload } from '../src/services/plan-score-rules.js';
import { Prisma } from '@trove/db';
import type { AiPlannerDraft } from '@trove/types';
import { describe, expect, test } from 'vitest';

import { applyAiPlanningSession } from '../src/services/ai-planning-apply.js';
import { cleanupAiPlanningRetention } from '../src/services/ai-planning-retention.js';
import {
  setAiPlanningTelemetrySink,
  type AiPlanningTelemetryEvent,
} from '../src/services/ai-planning-telemetry.js';
import { readPlanScoreInputs } from '../src/services/plan-score.js';
import { draftPlanScoreInputRevision } from '../src/services/ai-planning-plan-score.js';
import { PLAN_SCORE_CACHE_TTL_MS } from '../src/services/plan-score-freshness.js';
import { getProviderCallCounts, resetProviderCallCounts } from '../src/services/provider-usage.js';
import { customPlaceDraft, emptyPlanScore, explicitDraft } from './fixtures/ai-planning.js';

const OWNER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_OWNER_ID = '00000000-0000-4000-8000-000000000002';
const SESSION_ID = '00000000-0000-4000-8000-000000000010';
const NOW = new Date('2026-08-31T12:00:00.000Z');

function scoreableDraft() {
  const draft = customPlaceDraft();
  for (const place of draft.places) {
    if (place.resolution === 'verified')
      place.location = { latitude: 35.6762, longitude: 139.6503 };
  }
  return draft;
}

function draftAssessment(draft: AiPlannerDraft, evaluatedAt = new Date(NOW.getTime() - 3_600_000)) {
  return {
    ...emptyPlanScore(),
    generatedAt: evaluatedAt.toISOString(),
    recomputeAfter: new Date(evaluatedAt.getTime() + PLAN_SCORE_CACHE_TTL_MS).toISOString(),
    evidenceAsOf: evaluatedAt.toISOString(),
    sourceInputRevision: draftPlanScoreInputRevision(draft),
    score: 72,
    withheldReasons: [],
    days: draft.days.map((day) => ({
      ...toPlanScoreDayPayload(scoreDay({ dayId: day.date, factors: {} })),
      completeness: 80,
      confidence: 90,
      date: day.date,
      dayId: day.date,
      explanations: { uncertainty: [], whatWorks: [], worthImproving: [] },
      score: 72,
      withheldReasons: [],
    })),
  };
}

type SessionState = {
  appliedTripId: string | null;
  createdAt: Date;
  draft: AiPlannerDraft | null;
  draftRevision: number;
  expiresAt: Date;
  id: string;
  lastErrorCode: string | null;
  ownerId: string;
  planScore: unknown;
  rawPrompt: string | null;
  schemaVersion: number;
  stage: string;
  status: string;
  tripDescription: string | null;
  tripName: string | null;
  reviewedCountries: string[];
  countriesReviewedRevision: number | null;
  countryContextChanged: boolean;
  updatedAt: Date;
  warningsAcknowledgedAt: Date | null;
  warningsAcknowledgedRevision: number | null;
};

type ApplyState = {
  days: Array<Record<string, any>>;
  destinations: Array<Record<string, any>>;
  items: Array<Record<string, any>>;
  places: Array<Record<string, any>>;
  runs: Array<Record<string, any>>;
  savedPlaces: Array<Record<string, any>>;
  sessions: SessionState[];
  tripPlaces: Array<Record<string, any>>;
  trips: Array<Record<string, any>>;
};

function makeSession(draft: AiPlannerDraft, overrides: Partial<SessionState> = {}): SessionState {
  return {
    appliedTripId: null,
    createdAt: NOW,
    draft,
    draftRevision: 1,
    expiresAt: new Date(NOW.getTime() + 86_400_000),
    id: SESSION_ID,
    lastErrorCode: null,
    ownerId: OWNER_ID,
    planScore: null,
    rawPrompt: 'Plan Tokyo',
    schemaVersion: 1,
    stage: 'REVIEWING',
    status: 'REVIEWING',
    tripDescription: null,
    tripName: null,
    reviewedCountries: ['JP'],
    countriesReviewedRevision: 1,
    countryContextChanged: false,
    updatedAt: NOW,
    warningsAcknowledgedAt: null,
    warningsAcknowledgedRevision: null,
    ...overrides,
  };
}

function matches(value: unknown, expected: unknown) {
  if (expected === undefined) return true;
  if (expected && typeof expected === 'object') {
    if ('in' in expected) return (expected.in as unknown[]).includes(value);
    if ('lte' in expected) return value instanceof Date && value <= (expected.lte as Date);
    if ('gt' in expected) return value instanceof Date && value > (expected.gt as Date);
    if ('not' in expected) return value !== expected.not;
  }
  return value === expected;
}

/**
 * The database enforces these as CHECK constraints, which an in-memory fake
 * would otherwise never evaluate — both shipped as 500s because of that gap.
 * Asserting them at every write makes each existing apply test carry the guard.
 */
function assertDayTimeZoneSourceContext(day: Record<string, unknown>) {
  const source = day.defaultTimeZoneSource;
  const sourceItemId = day.defaultTimeZoneSourceItemId ?? null;
  if (source === 'FIRST_LOCATED_ITEM' && sourceItemId === null) {
    throw new Error('itinerary_days_time_zone_source_context');
  }
  if (source !== 'FIRST_LOCATED_ITEM' && sourceItemId !== null) {
    throw new Error('itinerary_days_time_zone_source_context');
  }
}

function assertItemLocalTimeContext(item: Record<string, unknown>) {
  const parts = [
    item.localStartTime ?? null,
    item.startInstant ?? null,
    item.timeSemantics ?? null,
  ];
  const set = parts.filter((value) => value !== null).length;
  if (set !== 0 && set !== parts.length) {
    throw new Error('itinerary_items_local_time_context');
  }
  if (set === parts.length && (item.timeZone ?? null) === null) {
    throw new Error('itinerary_items_local_time_context');
  }
  if (((item.localStartTime ?? null) === null) !== ((item.timeProvenance ?? null) === null)) {
    throw new Error('itinerary_items_time_provenance_context');
  }
}

function createApplyStore(
  draft: AiPlannerDraft,
  options: {
    failAt?: 'item';
    missingVerifiedPlace?: boolean;
    session?: Partial<SessionState>;
    adjustAppliedRows?: (rows: any) => void;
  } = {},
) {
  let state: ApplyState = {
    days: [],
    destinations: [],
    items: [],
    places: draft.places
      .filter((place) => place.resolution === 'verified')
      .filter((_, index) => !(options.missingVerifiedPlace && index === 0))
      .map((place) => ({
        customTimeZone: null,
        id: place.resolution === 'verified' ? place.placeId : '',
        kind: 'PROVIDER',
        ownerId: null,
        providerAddress: `${place.name}, Japan`,
      })),
    runs: [],
    savedPlaces: [],
    sessions: [makeSession(draft, options.session)],
    tripPlaces: [],
    trips: [],
  };
  let transactionTail = Promise.resolve();
  let idCounter = 100;
  const id = () => `00000000-0000-4000-8000-${String(idCounter++).padStart(12, '0')}`;
  const sessionMatches = (session: SessionState, where: Record<string, any> = {}) =>
    matches(session.id, where.id) &&
    matches(session.ownerId, where.ownerId) &&
    matches(session.status, where.status) &&
    matches(session.draftRevision, where.draftRevision) &&
    matches(session.appliedTripId, where.appliedTripId) &&
    matches(session.expiresAt, where.expiresAt) &&
    (!where.OR ||
      where.OR.some((clause: Record<string, unknown>) =>
        Object.entries(clause).every(([key, filter]) =>
          matches((session as unknown as Record<string, unknown>)[key], filter),
        ),
      ));

  const transactionFor = (working: ApplyState) => ({
    $queryRaw: async () => [],
    aiGenerationRun: {
      findMany: async () => [],
      async deleteMany() {
        return { count: 0 };
      },
      async updateMany({ where, data }: any) {
        const matching = working.runs.filter(
          (run) =>
            matches(run.ownerId, where.ownerId) &&
            matches(run.result, where.result) &&
            matches(run.sessionId, where.sessionId),
        );
        matching.forEach((run) => Object.assign(run, data));
        return { count: matching.length };
      },
    },
    aiPlanningSession: {
      async count({ where }: any) {
        return working.sessions.filter((session) => sessionMatches(session, where)).length;
      },
      async findFirst({ where }: any) {
        const session = working.sessions.find((candidate) => sessionMatches(candidate, where));
        return session ? { ...session, runs: [] } : null;
      },
      async updateMany({ where, data }: any) {
        const matching = working.sessions.filter((session) => sessionMatches(session, where));
        matching.forEach((session) => {
          for (const [key, value] of Object.entries(data)) {
            if ((key === 'draft' || key === 'planScore') && value === Prisma.DbNull) {
              (session as unknown as Record<string, unknown>)[key] = null;
            } else (session as unknown as Record<string, unknown>)[key] = value;
          }
        });
        return { count: matching.length };
      },
    },
    itineraryDay: {
      async create({ data }: any) {
        assertDayTimeZoneSourceContext(data);
        const value = { routeStartTravelMode: 'DRIVE', ...data, id: id() };
        working.days.push(value);
        return { id: value.id };
      },
      async update({ where, data }: any) {
        const day = working.days.find((candidate) => candidate.id === where.id);
        if (!day) throw new Error('day_not_found');
        Object.assign(day, data);
        assertDayTimeZoneSourceContext(day);
        return day;
      },
    },
    itineraryItem: {
      async create({ data }: any) {
        if (options.failAt === 'item') throw new Error('injected_item_failure');
        assertItemLocalTimeContext(data);
        const value = { travelModeToNext: 'DRIVE', ...data, id: id() };
        working.items.push(value);
        return { id: value.id };
      },
    },
    place: {
      async create({ data }: any) {
        const value = { ...data, id: id(), providerAddress: null };
        working.places.push(value);
        return { id: value.id };
      },
      async findMany({ where }: any) {
        return working.places
          .filter((place) => where.id.in.includes(place.id))
          .map(({ customTimeZone, id: placeId, kind, ownerId, providerAddress }) => ({
            customTimeZone,
            id: placeId,
            kind,
            ownerId,
            providerAddress,
          }));
      },
    },
    profile: {
      async findUniqueOrThrow() {
        return { homeTimeZone: null, id: OWNER_ID };
      },
      async upsert() {
        return { id: OWNER_ID };
      },
    },
    trip: {
      async create({ data }: any) {
        const value = { ...data, id: id() };
        working.trips.push(value);
        return { id: value.id };
      },
      // Apply reads the rows it just wrote to key the carried score, through the
      // same shape the scorer uses.
      async findFirstOrThrow({ where }: any) {
        const trip = working.trips.find((candidate) => candidate.id === where.id);
        if (!trip) throw new Error('trip_not_found');
        const rows = {
          ...trip,
          itineraryDays: working.days.map((day) => ({
            ...day,
            items: working.items
              .filter((item) => item.itineraryDayId === day.id)
              .toSorted((left, right) => left.position - right.position)
              .map((item) => ({ ...item, _count: { reservations: 0 } })),
          })),
          reservations: [],
          tripPlaces: working.tripPlaces.map((tripPlace) => ({
            ...tripPlace,
            place: { providerRefs: [] },
          })),
        };
        options.adjustAppliedRows?.(rows);
        return rows;
      },
      async update({ where, data }: any) {
        const trip = working.trips.find((candidate) => candidate.id === where.id);
        if (!trip) throw new Error('trip_not_found');
        Object.assign(trip, data);
        return trip;
      },
    },
    tripDestination: {
      async createMany({ data }: any) {
        working.destinations.push(...data);
        return { count: data.length };
      },
    },
    tripPlace: {
      async create({ data }: any) {
        const value = { ...data, id: id() };
        working.tripPlaces.push(value);
        return { id: value.id };
      },
    },
  });

  const prisma = {
    $transaction<T>(callback: (transaction: any) => Promise<T>) {
      const operation = transactionTail.then(async () => {
        const working = structuredClone(state);
        const result = await callback(transactionFor(working));
        state = working;
        return result;
      });
      transactionTail = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    },
  };

  return {
    get state() {
      return state;
    },
    prisma,
  };
}

function apply(
  store: ReturnType<typeof createApplyStore>,
  overrides: { now?: Date; ownerId?: string; revision?: number } = {},
) {
  return applyAiPlanningSession(
    overrides.ownerId ?? OWNER_ID,
    SESSION_ID,
    overrides.revision ?? 1,
    'Asia/Singapore',
    { now: () => overrides.now ?? NOW, prisma: store.prisma as never },
  );
}

describe('AI planning Apply', () => {
  test('requires confirmed countries and preserves their reviewed order', async () => {
    const unreviewed = createApplyStore(explicitDraft(), {
      session: { countriesReviewedRevision: null, reviewedCountries: [] },
    });
    await expect(apply(unreviewed)).rejects.toMatchObject({ code: 'countries_not_reviewed' });
    expect(unreviewed.state.trips).toHaveLength(0);

    const invalid = createApplyStore(explicitDraft(), {
      session: { reviewedCountries: ['XX'] },
    });
    await expect(apply(invalid)).rejects.toMatchObject({ code: 'invalid_countries' });
    expect(invalid.state.trips).toHaveLength(0);

    const reviewed = createApplyStore(explicitDraft(), {
      session: { reviewedCountries: ['KR', 'JP'] },
    });
    await apply(reviewed);
    await apply(reviewed);
    expect(reviewed.state.trips).toHaveLength(1);
    expect(reviewed.state.trips[0]?.countries).toStrictEqual(['KR', 'JP']);
  });

  test('Apply and expiry cleanup serialize without a partial Trip or retained review content', async () => {
    for (const sweepFirst of [false, true]) {
      const store = createApplyStore(customPlaceDraft(), {
        session: {
          expiresAt: NOW,
          tripName: 'Private reviewed title',
          tripDescription: 'Private reviewed description',
          planScore: emptyPlanScore(),
        },
      });
      const runApply = () => apply(store, { now: new Date(NOW.getTime() - 1) });
      const runSweep = () =>
        store.prisma.$transaction((transaction) =>
          cleanupAiPlanningRetention({ now: NOW, prisma: transaction as never }),
        );
      const [first, second] = await Promise.allSettled(
        sweepFirst ? [runSweep(), runApply()] : [runApply(), runSweep()],
      );
      expect(store.state.sessions[0]).toMatchObject({
        draft: null,
        rawPrompt: null,
        tripName: null,
        tripDescription: null,
        planScore: null,
        reviewedCountries: [],
        countriesReviewedRevision: null,
        countryContextChanged: false,
      });
      if (sweepFirst) {
        expect(first.status).toBe('fulfilled');
        expect(second).toMatchObject({
          status: 'rejected',
          reason: expect.objectContaining({ code: 'session_expired' }),
        });
        expect(store.state.trips).toHaveLength(0);
        expect(store.state.sessions[0]?.status).toBe('EXPIRED');
      } else {
        expect(first.status).toBe('fulfilled');
        expect(second.status).toBe('fulfilled');
        expect(store.state.trips).toHaveLength(1);
        expect(store.state.sessions[0]?.status).toBe('APPLIED');
      }
    }
  });

  test('an unscheduled exact time is dropped rather than written without an instant', async () => {
    // No date exists to resolve the instant against, and the schema cannot hold
    // a local time on its own, so the time is not carried onto the row.
    const draft = customPlaceDraft();
    const unscheduled = draft.unscheduledItems[0]!;
    // An exact time only ever reaches a draft from a traveller's own request, so
    // the item has to carry the constraint that authorises it or the draft is
    // not one the pipeline could have produced.
    draft.normalizedRequest.constraints.push({
      date: null,
      dayPart: null,
      destinationIntentId: null,
      durationMinutes: null,
      id: 'constraint:viewpoint',
      kind: 'activity',
      label: 'Viewpoint at 09:30',
      localTime: '09:30',
      priority: null,
      source: 'user',
      strength: 'flexible',
    });
    unscheduled.constraintIds = ['constraint:viewpoint'];
    unscheduled.origin = 'user';
    unscheduled.schedule = { kind: 'exact', localTime: '09:30', source: 'user' };
    const store = createApplyStore(draft);

    await apply(store);

    const applied = store.state.items.find((item) => item.customLabel === unscheduled.label);
    expect(applied).toMatchObject({
      localStartTime: null,
      startInstant: null,
      timeSemantics: null,
      timeProvenance: null,
    });
  });

  test('a day whose timezone comes from its first located item records that item', async () => {
    const store = createApplyStore(customPlaceDraft());

    await apply(store);

    const sourced = store.state.days.filter(
      (day) => day.defaultTimeZoneSource === 'FIRST_LOCATED_ITEM',
    );
    expect(sourced.length).toBeGreaterThan(0);
    for (const day of sourced) expect(day.defaultTimeZoneSourceItemId).not.toBeNull();
  });

  test('atomically creates standard trip records and preserves reviewed provenance', async () => {
    const draft = customPlaceDraft();
    draft.days[0]!.dailyBasePlaceRefId = 'place:custom';
    draft.days[1]!.items[1]!.schedule = {
      kind: 'exact',
      localTime: '13:00',
      source: 'model',
    };
    const store = createApplyStore(draft, {
      session: {
        tripName: 'Private reviewed title',
        tripDescription: 'Private reviewed description',
        planScore: emptyPlanScore(),
      },
    });
    const first = await apply(store);

    expect(store.state.trips).toHaveLength(1);
    expect(store.state.destinations).toHaveLength(1);
    expect(store.state.days).toHaveLength(3);
    expect(store.state.tripPlaces).toHaveLength(2);
    expect(store.state.items).toHaveLength(3);
    expect(store.state.items.map((item) => item.durationProvenance)).toStrictEqual([
      'USER_OWNED',
      'AI_ESTIMATED',
      'AI_ESTIMATED',
    ]);
    expect(store.state.items.map((item) => item.timeProvenance)).toStrictEqual([
      'USER_OWNED',
      'AI_ESTIMATED',
      null,
    ]);
    expect(store.state.items.map((item) => item.position)).toStrictEqual([0, 1, 0]);
    expect(store.state.trips[0]).toMatchObject({ referenceTimeZone: 'Asia/Tokyo' });
    expect(store.state.items[0]).toMatchObject({
      localStartTime: new Date('1970-01-01T09:00:00.000Z'),
      timeZone: 'Asia/Tokyo',
    });
    expect(store.state.items[1]).toMatchObject({
      localStartTime: new Date('1970-01-01T13:00:00.000Z'),
      timeProvenance: 'AI_ESTIMATED',
    });
    expect(store.state.items.find((item) => item.itineraryDayId === undefined)).toMatchObject({
      customLabel: 'Quiet neighborhood viewpoint',
      dayPart: 'ANYTIME',
      durationProvenance: 'AI_ESTIMATED',
    });
    expect(store.state.places.find((place) => place.kind === 'CUSTOM')).toMatchObject({
      customName: 'Quiet neighborhood viewpoint',
      customNote: 'Ask locally for the best access point.',
      ownerId: OWNER_ID,
    });
    const customPlace = store.state.places.find((place) => place.kind === 'CUSTOM');
    const customTripPlace = store.state.tripPlaces.find(
      (tripPlace) => tripPlace.placeId === customPlace?.id,
    );
    expect(store.state.days[0]).toMatchObject({ dailyBaseTripPlaceId: customTripPlace?.id });
    expect(store.state.savedPlaces).toHaveLength(0);
    expect(store.state.runs).toHaveLength(0);
    expect(store.state.sessions[0]).toMatchObject({
      appliedTripId: first.tripId,
      draft: null,
      rawPrompt: null,
      tripName: null,
      tripDescription: null,
      planScore: null,
      stage: 'COMPLETE',
      status: 'APPLIED',
    });

    store.state.sessions[0]!.expiresAt = new Date(NOW.getTime() - 1);
    store.state.sessions[0]!.tripName = 'Legacy retained title';
    store.state.sessions[0]!.tripDescription = 'Legacy retained description';
    store.state.sessions[0]!.planScore = emptyPlanScore();
    const retry = await apply(store, { revision: 999 });
    expect(retry).toStrictEqual(first);
    expect(store.state.sessions[0]).toMatchObject({
      tripName: null,
      tripDescription: null,
      planScore: null,
    });
    expect(store.state.trips).toHaveLength(1);
    expect(store.state.items).toHaveLength(3);
  });

  test('never waits on a warning acknowledgement, even for a retained material warning', async () => {
    const draft = explicitDraft();
    draft.warnings.push({
      code: 'route_conflict',
      evidenceIds: [],
      id: 'warning:material',
      itemIds: ['item:meeting'],
      material: true,
    });
    const store = createApplyStore(draft);
    await expect(apply(store)).resolves.toHaveProperty('tripId');
    expect(store.state.trips).toHaveLength(1);
  });

  test('stores each leg the way the draft travels it', async () => {
    const draft = explicitDraft();
    const day = draft.days.find((entry) => entry.items.length > 0)!;
    day.routeStartTravelMode = 'walk';
    day.items[0]!.travelModeToNext = 'transit';
    const store = createApplyStore(draft);
    await apply(store);
    expect(store.state.days.find((entry) => entry.routeStartTravelMode === 'WALK')).toBeDefined();
    expect(store.state.days.filter((entry) => entry.routeStartTravelMode === 'DRIVE').length).toBe(
      store.state.days.length - 1,
    );
    expect(
      store.state.items.find((item) => item.customLabel === day.items[0]!.label),
    ).toMatchObject({
      travelModeToNext: 'TRANSIT',
    });
    expect(store.state.items.filter((item) => item.travelModeToNext === 'DRIVE').length).toBe(
      store.state.items.length - 1,
    );
  });

  test('reports each Apply outcome as a content-free telemetry event', async () => {
    const events: AiPlanningTelemetryEvent[] = [];
    setAiPlanningTelemetrySink((event) => events.push(event));

    try {
      const store = createApplyStore(explicitDraft());

      await expect(apply(store, { revision: 0 })).rejects.toMatchObject({
        code: 'draft_conflict',
      });

      const applied = await apply(store);

      store.state.sessions[0]!.expiresAt = new Date(NOW.getTime() - 1);
      const replayed = await apply(store, { revision: 999 });
      expect(replayed).toStrictEqual(applied);
    } finally {
      setAiPlanningTelemetrySink(null);
    }

    // A replay is the idempotency path working, so it must be distinguishable
    // from a first Apply on a dashboard rather than inflating the applied count.
    expect(events).toStrictEqual([
      {
        code: 'draft_conflict',
        kind: 'apply_completed',
        occurredAt: NOW.toISOString(),
        outcome: 'rejected',
      },
      { code: null, kind: 'apply_completed', occurredAt: NOW.toISOString(), outcome: 'applied' },
      { code: null, kind: 'apply_completed', occurredAt: NOW.toISOString(), outcome: 'replayed' },
    ]);
  });

  test('serializes concurrent retries to exactly one Trip', async () => {
    const store = createApplyStore(explicitDraft());
    const [first, second] = await Promise.all([apply(store), apply(store)]);
    expect(second).toStrictEqual(first);
    expect(store.state.trips).toHaveLength(1);
    expect(store.state.destinations).toHaveLength(1);
  });

  test('rejects stale, cancelled, expired, and cross-owner sessions safely', async () => {
    const stale = createApplyStore(explicitDraft());
    await expect(apply(stale, { revision: 0 })).rejects.toMatchObject({
      code: 'draft_conflict',
      statusCode: 409,
    });

    const cancelled = createApplyStore(explicitDraft(), {
      session: { draft: null, status: 'CANCELLED' },
    });
    await expect(apply(cancelled)).rejects.toMatchObject({ code: 'draft_conflict' });

    const expired = createApplyStore(explicitDraft(), {
      session: { expiresAt: new Date(NOW.getTime() - 1) },
    });
    await expect(apply(expired)).rejects.toMatchObject({
      code: 'session_expired',
      statusCode: 410,
    });
    expect(expired.state.sessions[0]).toMatchObject({ draft: null, status: 'EXPIRED' });

    const isolated = createApplyStore(explicitDraft());
    await expect(apply(isolated, { ownerId: OTHER_OWNER_ID })).rejects.toMatchObject({
      code: 'session_not_found',
      statusCode: 404,
    });

    await expect(
      applyAiPlanningSession(OWNER_ID, SESSION_ID, 1, 'not/a-zone', {
        now: () => NOW,
        prisma: isolated.prisma as never,
      }),
    ).rejects.toMatchObject({ code: 'invalid_time_zone', statusCode: 400 });
  });

  test('rolls back missing canonical references and downstream write failures', async () => {
    const missing = createApplyStore(explicitDraft(), { missingVerifiedPlace: true });
    await expect(apply(missing)).rejects.toMatchObject({ code: 'draft_invalid' });
    expect(missing.state.trips).toHaveLength(0);
    expect(missing.state.sessions[0]).toMatchObject({
      draft: explicitDraft(),
      status: 'REVIEWING',
    });

    const failed = createApplyStore(customPlaceDraft(), { failAt: 'item' });
    await expect(apply(failed)).rejects.toThrow('injected_item_failure');
    expect(failed.state).toMatchObject({
      days: [],
      destinations: [],
      items: [],
      tripPlaces: [],
      trips: [],
    });
    expect(failed.state.places.filter((place) => place.kind === 'CUSTOM')).toHaveLength(0);
    expect(failed.state.sessions[0]).toMatchObject({
      draft: customPlaceDraft(),
      status: 'REVIEWING',
    });
  });
});

/**
 * The run already paid for the evidence behind the draft's score, so the applied
 * trip must not buy the same judgement again. The identifiers have to move with
 * it: the itinerary panel picks a day by `dayId` and focuses a suggestion by its
 * reference, and a draft names days by date and places by draft reference.
 */
test('the draft score is carried onto the trip, keyed and remapped to its rows', async () => {
  const draft = scoreableDraft();
  const dayItem = draft.days.flatMap((day) => day.items)[0];
  if (!dayItem) throw new Error('fixture missing a scheduled item');

  const planScore = {
    ...draftAssessment(draft),
    presentation: {
      adjustments: { fatigue: 2, weakDays: 3 },
      revisions: {
        planning: 'original-plan',
        evidence: 'original-evidence',
        destinationContext: 'original-context',
      },
      referenceTargets: {
        [dayItem.id]: {
          kind: 'item' as const,
          dayId: draft.days.find((day) => day.items.includes(dayItem))!.date,
        },
      },
    },
    days: draft.days.map((day) => ({
      ...toPlanScoreDayPayload(scoreDay({ dayId: day.date, factors: {} })),
      completeness: 80,
      confidence: 90,
      date: day.date,
      dayId: day.date,
      explanations: {
        uncertainty: [],
        whatWorks: [],
        worthImproving: [
          {
            action: 'ADJUST_TIME' as const,
            code: 'TIGHT_TRANSITION',
            severity: 'RISK' as const,
            factor: 'FEASIBILITY',
            messageKey: 'feasibility.tight',
            references: [dayItem.id],
            values: {},
          },
        ],
      },
      score: 72,
      withheldReasons: [],
    })),
  };

  const store = createApplyStore(draft, { session: { planScore } });
  await apply(store);

  const trip = store.state.trips[0]!;
  expect(trip.planScoreRevision, 'a carried score must be keyed to its trip').toEqual(
    expect.any(String),
  );
  expect(trip.planScoreComputedAt).toEqual(new Date(planScore.generatedAt));

  const stored = trip.planScore as typeof planScore;
  expect(stored.presentation.adjustments).toEqual(planScore.presentation.adjustments);
  expect(stored.presentation.revisions).toEqual(planScore.presentation.revisions);
  expect(Object.values(stored.presentation.referenceTargets)[0]).toEqual({
    kind: 'item',
    dayId: stored.days.find(
      (day) => day.date === draft.days.find((day) => day.items.includes(dayItem))!.date,
    )!.dayId,
  });
  expect(store.state.items.map((item: any) => item.blockType)).toEqual(
    draft.days
      .flatMap((day) => day.items.map((item) => item.blockType))
      .concat(draft.unscheduledItems.map((item) => item.blockType)),
  );
  expect(stored.generatedAt).toBe(planScore.generatedAt);
  expect(stored.recomputeAfter).toBe(planScore.recomputeAfter);
  const dayIds = store.state.days.map((day) => day.id);
  const itemIds = new Set(store.state.items.map((item) => item.id));

  // A date would match no day on the trip, and the panel would render nothing.
  for (const day of stored.days) expect(dayIds).toContain(day.dayId);
  for (const reference of stored.days.flatMap((day) =>
    day.explanations.worthImproving.flatMap((entry) => entry.references),
  )) {
    expect(itemIds, 'a suggestion must point at a row that exists').toContain(reference);
  }
});

/**
 * Two readings of a trip would be two things to keep in step with the rubric, so
 * Apply and the scorer share one. This fails the moment they stop agreeing.
 */
test('the revision Apply stores is the one the scorer derives from the same trip', async () => {
  const draft = scoreableDraft();
  const store = createApplyStore(draft, { session: { planScore: draftAssessment(draft) } });
  await apply(store);

  const trip = store.state.trips[0]!;
  const rows = {
    ...trip,
    itineraryDays: store.state.days.map((day) => ({
      ...day,
      items: store.state.items
        .filter((item) => item.itineraryDayId === day.id)
        .toSorted((left, right) => left.position - right.position)
        .map((item) => ({ ...item, _count: { reservations: 0 } })),
    })),
    reservations: [],
    tripPlaces: store.state.tripPlaces.map((tripPlace) => ({ ...tripPlace })),
  };

  expect(readPlanScoreInputs(rows as never).revision).toBe(trip.planScoreRevision);
});

test('Apply preserves older mutable evidence, not identity age, and replay never renews it', async () => {
  resetProviderCallCounts();
  const draft = scoreableDraft();
  const score = {
    ...draftAssessment(draft),
    evidenceAsOf: new Date(NOW.getTime() - 2 * 3_600_000).toISOString(),
  };
  const original = structuredClone(score);
  const store = createApplyStore(draft, {
    session: {
      planScore: score,
      tripName: 'Reviewed title',
      tripDescription: 'Reviewed description',
    },
  });
  const [first, concurrent] = await Promise.all([apply(store), apply(store)]);
  expect(concurrent).toEqual(first);
  expect(store.state.trips).toHaveLength(1);
  expect(store.state.trips[0]?.planScoreComputedAt).toEqual(new Date(score.generatedAt));
  await expect(
    apply(store, { now: new Date(NOW.getTime() + 2 * PLAN_SCORE_CACHE_TTL_MS) }),
  ).resolves.toEqual(first);
  expect(store.state.trips[0]?.planScoreComputedAt).toEqual(new Date(score.generatedAt));
  expect(store.state.trips[0]?.planScore.generatedAt).toBe(score.generatedAt);
  expect(score).toEqual(original);
  expect(store.state.runs).toHaveLength(0);
  expect(getProviderCallCounts()).toEqual({});
});

test('Apply succeeds but withholds expired, malformed, future, or unbound assessments', async () => {
  const draft = scoreableDraft();
  const base = draftAssessment(draft);
  const expired = new Date(NOW.getTime() - PLAN_SCORE_CACHE_TTL_MS).toISOString();
  for (const score of [
    { ...base, generatedAt: expired },
    { ...base, evidenceAsOf: expired, recomputeAfter: expired },
    { ...base, evidenceAsOf: new Date(NOW.getTime() - 30 * PLAN_SCORE_CACHE_TTL_MS).toISOString() },
    { ...base, generatedAt: 'not-a-date' },
    { ...base, evidenceAsOf: new Date(NOW.getTime() + 1).toISOString() },
    { ...base, generatedAt: new Date(NOW.getTime() + 1).toISOString() },
    { ...base, sourceInputRevision: undefined },
    { ...base, evidenceAsOf: undefined },
    { ...base, evidenceAsOf: null },
    { ...base, days: 'invalid' },
  ]) {
    const store = createApplyStore(draft, { session: { planScore: score } });
    await expect(apply(store)).resolves.toHaveProperty('tripId');
    expect(store.state.trips[0]?.planScore).toBeUndefined();
    expect(store.state.trips[0]?.planScoreComputedAt).toBeUndefined();
  }
});

test('scoring changes invalidate a bound assessment while review copy does not', async () => {
  const edits: Array<(draft: AiPlannerDraft) => void> = [
    (draft) => {
      draft.days[1]!.items[1]!.durationMinutes = 90;
    },
    (draft) => {
      draft.days[1]!.items[1]!.schedule = { kind: 'exact', localTime: '13:00', source: 'model' };
    },
    (draft) => {
      draft.days[1]!.items.reverse();
    },
    (draft) => {
      const place = draft.places[0]!;
      if (place.resolution === 'verified') place.placeId = '00000000-0000-4000-8000-000000000099';
    },
    (draft) => {
      draft.unscheduledItems[0]!.priority = 'interested';
    },
  ];
  for (const edit of edits) {
    const draft = scoreableDraft();
    const score = draftAssessment(draft);
    edit(draft);
    const store = createApplyStore(draft, { session: { planScore: score } });
    await apply(store);
    expect(store.state.trips[0]?.planScore).toBeUndefined();
  }
  const draft = scoreableDraft();
  const score = draftAssessment(draft);
  const countryChanged = createApplyStore(draft, {
    session: {
      planScore: score,
      countryContextChanged: true,
      warningsAcknowledgedRevision: 1,
      warningsAcknowledgedAt: NOW,
    },
  });
  await apply(countryChanged);
  expect(countryChanged.state.trips[0]?.planScore).toBeUndefined();
});

test('reuse requires the materialized rows to match the normal scorer inputs', async () => {
  const changes: Array<(rows: any) => void> = [
    (rows) => {
      rows.itineraryDays[1].defaultTimeZone = 'UTC';
    },
    (rows) => {
      rows.itineraryDays[1].items[1].durationMinutes += 1;
    },
    (rows) => {
      rows.itineraryDays[1].items[0].localStartTime = new Date('1970-01-01T10:00:00Z');
    },
    (rows) => {
      rows.itineraryDays[1].items.reverse();
    },
    (rows) => {
      rows.itineraryDays[1].items[1].travelModeToNext = 'WALK';
    },
    (rows) => {
      rows.tripPlaces[0].priority = null;
    },
    (rows) => {
      rows.tripPlaces[0].placeId = '00000000-0000-4000-8000-000000000098';
    },
  ];
  for (const adjustAppliedRows of changes) {
    const draft = scoreableDraft();
    const store = createApplyStore(draft, {
      session: { planScore: draftAssessment(draft) },
      adjustAppliedRows,
    });
    await apply(store);
    expect(store.state.trips[0]?.planScore).toBeUndefined();
  }
});

/**
 * The model now drafts a description, so the trip should never land blank just
 * because nobody typed in the review field. The traveller's own words still win
 * when they wrote any — that is the whole point of the field being editable.
 */
test('the drafted description reaches the trip, and a traveller override outranks it', async () => {
  const draft = customPlaceDraft();
  draft.trip.description = 'A slow week in Kyoto, planned around what there is to eat.';

  const drafted = createApplyStore(draft);
  await apply(drafted);
  expect(drafted.state.trips[0]).toMatchObject({
    description: 'A slow week in Kyoto, planned around what there is to eat.',
    name: draft.trip.name,
  });

  const overridden = createApplyStore(draft, {
    session: { tripDescription: 'Our anniversary trip.' },
  });
  await apply(overridden);
  expect(overridden.state.trips[0]).toMatchObject({ description: 'Our anniversary trip.' });
});

test('a trip applied from a draft written before descriptions existed keeps a null one', async () => {
  const draft = customPlaceDraft();
  draft.trip.description = null;
  const store = createApplyStore(draft);

  await apply(store);

  expect(store.state.trips[0]).toMatchObject({ description: null });
});

test('Apply persists optional generated day names and accepts legacy unnamed days', async () => {
  const named = customPlaceDraft();
  named.days[0]!.name = 'Kyoto food and lanes';
  const store = createApplyStore(named);
  await apply(store);
  expect(store.state.days[0]).toMatchObject({ name: 'Kyoto food and lanes' });

  const legacy = customPlaceDraft();
  delete legacy.days[0]!.name;
  const oldStore = createApplyStore(legacy);
  await apply(oldStore);
  expect(oldStore.state.days[0]).toMatchObject({ name: null });
});

/**
 * A traveller renaming the trip during review works the same way as the
 * description: the model's title is the floor, the traveller's own choice
 * outranks it when set.
 */
test('a traveller-set trip name outranks the drafted one', async () => {
  const draft = customPlaceDraft();

  const drafted = createApplyStore(draft);
  await apply(drafted);
  expect(drafted.state.trips[0]).toMatchObject({ name: draft.trip.name.trim() });

  const overridden = createApplyStore(draft, { session: { tripName: 'Our anniversary trip' } });
  await apply(overridden);
  expect(overridden.state.trips[0]).toMatchObject({ name: 'Our anniversary trip' });
});

test('Apply persists explicit pace and interests beyond session retention', async () => {
  const draft = scoreableDraft();
  draft.normalizedRequest.interests = ['History', 'Bird watching'];
  draft.normalizedRequest.pace = 'relaxed';
  draft.trip.pace = 'relaxed';
  draft.trip.paceSource = 'user';
  draft.trip.paceAssumptionId = null;
  const store = createApplyStore(draft);
  await apply(store);
  expect(store.state.trips[0]?.planningPreferences).toEqual({
    pace: 'relaxed',
    interests: ['culture_history'],
    unmatchedInterests: ['Bird watching'],
  });
  expect(store.state.sessions[0]?.draft).toBeNull();
});
