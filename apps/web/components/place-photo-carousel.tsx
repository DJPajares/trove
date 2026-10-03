'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { PlaceMedia } from '@/components/place-media';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { carouselIndex, photographicDescription } from '@/lib/media/editorial-carousel';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import { resolvePlaceMediaSource, type PlaceMediaSource } from '@/lib/media/trip-media';
import type { TrovePlaceCategory } from '@/lib/place-categories';
import type { PlaceProviderPhoto, PlaceProviderPhotoSlot } from '@/lib/saved/api';
import { cn } from '@/lib/utils';

export type PlacePhotoMetadata = {
  credits: PlaceProviderPhoto['authorAttributions'];
  description: string | null;
  illustrative: boolean;
};

type PlacePhotoCarouselProps = {
  category?: TrovePlaceCategory;
  className?: string;
  editorialImages: EditorialImageReference[];
  heading?: ReactNode;
  name: string;
  /** The owning drawer renders metadata outside the photographic cover. */
  onPhotoChange?: (photo: PlacePhotoMetadata | null) => void;
  /** Google's photos have not been answered for yet; editorial would only be swapped out. */
  pending?: boolean;
  providerPhotos?: PlaceProviderPhoto[];
  providerPhotoSlots?: PlaceProviderPhotoSlot[];
  onRequestPhoto?: (id: string) => void;
  photoRequests?: Record<string, 'loading' | 'failed'>;
  evidenceFetchedAt?: string;
};

type Slide = PlacePhotoMetadata & {
  /** Set for a Google photo, so an unreachable image can fall back in the same slot. */
  googleUri: string | null;
  photoId: string | null;
  key: string;
  source: PlaceMediaSource;
};

const NO_PROVIDER_PHOTOS: PlaceProviderPhoto[] = [];

const overlayControl =
  'border-media-fallback-foreground/18 bg-neutral-950/58 text-media-fallback-foreground backdrop-blur-sm hover:bg-neutral-950/78 hover:text-media-fallback-foreground';

/**
 * The cover of Place Details: a small native carousel, fixed at the top of the
 * sheet so it never scrolls away with the details beneath it.
 *
 * Google's own photos of the place come first, each credited to its author as
 * Google requires. Editorial photography stands in when there are none, when
 * they could not be fetched, or when every one of them fails to load - a stored
 * Google URL can stop working before its 30 days are up.
 */
export function PlacePhotoCarousel({
  category,
  className,
  editorialImages,
  heading,
  name,
  onPhotoChange,
  pending = false,
  providerPhotos = NO_PROVIDER_PHOTOS,
  providerPhotoSlots,
  onRequestPhoto,
  photoRequests,
  evidenceFetchedAt,
}: Readonly<PlacePhotoCarouselProps>) {
  const t = useTranslations('placeDetail');
  const trackRef = useRef<HTMLDivElement>(null);
  const scrollTarget = useRef<number | null>(null);
  const [failedUris, setFailedUris] = useState<ReadonlySet<string>>(() => new Set());

  const google = useMemo(
    () =>
      providerPhotoSlots ?? providerPhotos.map((photo, index) => ({ ...photo, id: String(index) })),
    [providerPhotoSlots, providerPhotos],
  );
  const generic = editorialImages[0]?.matchKind === 'generic';
  const slides: Slide[] = useMemo(
    () =>
      google.length
        ? google.map((photo) => {
            const usable = Boolean(photo.uri && !failedUris.has(photo.uri));
            const fallback = editorialImages[0];
            return {
              credits: usable ? photo.authorAttributions : [],
              description: !usable && fallback ? photographicDescription(fallback) : null,
              illustrative: !usable && Boolean(generic),
              googleUri: photo.uri,
              photoId: photo.id,
              key: `google:${photo.id}`,
              source: usable
                ? { kind: 'provider-photo' as const, url: photo.uri! }
                : resolvePlaceMediaSource({ editorial: fallback }),
            };
          })
        : (generic ? editorialImages.slice(0, 1) : editorialImages).map((image) => ({
            credits: [],
            description: photographicDescription(image),
            illustrative: image.matchKind === 'generic',
            googleUri: null,
            photoId: null,
            key: `editorial:${image.externalPhotoId}`,
            source: resolvePlaceMediaSource({ editorial: image }),
          })),
    [google, failedUris, generic, editorialImages],
  );
  const total = slides.length;
  // A different set of slides starts again from its first; the track is keyed
  // the same way, so its scroll position starts over with it.
  const setKey = google.length ? `google:${evidenceFetchedAt ?? ''}` : 'editorial';
  const [active, setActive] = useState({ index: 0, setKey });
  const activeIndex = active.setKey === setKey ? carouselIndex(active.index, total) : 0;
  const activeSlide = slides[activeIndex];
  const unresolved = activeSlide?.photoId !== null && activeSlide?.googleUri === null;
  const requestState = activeSlide?.photoId
    ? photoRequests?.[`${evidenceFetchedAt}:${activeSlide.photoId}`]
    : undefined;
  // The details response already attempted the cover. An unresolved cover is
  // a failure, not a reason to silently make a second media request.
  const photoFailed = Boolean(
    unresolved && (requestState === 'failed' || (activeIndex === 0 && requestState !== 'loading')),
  );
  const loadingPhoto = unresolved && !photoFailed;
  useEffect(() => {
    onPhotoChange?.(pending || loadingPhoto ? null : (activeSlide ?? null));
  }, [activeSlide, pending, loadingPhoto, onPhotoChange]);

  function goTo(index: number) {
    const nextIndex = carouselIndex(index, total);
    scrollTarget.current = nextIndex;
    requestSlide(nextIndex);
    trackRef.current?.scrollTo({ left: (trackRef.current?.clientWidth ?? 0) * nextIndex });
    setActive({ index: nextIndex, setKey });
  }

  function requestSlide(index: number) {
    const slide = slides[index];
    if (slide?.photoId && slide.googleUri === null) onRequestPhoto?.(slide.photoId);
  }

  function markUnreachable(uri: string) {
    setFailedUris((current) => new Set(current).add(uri));
  }

  return (
    <figure
      aria-busy={pending || loadingPhoto || undefined}
      aria-label={t(google.length ? 'googlePhotoCarousel' : 'photoCarousel', { name })}
      className={cn(
        'relative isolate h-[clamp(13rem,34dvh,19rem)] w-full shrink-0 overflow-hidden bg-surface-media md:h-[clamp(15rem,40dvh,22rem)]',
        className,
      )}
    >
      {pending ? (
        <Skeleton className="absolute inset-0 rounded-none" />
      ) : (
        <div
          className="absolute inset-0 flex snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] outline-none motion-reduce:scroll-auto focus-visible:ring-3 focus-visible:ring-ring/40 [&::-webkit-scrollbar]:hidden"
          key={setKey}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              goTo(activeIndex - 1);
            }
            if (event.key === 'ArrowRight') {
              event.preventDefault();
              goTo(activeIndex + 1);
            }
          }}
          onScroll={(event) => {
            if (scrollTarget.current !== null) return;
            const track = event.currentTarget;
            const nextIndex = Math.round(track.scrollLeft / Math.max(track.clientWidth, 1));
            if (nextIndex !== activeIndex && nextIndex >= 0 && nextIndex < total) {
              setActive({ index: nextIndex, setKey });
            }
          }}
          onScrollEnd={(event) => {
            const track = event.currentTarget;
            const index = carouselIndex(
              Math.round(track.scrollLeft / Math.max(track.clientWidth, 1)),
              total,
            );
            const navigatedByControl = scrollTarget.current !== null;
            scrollTarget.current = null;
            setActive({ index, setKey });
            if (!navigatedByControl) requestSlide(index);
          }}
          ref={trackRef}
          tabIndex={total > 1 ? 0 : -1}
        >
          {total === 0 ? (
            <PlaceMedia
              alt=""
              category={category}
              className="aspect-auto h-full w-full shrink-0 rounded-none"
              sizes="(max-width: 768px) 100vw, 30rem"
              source={resolvePlaceMediaSource({})}
              variant="card"
            />
          ) : (
            slides.map(({ googleUri, photoId: _photoId, ...slide }, index) => (
              <div
                aria-hidden={index !== activeIndex}
                className="h-full w-full shrink-0 snap-center"
                key={slide.key}
              >
                {index === activeIndex && !loadingPhoto ? (
                  <PlaceMedia
                    alt={t(google.length ? 'googlePhotoAlt' : 'photoAlt', {
                      current: index + 1,
                      name,
                      total,
                    })}
                    category={category}
                    className="aspect-auto h-full w-full rounded-none"
                    onUnreachable={googleUri ? () => markUnreachable(googleUri) : undefined}
                    sizes="(max-width: 768px) 100vw, 30rem"
                    source={slide.source}
                    variant="card"
                  />
                ) : (
                  <Skeleton className="h-full w-full rounded-none" />
                )}
              </div>
            ))
          )}
        </div>
      )}

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-linear-to-t from-neutral-950/82 via-neutral-950/18 to-neutral-950/30"
      />

      {photoFailed && activeSlide?.photoId ? (
        <div className="absolute inset-x-6 top-6 z-10 flex items-center justify-between gap-3 rounded-lg bg-neutral-950/75 px-3 py-2 text-sm text-media-fallback-foreground">
          <p role="status">{t('photoUnavailable')}</p>
          <Button
            className={overlayControl}
            onClick={() => requestSlide(activeIndex)}
            size="sm"
            type="button"
            variant="ghost"
          >
            {t('retryPhoto')}
          </Button>
        </div>
      ) : null}

      {heading ? (
        <div
          className={cn(
            'pointer-events-none absolute inset-x-0 bottom-0 grid gap-1 px-6 pb-5',
            total > 1 && !pending && 'pb-11',
          )}
        >
          {heading}
        </div>
      ) : null}

      {total > 1 && !pending ? (
        <>
          {/* On a phone the cover is short enough that centred arrows sit on
              the title; there the track swipes and the dots still navigate. */}
          <Button
            aria-label={t('previousPhoto')}
            className={cn('absolute top-1/2 left-3 -translate-y-1/2 max-md:hidden', overlayControl)}
            disabled={activeIndex === 0}
            onClick={() => goTo(activeIndex - 1)}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button
            aria-label={t('nextPhoto')}
            className={cn(
              'absolute top-1/2 right-3 -translate-y-1/2 max-md:hidden',
              overlayControl,
            )}
            disabled={activeIndex === total - 1}
            onClick={() => goTo(activeIndex + 1)}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <ChevronRight aria-hidden="true" />
          </Button>

          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-0.5">
            {slides.map((slide, index) => (
              <Button
                aria-current={activeIndex === index ? 'true' : undefined}
                aria-label={t('goToPhoto', { current: index + 1 })}
                className="text-media-fallback-foreground hover:bg-media-fallback-foreground/12 hover:text-media-fallback-foreground"
                key={slide.key}
                onClick={() => goTo(index)}
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-1.5 w-1.5 rounded-full bg-media-fallback-foreground/50 transition-[width,background-color] duration-[var(--motion-standard)] motion-reduce:transition-none',
                    activeIndex === index && 'w-3.5 bg-media-fallback-foreground',
                  )}
                />
              </Button>
            ))}
          </div>

          <p
            aria-label={t('photoPosition', { current: activeIndex + 1, total })}
            aria-live="polite"
            className="absolute right-4 bottom-3 text-xs font-medium tabular-nums text-media-fallback-foreground/85"
          >
            {t('photoCount', { current: activeIndex + 1, total })}
          </p>
        </>
      ) : null}
    </figure>
  );
}
