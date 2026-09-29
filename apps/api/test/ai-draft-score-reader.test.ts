import { afterEach, expect, test, vi } from 'vitest';
import { explicitDraft } from './fixtures/ai-planning.js';
import { readDraftPlanScore } from '../src/services/ai-draft-score-reader.js';
import { draftPlanScoreInputRevision } from '../src/services/ai-planning-plan-score.js';
import { parseStoredPlanScore } from '../src/services/plan-score.js';

const now = new Date('2026-09-29T00:00:00Z');
const acquired = new Date('2026-09-20T12:00:00Z');
const point = { latitude: 35.7188, longitude: 139.7765 };
const decimal = (n: number) => ({ toNumber: () => n });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

for (const state of ['cold', 'warm', 'expired'] as const)
  test(`retained ${state} AI drafts read only cached evidence and preserve the draft`, async () => {
    vi.stubEnv('TROVE_PLAN_SCORE_DISABLED', 'false');
    const draft = explicitDraft();
    draft.days[1]!.items[0]!.placeRefId = 'place:museum';
    const original = structuredClone(draft);
    const fetched = state === 'expired' ? new Date('2026-08-01') : acquired;
    const outbound = vi.fn(() => {
      throw new Error('provider/model call');
    });
    vi.stubGlobal('fetch', outbound);
    const reads = vi.fn(async () =>
      state === 'cold'
        ? null
        : {
            cachedEvidenceAt: fetched,
            cachedEvidence: {
              provider: 'google',
              externalPlaceId: 'museum',
              name: 'Tokyo National Museum',
              location: null,
              rawTypes: [],
              category: 'things_to_do',
              primaryType: null,
              formattedAddress: null,
              googleMapsUri: null,
              attributions: [],
              rating: 4.7,
              userRatingCount: 2000,
              openingPeriods: [],
              utcOffsetMinutes: 540,
            },
          },
    );
    vi.stubGlobal('trovePrismaClient', {
      place: {
        findMany: vi.fn(async () =>
          draft.places
            .filter((p) => p.resolution === 'verified')
            .map((p) => ({
              id: p.placeId,
              customName: null,
              customLatitude: null,
              customLongitude: null,
              providerRefs: [
                {
                  provider: 'GOOGLE',
                  externalPlaceId: 'museum',
                  cachedAt: fetched,
                  cachedName: p.name,
                  cachedLatitude: decimal(point.latitude),
                  cachedLongitude: decimal(point.longitude),
                  cachedTypes: ['museum'],
                },
              ],
            })),
        ),
      },
      placeProviderRef: { findUnique: reads },
      travelLegCache: { findUnique: vi.fn(async () => null) },
      weatherForecastSnapshot: { findUnique: vi.fn(async () => null) },
    });
    const first = await readDraftPlanScore(draft, now);
    const second = await readDraftPlanScore(draft, new Date(now.getTime() + 86400000));
    expect(parseStoredPlanScore(first)?.schemaVersion).toBe(7);
    expect(first.sourceInputRevision).toBe(draftPlanScoreInputRevision(draft));
    expect(second.generatedAt).toBe('2026-09-30T00:00:00.000Z');
    if (state === 'warm') {
      expect(first.evidenceAsOf).toBe(acquired.toISOString());
      expect(second.evidenceAsOf).toBe(first.evidenceAsOf);
      expect(second.evidenceExpiresAt).toBe(first.evidenceExpiresAt);
    }
    expect((globalThis as any).trovePrismaClient.travelLegCache.findUnique).not.toHaveBeenCalled();
    if (state !== 'expired')
      expect(first.days[1]?.factors.ROUTE_EFFICIENCY).toMatchObject({
        state: 'EVALUATED',
        score: 100,
      });
    expect(reads).toHaveBeenCalledTimes(2); // Same provider identity reused by both draft places, once per assessment.
    expect(
      first.days[1]?.explanations.worthImproving.some((r) => r.code === 'OUTSIDE_OPENING_HOURS'),
    ).toBe(false);
    expect(draft).toEqual(original);
    expect(outbound).not.toHaveBeenCalled();
  });
