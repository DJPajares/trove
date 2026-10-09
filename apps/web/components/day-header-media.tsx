import { MediaFrame, type MediaFrameProps } from '@/components/media-frame';
import { dayHeaderFallback } from '@/lib/media/day-header-fallback';
import type { DayHeaderPhotoResolution } from '@/lib/media/day-header-photos';

/** Both day surfaces reveal only the settled photo choice, over a calm colour. */
export function DayHeaderMedia({
  resolution,
  ...props
}: Readonly<
  Omit<
    MediaFrameProps,
    'source' | 'fallbackSources' | 'photographicPlaceholder' | 'loadingTreatment' | 'isResolving'
  > & {
    resolution: DayHeaderPhotoResolution;
  }
>) {
  return (
    <MediaFrame
      {...props}
      key={resolution.resolutionKey}
      source={resolution.photos[0] ?? { kind: 'local', src: dayHeaderFallback.src }}
      fallbackSources={resolution.photos.slice(1)}
      isResolving={resolution.isResolving}
      loadingTreatment="calm"
      photographicPlaceholder={dayHeaderFallback.preview}
    />
  );
}
