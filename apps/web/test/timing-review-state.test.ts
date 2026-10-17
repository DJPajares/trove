import { describe, expect, it } from 'vitest';
import type { TimingIssue } from '@trove/types';
import type { ItineraryDay } from '@/lib/itinerary/api';
import {
  acknowledgeTimingReview,
  reconcileTimingReviewIssues,
  timingAssessmentRevision,
  timingReviewDays,
} from '@/lib/itinerary/timing-review-state';

const issue = (itemId: string, code: TimingIssue['code'] = 'TRAVEL_UNKNOWN'): TimingIssue => ({
  itemId,
  code,
  references: [],
  severity: 'review',
});
const day = (id: string, itemIds: string[]) =>
  ({
    id,
    items: itemIds.map((id, position) => ({ id, position, updatedAt: '2026-10-17T00:00:00Z' })),
  }) as ItineraryDay;
const days = [day('first', ['a', 'b']), day('second', ['c'])];
const proposal = { itineraryDayId: 'first', targetItemId: null, scheduleRevision: 'revision' };
const change = {
  itemId: 'a',
  itineraryDayId: 'first',
  before: { localTime: '08:00', localEndTime: null },
  after: { localTime: '09:00', localEndTime: null },
};

describe('timing review refresh', () => {
  it('observes only days mentioned by unresolved issues, including days not currently open', () => {
    expect(
      timingReviewDays({ changes: [], issues: [issue('a')] }, days).map((day) => day.id),
    ).toEqual(['first']);
    expect(timingReviewDays({ changes: [change], issues: [] }, days)).toEqual([]);
    expect(timingReviewDays(null, days)).toEqual([]);
  });
  it('clears a resolved travel warning without applying or discarding proposed changes', () => {
    const outcome = { changes: [change], issues: [issue('b')], proposals: [proposal] };
    const next = reconcileTimingReviewIssues(outcome, days, [
      { itineraryDayId: 'first', issues: [] },
    ]);
    expect(next.issues).toEqual([]);
    expect(next.changes).toBe(outcome.changes);
    expect(next.proposals).toBe(outcome.proposals);
    expect(outcome.issues).toHaveLength(1);
  });
  it('removes an issues-only notice once the path becomes known', () => {
    expect(
      reconcileTimingReviewIssues({ changes: [], issues: [issue('b')] }, days, [
        { itineraryDayId: 'first', issues: [] },
      ]),
    ).toEqual({ changes: [], issues: [] });
  });
  it('keeps warnings for days whose assessment has not succeeded', () => {
    const outcome = { changes: [], issues: [issue('b'), issue('c')] };
    expect(
      reconcileTimingReviewIssues(outcome, days, [{ itineraryDayId: 'first', issues: [] }]).issues,
    ).toEqual([issue('c')]);
    expect(reconcileTimingReviewIssues(outcome, days, [])).toBe(outcome);
  });
  it('shows newly verified conflicts instead of an obsolete missing-travel warning', () => {
    const conflict = issue('b', 'FIXED_CONFLICT');
    expect(
      reconcileTimingReviewIssues({ changes: [], issues: [issue('b')] }, days, [
        { itineraryDayId: 'first', issues: [conflict] },
      ]).issues,
    ).toEqual([conflict]);
  });
  it('does not recreate an acknowledged notice from an unrelated assessment', () => {
    const outcome = { changes: [], issues: [] };
    expect(
      reconcileTimingReviewIssues(outcome, days, [
        { itineraryDayId: 'first', issues: [issue('a')] },
      ]),
    ).toBe(outcome);
  });
  it('ignores issue order changes, and filters warnings for deleted stops', () => {
    const outcome = { changes: [], issues: [issue('a'), issue('b')] };
    expect(
      reconcileTimingReviewIssues(outcome, days, [
        { itineraryDayId: 'first', issues: [issue('b'), issue('a')] },
      ]),
    ).toBe(outcome);
    expect(
      reconcileTimingReviewIssues({ changes: [], issues: [issue('deleted')] }, days, []).issues,
    ).toEqual([]);
  });
  it('acknowledges saved changes but preserves genuinely unresolved warnings', () => {
    expect(acknowledgeTimingReview({ changes: [change], issues: [] })).toEqual({
      changes: [],
      issues: [],
    });
    expect(acknowledgeTimingReview({ changes: [change], issues: [issue('b')] })).toEqual({
      changes: [],
      issues: [issue('b')],
    });
  });
  it('shares the existing assessment key and changes it when stop evidence changes', () => {
    expect(timingAssessmentRevision(days[0]!)).toBe(
      JSON.stringify([
        undefined,
        days[0]!.items.map((item) => [item.id, item.updatedAt, item.position]),
      ]),
    );
    expect(
      timingAssessmentRevision({
        ...days[0]!,
        items: days[0]!.items.map((item) => ({ ...item, updatedAt: '2026-10-17T01:00:00Z' })),
      }),
    ).not.toBe(timingAssessmentRevision(days[0]!));
  });
});
