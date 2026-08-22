import type { StaticImageData } from 'next/image';

export type TripMediaSource =
  | { kind: 'fallback' }
  | { kind: 'local'; src: StaticImageData }
  | { kind: 'memory'; url: string }
  | { kind: 'trip-cover'; url: string };

export type TripMediaVariant = 'card' | 'hero' | 'thumbnail';

type ResolveTripMediaSourceInput = {
  coverUrl?: string | null;
  memoryUrl?: string | null;
};

/**
 * Selects only media Trove already owns or has already loaded. This resolver has
 * no provider branch and performs no I/O, so a visual fallback can never fan out
 * into a Places photo request.
 */
export function resolveTripMediaSource({
  coverUrl,
  memoryUrl,
}: ResolveTripMediaSourceInput): TripMediaSource {
  const resolvedCoverUrl = coverUrl?.trim();
  const resolvedMemoryUrl = memoryUrl?.trim();
  if (resolvedCoverUrl) return { kind: 'trip-cover', url: resolvedCoverUrl };
  if (resolvedMemoryUrl) return { kind: 'memory', url: resolvedMemoryUrl };
  return { kind: 'fallback' };
}
