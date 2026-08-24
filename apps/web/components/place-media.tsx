'use client';

import { MediaFrame, type MediaFrameProps } from '@/components/media-frame';
import type { PlaceMediaSource } from '@/lib/media/trip-media';

type PlaceMediaProps = Omit<MediaFrameProps, 'dataSlot' | 'source'> & {
  source: PlaceMediaSource;
};

/**
 * A place's media - `TripMedia`'s sibling, sharing its frames and fallback. A
 * place has no upload and no Memory of its own, so its source is narrower: an
 * editorial photograph, or the fallback tinted by its category.
 */
export function PlaceMedia(props: Readonly<PlaceMediaProps>) {
  return <MediaFrame {...props} dataSlot="place-media" />;
}
