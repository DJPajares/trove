import type { ItineraryItem } from './api';
import type { DayTimelineEntry } from './day-sequence';

export type DayBand = 'afternoon' | 'evening' | 'morning';

export type BandedEntry = DayTimelineEntry | { band: DayBand; kind: 'band' };

/** Where the afternoon and the evening begin, in minutes after midnight. */
const AFTERNOON_FROM = 12 * 60;
const EVENING_FROM = 17 * 60;

/**
 * The part of the day a stop happens in: its exact time when it has one, else
 * the part of the day it was planned for. "Anytime" and an untimed stop say
 * nothing, so they belong to whichever part of the day they sit in.
 */
export function stopBand(item: Pick<ItineraryItem, 'dayPart' | 'localStartTime'>): DayBand | null {
  if (item.localStartTime) {
    const [hour = 0, minute = 0] = item.localStartTime.split(':').map(Number);
    const minutes = hour * 60 + minute;
    return minutes < AFTERNOON_FROM ? 'morning' : minutes < EVENING_FROM ? 'afternoon' : 'evening';
  }
  return item.dayPart === 'morning' || item.dayPart === 'afternoon' || item.dayPart === 'evening'
    ? item.dayPart
    : null;
}

/**
 * The day with a quiet label wherever it moves into another part of the day.
 *
 * The labels are read off the sequence; they never sort it. Travel order is the
 * day's own truth, so a stop the traveller placed out of time order is shown
 * where they placed it and the label simply says so. A label goes before the
 * leg that reaches its first stop, because that travel is part of the new part
 * of the day, and a day nothing says the time of carries no labels at all.
 */
export function withDayPartBands(entries: readonly DayTimelineEntry[]): BandedEntry[] {
  const banded: BandedEntry[] = [];
  let current: DayBand | null = null;
  let legs: DayTimelineEntry[] = [];

  for (const entry of entries) {
    if (entry.kind === 'leg') {
      legs.push(entry);
      continue;
    }
    if (entry.kind === 'stop') {
      const band = stopBand(entry.item);
      if (band && band !== current) {
        banded.push({ band, kind: 'band' });
        current = band;
      }
    }
    banded.push(...legs, entry);
    legs = [];
  }

  banded.push(...legs);
  return banded;
}
