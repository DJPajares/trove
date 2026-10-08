import type { Memory, MemoryInput } from './api';

/**
 * What the traveller has chosen as a Memory's Place while editing it.
 *
 * `current` leaves the Place exactly as stored - which matters for a Memory
 * kept at a Place with no itinerary stop, whose Place no stop on the list
 * stands for. `item` ties it to a stop (and that stop's Place), `place` keeps
 * a Place while letting go of the stop, and `none` clears both.
 */
export type MemoryPlaceChoice =
  | { kind: 'current' }
  | { itemId: string; kind: 'item'; tripPlaceId: string | null }
  | { kind: 'none' }
  | { kind: 'place'; tripPlaceId: string | null };

export type MemoryDraft = {
  /** The itinerary day the Memory belongs to, or null for none. */
  dayId: string | null;
  isHighlight: boolean;
  /** `YYYY-MM-DD`, or empty while unset. */
  localDate: string;
  /** `HH:mm`, or empty while unset. */
  localTime: string;
  note: string;
  place: MemoryPlaceChoice;
};

/** The editor's starting point: the Memory as it is stored. */
export function memoryDraftFrom(memory: Memory): MemoryDraft {
  return {
    dayId: memory.itineraryDay?.id ?? null,
    isHighlight: memory.isHighlight,
    localDate: memory.capturedLocalDate,
    localTime: memory.capturedLocalTime ?? '',
    note: memory.note ?? '',
    place: memory.itineraryItem
      ? {
          itemId: memory.itineraryItem.id,
          kind: 'item',
          tripPlaceId: memory.tripPlace?.id ?? null,
        }
      : { kind: 'current' },
  };
}

/**
 * Moves a draft to another day. The date follows the day and the time stays
 * as it was; a stop from the old day cannot come along, so it is let go - but
 * the Place it stood for is kept, because the moment still happened there.
 */
export function withDay(
  draft: MemoryDraft,
  day: Readonly<{ date: string; id: string }> | null,
): MemoryDraft {
  const place: MemoryPlaceChoice =
    draft.place.kind === 'item'
      ? draft.place.tripPlaceId
        ? { kind: 'place', tripPlaceId: draft.place.tripPlaceId }
        : { kind: 'none' }
      : draft.place;

  return {
    ...draft,
    dayId: day?.id ?? null,
    localDate: day ? day.date : draft.localDate,
    place,
  };
}

/**
 * Only what the traveller actually changed. The server treats any context it
 * is sent - a day, a stop, a Place, a local date and time - as a correction,
 * re-resolving the Memory's time zone and rewriting its captured instant, so
 * sending the unchanged context on every save quietly rewrote history and, for
 * a Memory with a Place but no stop, dropped the Place. An untouched draft
 * sends nothing at all.
 */
export function memoryEditPatch(memory: Memory, draft: MemoryDraft): MemoryInput {
  const patch: MemoryInput = {};

  const note = draft.note.trim() ? draft.note.trim() : null;
  if (note !== (memory.note ?? null)) patch.note = note;
  if (draft.isHighlight !== memory.isHighlight) patch.isHighlight = draft.isHighlight;

  if (draft.dayId !== (memory.itineraryDay?.id ?? null)) patch.itineraryDayId = draft.dayId;

  const currentItemId = memory.itineraryItem?.id ?? null;
  const currentPlaceId = memory.tripPlace?.id ?? null;
  const { place } = draft;
  if (place.kind === 'item') {
    if (place.itemId !== currentItemId) patch.itineraryItemId = place.itemId;
    if (place.tripPlaceId !== currentPlaceId) patch.tripPlaceId = place.tripPlaceId;
  } else if (place.kind === 'place') {
    if (currentItemId !== null) patch.itineraryItemId = null;
    if (place.tripPlaceId !== currentPlaceId) patch.tripPlaceId = place.tripPlaceId;
  } else if (place.kind === 'none') {
    if (currentItemId !== null) patch.itineraryItemId = null;
    if (currentPlaceId !== null) patch.tripPlaceId = null;
  }

  // The server reads a local date and time only as a pair.
  const dateChanged = draft.localDate !== memory.capturedLocalDate;
  const timeChanged = draft.localTime !== (memory.capturedLocalTime ?? '');
  if ((dateChanged || timeChanged) && draft.localDate && draft.localTime) {
    patch.capturedLocalDate = draft.localDate;
    patch.capturedLocalTime = draft.localTime;
  }

  return patch;
}
