import { expect, test } from 'vitest';
import type { TimingIssue } from '@trove/types';
import { describeTimingIssue } from '../lib/itinerary/timing-issue-description';

const issue: TimingIssue = {
  code: 'FIXED_CONFLICT',
  itemId: 'lunch',
  references: ['shopping'],
  severity: 'conflict',
  orderConflict: {
    previousItemId: 'shopping',
    earliestStartLocal: '2026-09-08T12:02',
    scheduledStartLocal: '2026-09-08T11:30',
  },
};
const options = {
  locale: 'en',
  hour12: true,
  nameFor: () => 'Sylvia Park',
  t: (key: string, values?: Record<string, string>) => JSON.stringify({ key, ...values }),
};
test('explains the conflicting stop and uses unconverted local clocks', () => {
  expect(JSON.parse(describeTimingIssue(issue, options))).toEqual({
    key: 'connectedTiming.orderConflict',
    previous: 'Sylvia Park',
    earliest: '12:02 PM',
    scheduled: '11:30 AM',
  });
  expect(JSON.parse(describeTimingIssue(issue, { ...options, hour12: false })).earliest).toBe(
    '12:02',
  );
});
test('includes dates when the connection crosses midnight', () => {
  const nextDay = {
    ...issue,
    orderConflict: { ...issue.orderConflict!, earliestStartLocal: '2026-09-09T01:01' },
  };
  const text = JSON.parse(describeTimingIssue(nextDay, options));
  expect(text.earliest).toContain('Sep 9');
  expect(text.scheduled).toContain('Sep 8');
});
test('older responses and other causes retain the localized fallback', () => {
  const { orderConflict: _context, ...legacy } = issue;
  expect(JSON.parse(describeTimingIssue(legacy, options)).key).toBe(
    'connectedTiming.issue.FIXED_CONFLICT',
  );
  expect(JSON.parse(describeTimingIssue({ ...issue, code: 'BOOKING_DATE' }, options)).key).toBe(
    'connectedTiming.issue.BOOKING_DATE',
  );
});

test('a repairable gap explains the adjustment without telling travellers to choose another day', () => {
  const repairable: TimingIssue = {
    ...issue,
    code: 'NO_ROOM',
    suggestion: {
      itemId: 'lunch',
      status: 'ok',
      localTime: '12:05',
      localEndTime: '16:05',
      reasons: [],
      caveats: [],
    },
  };
  expect(JSON.parse(describeTimingIssue(repairable, options)).key).toBe(
    'connectedTiming.needsSpace',
  );
  expect(
    JSON.parse(describeTimingIssue({ ...repairable, suggestion: undefined }, options)).key,
  ).toBe('connectedTiming.issue.NO_ROOM');
});

test('legacy instant-only warnings fall back to current localized copy without timezone conversion', () => {
  const legacy = {
    ...issue,
    orderConflict: {
      previousItemId: 'shopping',
      earliestStartInstant: '2026-09-08T04:02:00Z',
      scheduledStartInstant: '2026-09-08T00:30:00Z',
      timeZone: 'Pacific/Auckland',
    },
  } as unknown as TimingIssue;
  expect(JSON.parse(describeTimingIssue(legacy, options)).key).toBe(
    'connectedTiming.issue.FIXED_CONFLICT',
  );
});
test('names the booking a fixed stop overlaps, with its local times', () => {
  const overlap: TimingIssue = {
    code: 'FIXED_CONFLICT',
    itemId: 'airport',
    references: ['flight'],
    severity: 'review',
    bookingOverlap: {
      reservationId: 'flight',
      title: 'Singapore Airlines',
      startLocal: '2026-11-05T17:00',
      endLocal: '2026-11-05T18:45',
    },
  };
  expect(JSON.parse(describeTimingIssue(overlap, options))).toEqual({
    key: 'connectedTiming.bookingOverlap',
    hasTitle: 'yes',
    booking: 'Singapore Airlines',
    start: '5:00 PM',
    end: '6:45 PM',
  });
  const untitled = {
    ...overlap,
    bookingOverlap: { ...overlap.bookingOverlap!, title: null, endLocal: null },
  };
  expect(JSON.parse(describeTimingIssue(untitled, options))).toMatchObject({
    key: 'connectedTiming.bookingOverlapAt',
    hasTitle: 'no',
  });
});
test('explains a short connection by its two stops and what limits the later one', () => {
  const names: Record<string, string> = { b: 'Market', a: 'Museum' };
  const shortfall: TimingIssue = {
    code: 'FIXED_CONFLICT',
    itemId: 'b',
    references: ['a'],
    severity: 'conflict',
    travelShortfall: {
      fromItemId: 'b',
      toItemId: 'a',
      travelMinutes: 18,
      availableMinutes: 15,
      limitedBy: 'closing_time',
      limitItemId: 'a',
      limitLocal: '2026-09-08T17:30',
    },
  };
  const text = JSON.parse(
    describeTimingIssue(shortfall, { ...options, nameFor: (id: string) => names[id]! }),
  );
  expect(text).toMatchObject({
    key: 'connectedTiming.travelShortfall',
    from: 'Market',
    to: 'Museum',
    limit: 'closing_time',
    limitName: 'Museum',
    limitTime: '5:30 PM',
  });
  expect(JSON.parse(text.travel)).toEqual({ key: 'connectedTiming.minutes', minutes: '18' });
  expect(JSON.parse(text.available)).toEqual({ key: 'connectedTiming.minutes', minutes: '15' });
  const overlapping = {
    ...shortfall,
    travelShortfall: { ...shortfall.travelShortfall!, availableMinutes: -30 },
  };
  expect(JSON.parse(describeTimingIssue(overlapping, options)).key).toBe(
    'connectedTiming.travelShortfallOverlap',
  );
});
