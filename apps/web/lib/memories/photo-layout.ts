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
  | { id: string; kind: 'trio'; lead: 'end' | 'start'; leadAspect: string; sideAspect: string }
  | { id: string; kind: 'spread'; leadAspect: string; stripAspect: string };

const ONE: PhotoLayoutTemplate[] = [
  { aspect: 'aspect-[4/3]', id: 'single-landscape', kind: 'single' },
  { aspect: 'aspect-[4/5]', id: 'single-portrait', kind: 'single' },
];

const TWO: PhotoLayoutTemplate[] = [
  { aspect: 'aspect-[4/5]', id: 'pair-tall', kind: 'pair' },
  { aspect: 'aspect-square', id: 'pair-square', kind: 'pair' },
];

// Three prints fit the page whole: a tall lead beside two smaller prints
// stacked against it, the lead on either side so neighbouring moments differ.
const THREE: PhotoLayoutTemplate[] = [
  {
    id: 'trio-lead-start',
    kind: 'trio',
    lead: 'start',
    leadAspect: 'aspect-[4/5]',
    sideAspect: 'aspect-[5/4]',
  },
  {
    id: 'trio-lead-end',
    kind: 'trio',
    lead: 'end',
    leadAspect: 'aspect-[4/5]',
    sideAspect: 'aspect-[5/4]',
  },
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
 * arbitrary between one load and the next. Three photos are laid out whole as
 * a "trio" (a tall lead beside two stacked prints), so none hides off the edge
 * of a strip. Four or more share one "spread" shape (a lead photo over a
 * strip that scrolls); only the aspect ratios vary.
 */
export function selectPhotoLayout(
  memoryId: string,
  photoCount: number,
): PhotoLayoutTemplate | null {
  if (photoCount <= 0) return null;
  const bucket =
    photoCount === 1 ? ONE : photoCount === 2 ? TWO : photoCount === 3 ? THREE : SPREAD;
  const template = bucket[stableHash(memoryId) % bucket.length];
  return template ?? bucket[0] ?? null;
}

/**
 * How far each of a Memory's prints leans, in degrees: between half a degree
 * and two either way, settled once from the Memory's id so a print lies at the
 * same angle on every visit. Neighbouring prints always lean opposite ways, so
 * a pair reads as two prints laid down by hand rather than one tilted block.
 */
export function printTilts(memoryId: string, count: number): number[] {
  const seed = stableHash(memoryId);
  const firstDirection = seed % 2 === 0 ? 1 : -1;

  return Array.from({ length: Math.max(0, count) }, (_, index) => {
    // 0.5 to 2.0 in steps of 0.1, from a different slice of the hash per print.
    const magnitude = 0.5 + ((seed >>> (index * 3)) % 16) / 10;
    const direction = index % 2 === 0 ? firstDirection : -firstDirection;
    return Math.round(direction * magnitude * 10) / 10;
  });
}

/**
 * Which side a moment leans to on a narrow page. Alternating keeps a column of
 * prints from reading as a feed; it follows the moment's place in the reading
 * order, so the rhythm holds however the journal is filtered.
 */
export function momentLean(index: number): 'end' | 'start' {
  return index % 2 === 0 ? 'start' : 'end';
}
