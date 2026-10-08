/**
 * How many of a finished trip's own photographs the Trips library shows.
 *
 * Three is a small fan of prints: enough that a journey reads as the
 * traveller's own rather than as a stock cover, few enough that a long archive
 * stays one signature per trip and never a gallery.
 */
export const TRIP_MEMORY_PREVIEW_LIMIT = 3;

export type MemoryPreviewPhotoRecord = { contentType: string; id: string; path: string };

/**
 * The photographs a finished trip is remembered by, in the order they are shown.
 *
 * The traveller's own choices lead: the photograph they picked as the story's
 * cover, then the first photograph of each Highlight in the order they arranged
 * them, then the rest of the trip in the order it happened. `memories` arrives
 * already in that order - highlights first - so this only puts the cover in
 * front, drops the repeat when the cover is also a Highlight's first
 * photograph, and stops at the limit.
 */
export function selectTripMemoryPreview(
  storyCover: MemoryPreviewPhotoRecord | null,
  memories: readonly { photos: readonly MemoryPreviewPhotoRecord[] }[],
  limit = TRIP_MEMORY_PREVIEW_LIMIT,
): MemoryPreviewPhotoRecord[] {
  const selected: MemoryPreviewPhotoRecord[] = storyCover ? [storyCover] : [];

  for (const memory of memories) {
    if (selected.length >= limit) break;
    const photo = memory.photos[0];
    if (photo && !selected.some((entry) => entry.id === photo.id)) selected.push(photo);
  }

  return selected.slice(0, limit);
}
