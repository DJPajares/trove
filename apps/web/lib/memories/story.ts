import type { Memory, MemoryTripPlace } from './api';

/**
 * A completed trip's story is derived, never authored. Everything here comes from
 * what the traveller actually captured: their own notes, highlights, photos, and
 * the day and Place context already resolved and persisted with each Memory.
 * Nothing is inferred, padded, or generated, so a sparse trip stays honest.
 */

export type StoryDay = {
  date: string;
  memories: Memory[];
  photoCount: number;
};

export type StoryPlace = {
  memories: Memory[];
  photoCount: number;
  tripPlace: MemoryTripPlace;
};

export type TripStory = {
  days: StoryDay[];
  highlights: Memory[];
  memoryCount: number;
  photoCount: number;
  places: StoryPlace[];
  unplacedCount: number;
};

function photoTotal(memories: Memory[]) {
  return memories.reduce((total, memory) => total + memory.photos.length, 0);
}

/**
 * Orders by the trip-local time the Memory was captured, falling back to the
 * capture instant only to break ties. `capturedLocalDate` and `capturedLocalTime`
 * were resolved once from trip context and stored, so this order is the same on
 * every device regardless of where the story is being read.
 */
function byCapturedLocal(left: Memory, right: Memory) {
  const date = left.capturedLocalDate.localeCompare(right.capturedLocalDate);
  if (date !== 0) return date;
  const time = (left.capturedLocalTime ?? '').localeCompare(right.capturedLocalTime ?? '');
  return time !== 0 ? time : left.capturedAt.localeCompare(right.capturedAt);
}

export function buildTripStory(memories: Memory[]): TripStory {
  const ordered = [...memories].sort(byCapturedLocal);

  const dayGroups = new Map<string, Memory[]>();
  const placeGroups = new Map<string, StoryPlace>();

  for (const memory of ordered) {
    // The persisted trip-local date is the grouping key, so a story read from
    // another timezone never regroups a Memory onto a different day.
    dayGroups.set(memory.capturedLocalDate, [
      ...(dayGroups.get(memory.capturedLocalDate) ?? []),
      memory,
    ]);

    if (!memory.tripPlace) continue;
    const group = placeGroups.get(memory.tripPlace.id);
    if (group) {
      group.memories.push(memory);
      group.photoCount += memory.photos.length;
      continue;
    }
    placeGroups.set(memory.tripPlace.id, {
      memories: [memory],
      photoCount: memory.photos.length,
      tripPlace: memory.tripPlace,
    });
  }

  return {
    days: [...dayGroups.entries()]
      .map(([date, dayMemories]) => ({
        date,
        memories: dayMemories,
        photoCount: photoTotal(dayMemories),
      }))
      .sort((left, right) => left.date.localeCompare(right.date)),
    highlights: ordered.filter((memory) => memory.isHighlight),
    memoryCount: ordered.length,
    photoCount: photoTotal(ordered),
    places: [...placeGroups.values()].sort(
      (left, right) => right.memories.length - left.memories.length,
    ),
    unplacedCount: ordered.filter((memory) => !memory.tripPlace).length,
  };
}

/**
 * A Place shows the name Trove owns. A provider Place has no stored name, so the
 * caller supplies one resolved on demand; an itinerary label is the last resort.
 */
export function placeName(
  tripPlace: MemoryTripPlace,
  resolved: string | null,
  itineraryLabel: string | null,
) {
  return tripPlace.name ?? resolved ?? itineraryLabel;
}

export function providerPlaceId(tripPlace: MemoryTripPlace) {
  return (
    tripPlace.providerRefs.find((reference) => reference.provider === 'google')?.externalPlaceId ??
    null
  );
}
