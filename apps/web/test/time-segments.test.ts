import { expect, test } from 'vitest';

import {
  applyTimeDigit,
  canonicalFromDraft,
  draftFromCanonical,
  emptyTimeDraft,
  formatSegmentedDraft,
  formatSegmentedTime,
  nearestTimeSegment,
  parseTimeInput,
  stepTimeSegment,
} from '../lib/time/time-segments.ts';

test('maps the hour and minute ranges in 24-hour displays', () => {
  expect(formatSegmentedTime('19:05', 'en-GB', '24h')).toEqual({
    segments: [
      { end: 2, kind: 'hour', start: 0 },
      { end: 5, kind: 'minute', start: 3 },
    ],
    text: '19:05',
  });
});

test('maps every localized part in 12-hour displays', () => {
  const display = formatSegmentedTime('21:05', 'ko-KR', '12h');

  expect(display.segments.map(({ kind }) => kind).sort()).toEqual(['hour', 'minute', 'period']);
  for (const segment of display.segments) {
    expect(display.text.slice(segment.start, segment.end)).not.toBe('');
  }

  const period = display.segments.find(({ kind }) => kind === 'period');
  expect(period).toBeDefined();
  expect(display.text.slice(period?.start, period?.end)).toBe('오후');
  expect(parseTimeInput(display.text, 'ko-KR')).toBe('21:05');
});

test('selects the nearest segment when a click lands on a separator', () => {
  const { segments } = formatSegmentedTime('19:05', 'en-GB', '24h');

  expect(nearestTimeSegment(segments, 1)?.kind).toBe('hour');
  expect(nearestTimeSegment(segments, 2)?.kind).toBe('hour');
  expect(nearestTimeSegment(segments, 3)?.kind).toBe('minute');
  expect(nearestTimeSegment(segments, 5)?.kind).toBe('minute');
});

test('preserves canonical values and rejects invalid input', () => {
  expect(parseTimeInput('09:05')).toBe('09:05');
  expect(parseTimeInput('9:05 PM')).toBe('21:05');
  expect(parseTimeInput('24:00')).toBeNull();
  expect(parseTimeInput('12:60 PM')).toBeNull();
  expect(parseTimeInput('later')).toBeNull();
});

test('masks an empty draft so a new field still has sections to select', () => {
  // The bug this guards: a field with no value had no segments at all, so
  // focus, clicks and arrow keys had nothing to land on.
  expect(formatSegmentedDraft(emptyTimeDraft, 'en-GB', '24h')).toEqual({
    segments: [
      { end: 2, kind: 'hour', start: 0 },
      { end: 5, kind: 'minute', start: 3 },
    ],
    text: '--:--',
  });

  const twelveHour = formatSegmentedDraft(emptyTimeDraft, 'en-US', '12h');
  // en-US separates the day period with a narrow no-break space, and the mask
  // keeps whatever separator the locale actually uses.
  expect(twelveHour.text).toBe('--:--\u202f--');
  expect(twelveHour.segments.map((segment) => segment.kind)).toEqual(['hour', 'minute', 'period']);
});

test('keeps the unfilled sections masked while a draft is part-typed', () => {
  expect(formatSegmentedDraft({ hour: 9, minute: null, period: null }, 'en-US', '12h').text).toBe(
    '09:--\u202f--',
  );
  expect(formatSegmentedDraft({ hour: 9, minute: 30, period: null }, 'en-US', '12h').text).toBe(
    '09:30\u202f--',
  );
  expect(formatSegmentedDraft({ hour: 9, minute: 30, period: 'pm' }, 'en-US', '12h').text).toBe(
    '09:30\u202fPM',
  );
});

test('offsets a part-typed draft so its sections stay selectable', () => {
  const display = formatSegmentedDraft({ hour: 9, minute: null, period: null }, 'en-US', '12h');
  for (const segment of display.segments) {
    expect(display.text.slice(segment.start, segment.end)).not.toBe('');
  }
  expect(display.segments.map(({ end, start }) => display.text.slice(start, end))).toEqual([
    '09',
    '--',
    '--',
  ]);
});

test('withholds a canonical time until every section the format needs is filled', () => {
  expect(canonicalFromDraft(emptyTimeDraft, '12h')).toBeNull();
  expect(canonicalFromDraft({ hour: 9, minute: null, period: 'am' }, '12h')).toBeNull();
  expect(canonicalFromDraft({ hour: 9, minute: 30, period: null }, '12h')).toBeNull();
  // 24-hour needs no period, so the same draft is already complete there.
  expect(canonicalFromDraft({ hour: 9, minute: 30, period: null }, '24h')).toBe('09:30');
});

test('converts the display hour at both ends of the 12-hour clock', () => {
  expect(canonicalFromDraft({ hour: 12, minute: 0, period: 'am' }, '12h')).toBe('00:00');
  expect(canonicalFromDraft({ hour: 12, minute: 0, period: 'pm' }, '12h')).toBe('12:00');
  expect(canonicalFromDraft({ hour: 11, minute: 59, period: 'pm' }, '12h')).toBe('23:59');
});

test('rejects a draft holding an hour the format cannot mean', () => {
  expect(canonicalFromDraft({ hour: 0, minute: 30, period: 'am' }, '12h')).toBeNull();
  expect(canonicalFromDraft({ hour: 24, minute: 0, period: null }, '24h')).toBeNull();
});

test('round-trips a canonical time through the draft in both formats', () => {
  expect(draftFromCanonical('21:05', '12h')).toEqual({ hour: 9, minute: 5, period: 'pm' });
  expect(draftFromCanonical('00:30', '12h')).toEqual({ hour: 12, minute: 30, period: 'am' });
  expect(draftFromCanonical('21:05', '24h')).toEqual({ hour: 21, minute: 5, period: null });
  expect(draftFromCanonical('', '12h')).toEqual(emptyTimeDraft);

  for (const canonical of ['00:00', '09:30', '12:00', '23:59']) {
    expect(canonicalFromDraft(draftFromCanonical(canonical, '12h'), '12h')).toBe(canonical);
    expect(canonicalFromDraft(draftFromCanonical(canonical, '24h'), '24h')).toBe(canonical);
  }
});

test('finishes an hour that cannot grow any further', () => {
  // 9 can only ever be 9 o'clock, so the caret should move straight on.
  expect(applyTimeDigit('hour', '', '9', '12h')).toEqual({ complete: true, value: 9 });
  // 1 might still be growing into a 12, so it waits for a second digit.
  expect(applyTimeDigit('hour', '', '1', '12h')).toEqual({ complete: false, value: 1 });
  // 24-hour clocks can still reach 23, so 2 waits where 3 cannot.
  expect(applyTimeDigit('hour', '', '2', '24h')).toEqual({ complete: false, value: 2 });
  expect(applyTimeDigit('hour', '', '3', '24h')).toEqual({ complete: true, value: 3 });
});

test('finishes a minute once its first digit rules out a pair', () => {
  expect(applyTimeDigit('minute', '', '5', '12h')).toEqual({ complete: false, value: 5 });
  expect(applyTimeDigit('minute', '', '6', '12h')).toEqual({ complete: true, value: 6 });
  expect(applyTimeDigit('minute', '3', '0', '12h')).toEqual({ complete: true, value: 30 });
});

test('restarts the digits when the pair would not be a real time', () => {
  // 1 then 3 is not an hour on a 12-hour clock, so the 3 stands alone.
  expect(applyTimeDigit('hour', '1', '3', '12h')).toEqual({ complete: true, value: 3 });
  expect(applyTimeDigit('hour', '2', '5', '24h')).toEqual({ complete: true, value: 5 });
  expect(applyTimeDigit('hour', '1', '2', '12h')).toEqual({ complete: true, value: 12 });
  expect(applyTimeDigit('hour', '2', '3', '24h')).toEqual({ complete: true, value: 23 });
  // A 12-hour clock has no zero hour, so 0 then 0 falls back to a lone 0.
  expect(applyTimeDigit('hour', '0', '0', '12h')).toEqual({ complete: true, value: 0 });
  expect(applyTimeDigit('hour', '0', '0', '24h')).toEqual({ complete: true, value: 0 });
});

test('picks a starting value rather than stepping an untouched section', () => {
  expect(stepTimeSegment('hour', null, 1, '12h')).toBe(12);
  expect(stepTimeSegment('hour', null, -1, '24h')).toBe(0);
  expect(stepTimeSegment('minute', null, -1, '12h')).toBe(0);
});

test('wraps each section within its own clock', () => {
  expect(stepTimeSegment('hour', 12, 1, '12h')).toBe(1);
  expect(stepTimeSegment('hour', 1, -1, '12h')).toBe(12);
  expect(stepTimeSegment('hour', 23, 1, '24h')).toBe(0);
  expect(stepTimeSegment('hour', 0, -1, '24h')).toBe(23);
  expect(stepTimeSegment('minute', 59, 1, '24h')).toBe(0);
  expect(stepTimeSegment('minute', 0, -1, '24h')).toBe(59);
});
