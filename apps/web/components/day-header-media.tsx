import { MediaFrame, type MediaFrameProps } from '@/components/media-frame';
import { dayHeaderFallback } from '@/lib/media/day-header-fallback';
import type { TripMediaSource } from '@/lib/media/trip-media';

/** Both day surfaces keep a photograph beneath every asynchronous source. */
export function DayHeaderMedia({
  photos,
  ...props
}: Readonly<
  Omit<MediaFrameProps, 'source' | 'fallbackSources' | 'photographicPlaceholder'> & {
    photos: readonly TripMediaSource[];
  }
>) {
  return (
    <MediaFrame
      {...props}
      source={photos[0] ?? { kind: 'local', src: dayHeaderFallback.src }}
      fallbackSources={photos.slice(1)}
      photographicPlaceholder={dayHeaderFallback.preview}
    />
  );
}
