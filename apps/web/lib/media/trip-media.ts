import type { StaticImageData } from 'next/image';

import type { EditorialImageReference } from '@/lib/media/editorial-images';

export type TripMediaSource =
  | { kind: 'editorial'; reference: EditorialImageReference }
  | { kind: 'fallback' }
  | { kind: 'local'; src: StaticImageData }
  | { kind: 'memory'; url: string }
  | { kind: 'trip-cover'; url: string };

export type PlaceMediaSource =
  { kind: 'editorial'; reference: EditorialImageReference } | { kind: 'fallback' };

export type TripMediaVariant = 'card' | 'hero' | 'thumbnail';

type ResolveTripMediaSourceInput = {
  coverUrl?: string | null;
  editorial?: EditorialImageReference | null;
  memoryUrl?: string | null;
  preferMemory?: boolean;
};

/**
 * Picks the media a trip should show, in the order that respects the traveller.
 *
 * The ladder is upload -> Memory photo -> editorial photograph -> branded
 * fallback: what the traveller chose beats what they captured, which beats
 * decoration Trove chose for them. The fallback stays the last rung and is
 * reached whenever nothing above it exists.
 *
 * The editorial rung is service-resolved rather than resolved here: the
 * photograph arrives already looked up by `resolveEditorialImages`, so this
 * function stays synchronous and a re-render can never turn into a request. The
 * Google Places exclusion is untouched by the new rung - the only provider
 * Trove decorates with is its own editorial service, which is free, hotlinked
 * and asked for by name, never a Places photo attached to a Place the traveller
 * merely looked at.
 */
export function resolveTripMediaSource({
  coverUrl,
  editorial,
  memoryUrl,
  preferMemory = false,
}: ResolveTripMediaSourceInput): TripMediaSource {
  const resolvedCoverUrl = coverUrl?.trim();
  const resolvedMemoryUrl = memoryUrl?.trim();
  if (preferMemory && resolvedMemoryUrl) return { kind: 'memory', url: resolvedMemoryUrl };
  if (resolvedCoverUrl) return { kind: 'trip-cover', url: resolvedCoverUrl };
  if (resolvedMemoryUrl) return { kind: 'memory', url: resolvedMemoryUrl };
  if (editorial) return { kind: 'editorial', reference: editorial };
  return { kind: 'fallback' };
}

/**
 * The same ladder for a place, which has no upload and no Memory of its own:
 * editorial photograph, then the branded fallback tinted by its category.
 */
export function resolvePlaceMediaSource({
  editorial,
}: {
  editorial?: EditorialImageReference | null;
}): PlaceMediaSource {
  if (editorial) return { kind: 'editorial', reference: editorial };
  return { kind: 'fallback' };
}
