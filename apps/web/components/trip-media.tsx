'use client';

import { MediaFrame, type MediaFrameProps } from '@/components/media-frame';

type TripMediaProps = Omit<MediaFrameProps, 'dataSlot'>;

/**
 * A trip's media, in the frame every Trove surface shares. The source comes
 * from `resolveTripMediaSource`, so the ladder - upload, Memory photo,
 * editorial photograph, branded fallback - is decided once, not per surface.
 */
export function TripMedia(props: Readonly<TripMediaProps>) {
  return <MediaFrame {...props} dataSlot="trip-media" />;
}
