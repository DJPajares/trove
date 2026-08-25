'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type ReactNode } from 'react';

import { PlaceMedia } from '@/components/place-media';
import { Button } from '@/components/ui/button';
import { carouselIndex, photographicDescription } from '@/lib/media/editorial-carousel';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import { resolvePlaceMediaSource } from '@/lib/media/trip-media';
import type { TrovePlaceCategory } from '@/lib/place-categories';
import { cn } from '@/lib/utils';

type PlacePhotoCarouselProps = {
  category?: TrovePlaceCategory;
  footer?: ReactNode;
  heading?: ReactNode;
  images: EditorialImageReference[];
  name: string;
};

/** A small native carousel shared by every entry point into Place Details. */
export function PlacePhotoCarousel({
  category,
  footer,
  heading,
  images,
  name,
}: Readonly<PlacePhotoCarouselProps>) {
  const t = useTranslations('placeDetail');
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const generic = images[0]?.matchKind === 'generic';
  const photographs = generic ? images.slice(0, 1) : images;
  const total = photographs.length;
  const activeImage = photographs[activeIndex];
  const description = photographicDescription(activeImage);

  function goTo(index: number) {
    const nextIndex = carouselIndex(index, total);
    const track = trackRef.current;
    if (!track) return;
    track.scrollTo({ left: track.clientWidth * nextIndex });
    setActiveIndex(nextIndex);
  }

  return (
    <figure aria-label={t('photoCarousel', { name })} className="grid">
      <div className="relative isolate aspect-[4/3] max-h-[48dvh] min-h-60 w-full overflow-hidden bg-surface-media md:aspect-[5/4] md:max-h-[28rem]">
        <div
          className="absolute inset-0 flex snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] outline-none motion-reduce:scroll-auto focus-visible:ring-3 focus-visible:ring-ring/40 [&::-webkit-scrollbar]:hidden"
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
            const track = event.currentTarget;
            const nextIndex = Math.round(track.scrollLeft / Math.max(track.clientWidth, 1));
            if (nextIndex !== activeIndex && nextIndex >= 0 && nextIndex < total) {
              setActiveIndex(nextIndex);
            }
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
            photographs.map((image, index) => (
              <div
                aria-hidden={index !== activeIndex}
                className="h-full w-full shrink-0 snap-center"
                key={image.externalPhotoId}
              >
                <PlaceMedia
                  alt={t('photoAlt', { current: index + 1, name, total })}
                  category={category}
                  className="aspect-auto h-full w-full rounded-none"
                  sizes="(max-width: 768px) 100vw, 30rem"
                  source={resolvePlaceMediaSource({ editorial: image })}
                  variant="card"
                />
              </div>
            ))
          )}
        </div>

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-linear-to-t from-neutral-950/82 via-neutral-950/18 to-neutral-950/8"
        />

        {heading ? (
          <div
            className={cn(
              'pointer-events-none absolute inset-x-0 bottom-0 grid gap-1 px-6 pb-6',
              total > 1 && 'pb-12',
            )}
          >
            {heading}
            {generic ? (
              <span className="mt-1 w-fit rounded-[var(--radius-sm)] border border-media-fallback-foreground/18 bg-neutral-950/56 px-2 py-1 text-[0.6875rem] font-medium text-media-fallback-foreground/90 backdrop-blur-sm">
                {t('representativePhoto')}
              </span>
            ) : null}
          </div>
        ) : null}

        {total > 1 ? (
          <>
            <Button
              aria-label={t('previousPhoto')}
              className="absolute top-1/2 left-3 -translate-y-1/2 border-media-fallback-foreground/18 bg-neutral-950/58 text-media-fallback-foreground backdrop-blur-sm hover:bg-neutral-950/78 hover:text-media-fallback-foreground"
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
              className="absolute top-1/2 right-3 -translate-y-1/2 border-media-fallback-foreground/18 bg-neutral-950/58 text-media-fallback-foreground backdrop-blur-sm hover:bg-neutral-950/78 hover:text-media-fallback-foreground"
              disabled={activeIndex === total - 1}
              onClick={() => goTo(activeIndex + 1)}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <ChevronRight aria-hidden="true" />
            </Button>

            <div className="absolute bottom-2.5 left-1/2 flex -translate-x-1/2 items-center gap-0.5">
              {photographs.map((image, index) => (
                <Button
                  aria-current={activeIndex === index ? 'true' : undefined}
                  aria-label={t('goToPhoto', { current: index + 1 })}
                  className="text-media-fallback-foreground hover:bg-media-fallback-foreground/12 hover:text-media-fallback-foreground"
                  key={image.externalPhotoId}
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
              className="absolute right-4 bottom-3.5 text-xs font-medium tabular-nums text-media-fallback-foreground/85"
            >
              {t('photoCount', { current: activeIndex + 1, total })}
            </p>
          </>
        ) : null}
      </div>

      {footer || description ? (
        <figcaption className="grid gap-4 px-6 pt-5">
          {footer}
          {description ? (
            <span className="grid gap-1 text-sm leading-relaxed text-muted-foreground">
              <span className="text-xs font-medium text-foreground">{t('photoDescription')}</span>
              <span>{description}</span>
            </span>
          ) : null}
        </figcaption>
      ) : null}
    </figure>
  );
}
