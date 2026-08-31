import { Prisma } from '@trove/db';
import type { AiPlannerDraft } from '@trove/types';
import { describe, expect, test } from 'vitest';

import { applyAiPlanningSession } from '../src/services/ai-planning-apply.js';
import {
  setAiPlanningTelemetrySink,
  type AiPlanningTelemetryEvent,
} from '../src/services/ai-planning-telemetry.js';
import { customPlaceDraft, explicitDraft } from './fixtures/ai-planning.js';

const OWNER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_OWNER_ID = '00000000-0000-4000-8000-000000000002';
const SESSION_ID = '00000000-0000-4000-8000-000000000010';
const NOW = new Date('2026-08-31T12:00:00.000Z');

type SessionState = {
  appliedTripId: string | null;
  createdAt: Date;
  draft: AiPlannerDraft | null;
  draftRevision: number;
  expiresAt: Date;
  id: string;
  lastErrorCode: string | null;
  ownerId: string;
  rawPrompt: string | null;
  schemaVersion: number;
  stage: string;
  status: string;
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
    rawPrompt: 'Plan Tokyo',
    schemaVersion: 1,
    stage: 'REVIEWING',
    status: 'REVIEWING',
    updatedAt: NOW,
    warningsAcknowledgedAt: null,
    warningsAcknowledgedRevision: null,
    ...overrides,
  };
}

function matches(value: unknown, expected: unknown) {
  if (expected === undefined) return true;
  if (expected && typeof expected === 'object' && 'in' in expected) {
    return (expected.in as unknown[]).includes(value);
  }
  return value === expected;
}

function createApplyStore(
  draft: AiPlannerDraft,
  options: {
    failAt?: 'item';
    missingVerifiedPlace?: boolean;
    session?: Partial<SessionState>;
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

  const transactionFor = (working: ApplyState) => ({
    $queryRaw: async () => [],
    aiGenerationRun: {
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
      async findFirst({ where }: any) {
        const session = working.sessions.find(
          (candidate) =>
            matches(candidate.id, where.id) && matches(candidate.ownerId, where.ownerId),
        );
        return session ? { ...session, runs: [] } : null;
      },
      async updateMany({ where, data }: any) {
        const matching = working.sessions.filter(
          (session) =>
            matches(session.id, where.id) &&
            matches(session.ownerId, where.ownerId) &&
            matches(session.status, where.status) &&
            matches(session.draftRevision, where.draftRevision) &&
            matches(session.appliedTripId, where.appliedTripId),
        );
        matching.forEach((session) => {
          for (const [key, value] of Object.entries(data)) {
            if (key === 'draft' && value === Prisma.DbNull) session.draft = null;
            else (session as unknown as Record<string, unknown>)[key] = value;
          }
        });
        return { count: matching.length };
      },
    },
    itineraryDay: {
      async create({ data }: any) {
        const value = { ...data, id: id() };
        working.days.push(value);
        return { id: value.id };
      },
      async update({ where, data }: any) {
        const day = working.days.find((candidate) => candidate.id === where.id);
        if (!day) throw new Error('day_not_found');
        Object.assign(day, data);
        return day;
      },
    },
    itineraryItem: {
      async create({ data }: any) {
        if (options.failAt === 'item') throw new Error('injected_item_failure');
        const value = { ...data, id: id() };
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
        return { homePlace: null, id: OWNER_ID };
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
  overrides: { ownerId?: string; revision?: number } = {},
) {
  return applyAiPlanningSession(
    overrides.ownerId ?? OWNER_ID,
    SESSION_ID,
    overrides.revision ?? 1,
    'Asia/Singapore',
    { now: () => NOW, prisma: store.prisma as never },
  );
}

describe('AI planning Apply', () => {
  test('atomically creates standard trip records and preserves reviewed provenance', async () => {
    const draft = customPlaceDraft();
    draft.days[0]!.dailyBasePlaceRefId = 'place:custom';
    const store = createApplyStore(draft);
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
    expect(store.state.items.map((item) => item.position)).toStrictEqual([0, 1, 0]);
    expect(store.state.trips[0]).toMatchObject({ referenceTimeZone: 'Asia/Tokyo' });
    expect(store.state.items[0]).toMatchObject({
      localStartTime: new Date('1970-01-01T09:00:00.000Z'),
      timeZone: 'Asia/Tokyo',
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
      stage: 'COMPLETE',
      status: 'APPLIED',
    });

    store.state.sessions[0]!.expiresAt = new Date(NOW.getTime() - 1);
    const retry = await apply(store, { revision: 999 });
    expect(retry).toStrictEqual(first);
    expect(store.state.trips).toHaveLength(1);
    expect(store.state.items).toHaveLength(3);
  });

  test('requires acknowledgement only for material warnings', async () => {
    const draft = explicitDraft();
    draft.warnings.push({
      code: 'route_conflict',
      evidenceIds: [],
      id: 'warning:material',
      itemIds: ['item:meeting'],
      material: true,
    });
    const store = createApplyStore(draft);
    await expect(apply(store)).rejects.toMatchObject({
      code: 'warnings_not_acknowledged',
      statusCode: 409,
    });
    expect(store.state.trips).toHaveLength(0);

    store.state.sessions[0]!.warningsAcknowledgedAt = NOW;
    store.state.sessions[0]!.warningsAcknowledgedRevision = 1;
    await expect(apply(store)).resolves.toHaveProperty('tripId');
  });

  test('reports each Apply outcome as a content-free telemetry event', async () => {
    const events: AiPlanningTelemetryEvent[] = [];
    setAiPlanningTelemetrySink((event) => events.push(event));

    try {
      const draft = explicitDraft();
      draft.warnings.push({
        code: 'route_conflict',
        evidenceIds: [],
        id: 'warning:material',
        itemIds: ['item:meeting'],
        material: true,
      });
      const store = createApplyStore(draft);

      await expect(apply(store)).rejects.toMatchObject({ code: 'warnings_not_acknowledged' });

      store.state.sessions[0]!.warningsAcknowledgedAt = NOW;
      store.state.sessions[0]!.warningsAcknowledgedRevision = 1;
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
        code: 'warnings_not_acknowledged',
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
