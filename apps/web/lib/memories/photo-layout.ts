/**
 * The frame a Memory's photographs are given, chosen deterministically from the
 * Memory's own id and photo count rather than measured from the photographs
 * themselves — no photo dimensions are stored, so this varies the target frame
 * instead of reacting to the source image, keeping every box reserved before a
 * single byte arrives.
 */
export type PhotoLayoutTemplate =
  | { aspect: string; id: string; kind: 'single' }
  | { aspect: string; id: string; kind: 'pair' }
  | { id: string; kind: 'spread'; leadAspect: string; stripAspect: string };

const ONE: PhotoLayoutTemplate[] = [
  { aspect: 'aspect-[4/3]', id: 'single-landscape', kind: 'single' },
  { aspect: 'aspect-[4/5]', id: 'single-portrait', kind: 'single' },
];

const TWO: PhotoLayoutTemplate[] = [
  { aspect: 'aspect-[4/5]', id: 'pair-tall', kind: 'pair' },
  { aspect: 'aspect-square', id: 'pair-square', kind: 'pair' },
];

const SPREAD: PhotoLayoutTemplate[] = [
  {
    id: 'spread-landscape',
    kind: 'spread',
    leadAspect: 'aspect-[4/3]',
    stripAspect: 'aspect-square',
  },
  {
    id: 'spread-portrait',
    kind: 'spread',
    leadAspect: 'aspect-[4/5]',
    stripAspect: 'aspect-[4/5]',
  },
];

function stableHash(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return hash;
}

/**
 * Same Memory, same photo count, same template — every time, on every device.
 * Different Memories land on different templates within their bucket because
 * their ids hash differently, so a story reads as varied without ever looking
 * arbitrary between one load and the next. Three or more photos share one
 * "spread" shape (a lead photo over a filled strip); only the aspect ratios
 * vary, since how the strip fills its row is already decided by how many
 * photos are left over.
 */
export function selectPhotoLayout(
  memoryId: string,
  photoCount: number,
): PhotoLayoutTemplate | null {
  if (photoCount <= 0) return null;
  const bucket = photoCount === 1 ? ONE : photoCount === 2 ? TWO : SPREAD;
  const template = bucket[stableHash(memoryId) % bucket.length];
  return template ?? bucket[0] ?? null;
}
