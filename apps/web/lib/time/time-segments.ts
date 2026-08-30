export type TimeSegmentKind = 'hour' | 'minute' | 'period';

export type TimeSegment = {
  end: number;
  kind: TimeSegmentKind;
  start: number;
};

export type SegmentedTimeDisplay = {
  segments: TimeSegment[];
  text: string;
};

export function parseCanonicalTime(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

function canonicalTime(hour: number, minute: number) {
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

function compact(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replaceAll(/[\p{P}\p{Z}\s]/gu, '');
}

function localizedDayPeriods(locale: string) {
  const formatter = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    hour12: true,
    timeZone: 'UTC',
  });

  function dayPeriod(hour: number) {
    const date = new Date(Date.UTC(2000, 0, 1, hour));
    return formatter.formatToParts(date).find((part) => part.type === 'dayPeriod')?.value;
  }

  return { am: dayPeriod(9), pm: dayPeriod(21) };
}

export function parseTimeInput(value: string, locale = 'en') {
  const trimmed = value.trim();
  const canonical = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (canonical) {
    const hour = Number(canonical[1]);
    const minute = Number(canonical[2]);
    return hour <= 23 && minute <= 59 ? canonicalTime(hour, minute) : null;
  }

  const twelveHour = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$/i.exec(trimmed);
  if (twelveHour) {
    const displayHour = Number(twelveHour[1]);
    const minute = Number(twelveHour[2] ?? '0');
    if (displayHour < 1 || displayHour > 12 || minute > 59) return null;
    const period = twelveHour[3]?.toLowerCase();
    return canonicalTime((displayHour % 12) + (period === 'p' ? 12 : 0), minute);
  }

  const numbers = trimmed.match(/\d{1,2}/g);
  if (!numbers || numbers.length !== 2) return null;
  const displayHour = Number(numbers[0]);
  const minute = Number(numbers[1]);
  if (displayHour < 1 || displayHour > 12 || minute > 59) return null;

  const normalized = compact(trimmed);
  const { am, pm } = localizedDayPeriods(locale);
  const period = [
    { hourOffset: 0, value: am },
    { hourOffset: 12, value: pm },
  ].find(({ value: dayPeriod }) => dayPeriod && normalized.includes(compact(dayPeriod)));

  return period ? canonicalTime((displayHour % 12) + period.hourOffset, minute) : null;
}

export function formatSegmentedTime(
  value: string,
  locale: string,
  format: '12h' | '24h',
): SegmentedTimeDisplay {
  const parsed = parseCanonicalTime(value);
  if (!parsed) return { segments: [], text: '' };

  if (format === '24h') {
    return {
      segments: [
        { end: 2, kind: 'hour', start: 0 },
        { end: 5, kind: 'minute', start: 3 },
      ],
      text: value,
    };
  }

  const date = new Date(Date.UTC(2000, 0, 1, parsed.hour, parsed.minute));
  const parts = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    hour12: true,
    minute: '2-digit',
    timeZone: 'UTC',
  }).formatToParts(date);
  const segments: TimeSegment[] = [];
  let text = '';

  for (const part of parts) {
    const start = text.length;
    text += part.value;
    const kind =
      part.type === 'dayPeriod'
        ? 'period'
        : part.type === 'hour' || part.type === 'minute'
          ? part.type
          : null;
    if (kind) segments.push({ end: text.length, kind, start });
  }

  return { segments, text };
}

export function nearestTimeSegment(segments: TimeSegment[], offset: number) {
  return segments.reduce<TimeSegment | null>((nearest, segment) => {
    if (offset >= segment.start && offset <= segment.end) return segment;
    if (!nearest) return segment;
    const distance = Math.min(Math.abs(offset - segment.start), Math.abs(offset - segment.end));
    const nearestDistance = Math.min(
      Math.abs(offset - nearest.start),
      Math.abs(offset - nearest.end),
    );
    return distance < nearestDistance ? segment : nearest;
  }, null);
}

/**
 * A time being typed, one segment at a time. A segment is `null` until the
 * traveller fills it, which is what lets an empty field be segmented at all:
 * the mask has real hour/minute/period offsets to click into and arrow between
 * long before the value is complete enough to save.
 */
export type TimeDraft = {
  hour: number | null;
  minute: number | null;
  period: 'am' | 'pm' | null;
};

export const emptyTimeDraft: TimeDraft = { hour: null, minute: null, period: null };

/**
 * `hour` is the display hour, so it means the same thing as the digits on
 * screen: 1-12 in `12h` beside a period, 0-23 in `24h` with no period at all.
 */
export function draftFromCanonical(value: string, format: '12h' | '24h'): TimeDraft {
  const parsed = parseCanonicalTime(value);
  if (!parsed) return emptyTimeDraft;
  return format === '24h'
    ? { hour: parsed.hour, minute: parsed.minute, period: null }
    : {
        hour: parsed.hour % 12 || 12,
        minute: parsed.minute,
        period: parsed.hour >= 12 ? 'pm' : 'am',
      };
}

/** `null` until every segment the format needs is filled — a half-typed time is not a time. */
export function canonicalFromDraft(draft: TimeDraft, format: '12h' | '24h') {
  const { hour, minute, period } = draft;
  if (hour === null || minute === null) return null;
  if (format === '24h') return hour <= 23 ? canonicalTime(hour, minute) : null;
  if (!period || hour < 1 || hour > 12) return null;
  return canonicalTime((hour % 12) + (period === 'pm' ? 12 : 0), minute);
}

/**
 * The focused-state renderer. Unlike `formatSegmentedTime` it always produces
 * segments, filling unset ones with a dash mask, so selection and keyboard
 * navigation work from the first focus rather than only once a value exists.
 *
 * The part order, separators and day-period placement all come from `Intl`
 * against a reference time, so a locale that writes the period first or uses a
 * non-ASCII separator gets the offsets it actually needs.
 */
export function formatSegmentedDraft(
  draft: TimeDraft,
  locale: string,
  format: '12h' | '24h',
): SegmentedTimeDisplay {
  const mask = '--';

  if (format === '24h') {
    const hour = draft.hour === null ? mask : draft.hour.toString().padStart(2, '0');
    const minute = draft.minute === null ? mask : draft.minute.toString().padStart(2, '0');
    return {
      segments: [
        { end: hour.length, kind: 'hour', start: 0 },
        { end: hour.length + 1 + minute.length, kind: 'minute', start: hour.length + 1 },
      ],
      text: `${hour}:${minute}`,
    };
  }

  const periods = localizedDayPeriods(locale);
  // 9 AM only shapes the template; every value below is substituted.
  const parts = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    hour12: true,
    minute: '2-digit',
    timeZone: 'UTC',
  }).formatToParts(new Date(Date.UTC(2000, 0, 1, 9)));

  const segments: TimeSegment[] = [];
  let text = '';

  for (const part of parts) {
    const kind =
      part.type === 'dayPeriod'
        ? 'period'
        : part.type === 'hour' || part.type === 'minute'
          ? part.type
          : null;

    if (!kind) {
      text += part.value;
      continue;
    }

    const value =
      kind === 'hour'
        ? (draft.hour?.toString().padStart(2, '0') ?? mask)
        : kind === 'minute'
          ? (draft.minute?.toString().padStart(2, '0') ?? mask)
          : draft.period
            ? (periods[draft.period] ?? draft.period.toUpperCase())
            : mask;

    const start = text.length;
    text += value;
    segments.push({ end: text.length, kind, start });
  }

  return { segments, text };
}

/**
 * Folds one typed digit into a segment, given whatever digit is already
 * buffered there. `complete` says the segment can take no more, which is the
 * cue to move the caret on - a lone `9` is already an hour, but a `1` might
 * still be growing into a `12`.
 */
export function applyTimeDigit(
  kind: 'hour' | 'minute',
  buffered: string,
  key: string,
  format: '12h' | '24h',
) {
  const twelveHour = format === '12h';
  const digit = Number(key);
  const combined = Number(buffered + key);
  const fits =
    kind === 'minute'
      ? combined <= 59
      : twelveHour
        ? combined >= 1 && combined <= 12
        : combined <= 23;
  // A second digit only counts when the pair is a real hour or minute;
  // otherwise the new key starts over as a first digit of its own.
  const settled = buffered && fits ? combined : digit;
  const ceiling = kind === 'minute' ? 5 : twelveHour ? 1 : 2;

  return { complete: Boolean(buffered) || digit > ceiling, value: settled };
}

/**
 * Steps an hour or minute by one, wrapping within its own clock. An untouched
 * segment lands on its starting value instead of stepping, the way a native
 * date field picks a first value rather than counting from nothing.
 */
export function stepTimeSegment(
  kind: 'hour' | 'minute',
  current: number | null,
  delta: number,
  format: '12h' | '24h',
) {
  const twelveHour = format === '12h';
  if (current === null) return kind === 'minute' ? 0 : twelveHour ? 12 : 0;
  if (kind === 'minute') return (current + delta + 60) % 60;
  if (!twelveHour) return (current + delta + 24) % 24;
  return ((current - 1 + delta + 12) % 12) + 1;
}
