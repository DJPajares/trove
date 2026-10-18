import { expect, test } from 'vitest';
import { draftDayStay, parseAiPlannerDraft } from '@trove/types';
import {
  refreshDraftMainStay,
  normalizeProposedStays,
  mainStayCandidateId,
  proposedStayNights,
} from '../src/services/ai-planning-stays.js';
import { assembleAiPlanningDraft } from '../src/services/ai-planning-pipeline.js';
import { groundableDraftPlaceIds } from '../src/services/ai-planning-draft-places.js';
import { groupAppliedStays } from '../src/services/stay-plan-rules.js';
import { resolveDayStay } from '../src/services/day-stay.js';
import { explicitModelProposal } from './fixtures/ai-planning.js';

type Stay = NonNullable<ReturnType<typeof explicitModelProposal>['stays']>[number];
const stay = (
  candidatePlaceId: string,
  first: number | null,
  last: number | null,
  extra: Partial<Stay> = {},
): Stay => ({
  candidatePlaceId,
  firstNightDayIndex: first,
  lastNightDayIndex: last,
  source: 'user',
  ...extra,
});
const now = new Date('2026-09-01');

function draftWith(stays: Stay[], days = 6) {
  const proposal = explicitModelProposal();
  proposal.normalizedRequest.datePreference = {
    kind: 'exact',
    startDate: '2026-10-02',
    endDate: `2026-10-${String(days + 1).padStart(2, '0')}`,
  };
  proposal.stays = stays;
  proposal.places.push(
    ...[...new Set(stays.map((s) => s.candidatePlaceId))].map((id) => ({
      id,
      name: `Hotel ${id}`,
      note: null,
      searchQuery: `Hotel ${id} Tokyo`,
    })),
  );
  return assembleAiPlanningDraft(proposal, now);
}

test('three stays retain check-in, transfer and checkout-only endpoints', () => {
  const draft = draftWith([stay('a', 0, 1), stay('b', 2, 2), stay('c', 3, 4)]);
  expect(draft.days.map(draftDayStay)).toEqual([
    { start: null, end: 'a' },
    { start: 'a', end: 'a' },
    { start: 'a', end: 'b' },
    { start: 'b', end: 'c' },
    { start: 'c', end: 'c' },
    { start: 'c', end: null },
  ]);
  expect(parseAiPlannerDraft(draft).success).toBe(true);
});

test('main stay temporarily gives way to a sub-stay, then resumes', () => {
  const draft = draftWith([stay('a', 0, 4, { isMain: true }), stay('b', 2, 2)]);
  expect(draft.days.map(draftDayStay).slice(2, 5)).toEqual([
    { start: 'a', end: 'b' },
    { start: 'b', end: 'a' },
    { start: 'a', end: 'a' },
  ]);
  expect(draft.stays?.find((s) => s.isMain)?.placeRefId).toBe('a');
});

test('main selection counts repeated visits, honors explicit choice and breaks ties by arrival', () => {
  const stays = [stay('b', 2, 3), stay('a', 0, 1), stay('a', 4, 4)];
  expect(mainStayCandidateId(stays)).toBe('a');
  expect(mainStayCandidateId([stay('b', 2, 3), stay('a', 0, 1)])).toBe('a');
  expect(mainStayCandidateId([...stays, stay('c', 5, 5, { isMain: true })])).toBe('c');
});

test('missing and conflicting dates retain accommodations without inventing coverage', () => {
  const draft = draftWith([
    stay('a', null, null),
    stay('b', 2, 2),
    stay('c', 0, 4, { source: 'model' }),
  ]);
  expect(draft.stays?.map((s) => s.placeRefId)).toEqual(['a', 'b']);
  expect(groundableDraftPlaceIds(draft).has('a')).toBe(true);
  expect(draft.places.some((p) => p.id === 'a')).toBe(true);
  expect(draft.days.map(draftDayStay)).toEqual([
    { start: null, end: null },
    { start: null, end: null },
    { start: null, end: 'b' },
    { start: 'b', end: null },
    { start: null, end: null },
    { start: null, end: null },
  ]);
  const conflicting = normalizeProposedStays([stay('a', 0, 2), stay('b', 2, 3)], 6);
  expect(conflicting).toHaveLength(2);
  expect(
    conflicting.every(
      (s) => s.firstNightDayIndex === null && s.assignmentIssue === 'dates_conflicting',
    ),
  ).toBe(true);
});

test('user nights win over recommendations; recommended final evenings and opt-outs are never assigned', () => {
  const normalized = normalizeProposedStays(
    [stay('a', 1, 2), stay('b', 0, 5, { source: 'model' })],
    6,
  );
  expect([...proposedStayNights(normalized)].sort((a, b) => a[0] - b[0])).toEqual([
    [0, 'b'],
    [1, 'a'],
    [2, 'a'],
    [3, 'b'],
    [4, 'b'],
  ]);
  const proposal = explicitModelProposal();
  proposal.lodgingRecommendations = 'declined';
  proposal.stays = [stay(proposal.places[1]!.id, 0, 1, { source: 'model' })];
  expect(assembleAiPlanningDraft(proposal, now).stays).toEqual([]);
});

test('Apply compression preserves every endpoint while using the predominant main stay', () => {
  const draft = draftWith([stay('a', 0, 1), stay('b', 2, 2), stay('a', 3, 4)]);
  const days = draft.days.map((day) => ({ date: day.date, ...draftDayStay(day) }));
  const grouped = groupAppliedStays(days);
  expect(grouped.defaultTripPlaceId).toBe('a');
  expect(grouped.ranges).toEqual([
    { tripPlaceId: 'b', startDate: '2026-10-04', endDate: '2026-10-05' },
  ]);
  for (const day of days) {
    const override = grouped.overrides.get(day.date)!;
    const resolved = resolveDayStay(
      {
        id: day.date,
        date: new Date(day.date),
        ...override,
        dailyBaseTripPlace: override.dailyBaseTripPlaceId
          ? { id: override.dailyBaseTripPlaceId }
          : null,
        dailyBaseDepartureTripPlace: override.dailyBaseDepartureTripPlaceId
          ? { id: override.dailyBaseDepartureTripPlaceId }
          : null,
      },
      [],
      {
        startDate: new Date(draft.trip.startDate),
        endDate: new Date(draft.trip.endDate),
        defaultStayTripPlace: { id: grouped.defaultTripPlaceId! },
        stayRanges: grouped.ranges.map((r) => ({
          startDate: new Date(r.startDate),
          endDate: new Date(r.endDate),
          tripPlace: { id: r.tripPlaceId },
        })),
      },
    );
    expect([resolved.start?.place.id ?? null, resolved.end?.place.id ?? null]).toEqual([
      day.start,
      day.end,
    ]);
  }
});

test('explicit empty draft evenings differ from legacy same-start semantics', () => {
  const legacy = { dailyBasePlaceRefId: 'a', dailyBaseDeparturePlaceRefId: null };
  expect(draftDayStay(legacy)).toEqual({ start: 'a', end: 'a' });
  expect(draftDayStay({ ...legacy, stayEndMode: 'none' })).toEqual({ start: 'a', end: null });
  expect(draftDayStay({ ...legacy, stayEndMode: 'same_as_start' })).toEqual({
    start: 'a',
    end: 'a',
  });
});

test('verified aliases count as one main hotel across repeated visits', () => {
  const draft = draftWith([stay('alias-a', 0, 0), stay('b', 1, 2), stay('alias-c', 3, 4)]);
  expect(draft.stays?.find((s) => s.isMain)?.placeRefId).toBe('b');
  draft.places = draft.places.map((place) =>
    ['alias-a', 'alias-c'].includes(place.id)
      ? {
          id: place.id,
          name: 'Same hotel',
          placeId: '00000000-0000-4000-8000-000000000099',
          provider: 'google' as const,
          resolution: 'verified' as const,
        }
      : place,
  );
  refreshDraftMainStay(draft);
  expect(draft.stays?.filter((s) => s.isMain).map((s) => s.placeRefId)).toEqual([
    'alias-a',
    'alias-c',
  ]);
});

test('an undated explicitly named main stay keeps its intent without assigning nights', () => {
  const draft = draftWith([stay('a', null, null, { isMain: true })]);
  refreshDraftMainStay(draft);
  expect(draft.mainStaySource).toBe('user');
  expect(draft.stays?.[0]).toMatchObject({ isMain: true, arriveDate: null, leaveDate: null });
  expect(
    draft.days.every((day) => draftDayStay(day).start === null && draftDayStay(day).end === null),
  ).toBe(true);
  const grouped = groupAppliedStays(
    [
      { date: '2026-10-02', start: null, end: 'b' },
      { date: '2026-10-03', start: 'b', end: null },
    ],
    null,
  );
  expect(grouped.defaultTripPlaceId).toBeNull();
  expect(grouped.ranges).toHaveLength(1);
});
