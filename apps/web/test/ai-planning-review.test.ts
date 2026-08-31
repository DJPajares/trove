import { expect, test } from 'vitest';

import type { AiPlanningDraft } from '../lib/ai-planning/api.ts';
import { buildAiPlanningReviewMapPoints } from '../lib/ai-planning/review.ts';

function reviewDraft(): AiPlanningDraft {
  return {
    assumptions: [],
    days: [
      {
        dailyBaseDeparturePlaceRefId: null,
        dailyBasePlaceRefId: null,
        date: '2026-10-03',
        destinationId: null,
        items: [
          {
            blockType: 'activity',
            constraintIds: [],
            durationMinutes: 90,
            durationProvenance: 'ai_estimated',
            id: 'item:verified',
            isAnchor: false,
            label: 'Verified museum',
            notes: null,
            origin: 'model',
            placeRefId: 'place:verified',
            priority: null,
            schedule: { dayPart: 'afternoon', kind: 'day_part' },
          },
        ],
      },
    ],
    evidence: [],
    normalizedRequest: {},
    places: [
      {
        attributions: [],
        id: 'place:verified',
        location: { latitude: 35.71, longitude: 139.77 },
        name: 'Verified museum',
        placeId: '00000000-0000-4000-8000-000000000020',
        provider: 'google',
        resolution: 'verified',
      },
      {
        id: 'place:custom',
        name: 'My cousin’s café',
        note: null,
        resolution: 'custom',
        verification: 'unverified',
      },
      {
        attributions: [],
        id: 'place:legacy',
        name: 'Older verified place',
        placeId: '00000000-0000-4000-8000-000000000021',
        provider: 'google',
        resolution: 'verified',
      },
    ],
    schemaVersion: 1,
    trip: {
      dateAssumptionId: null,
      dateSource: 'user',
      destinations: [],
      endDate: '2026-10-03',
      name: 'Tokyo review',
      nameAssumptionId: null,
      nameSource: 'user',
      pace: 'balanced',
      paceAssumptionId: null,
      paceSource: 'user',
      partySize: 1,
      partySizeAssumptionId: null,
      partySizeSource: 'user',
      startDate: '2026-10-03',
    },
    unscheduledItems: [],
    warnings: [],
  };
}

test('review maps use only provider-derived coordinates and preserve item order', () => {
  expect(buildAiPlanningReviewMapPoints(reviewDraft())).toStrictEqual([
    expect.objectContaining({
      id: 'place:verified',
      itemId: 'item:verified',
      kind: 'scheduled',
      order: 1,
    }),
  ]);
});
