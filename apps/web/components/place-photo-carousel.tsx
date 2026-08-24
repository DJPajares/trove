'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import { PlaceMedia } from '@/components/place-media';
import { Button } from '@/components/ui/button';
import { carouselIndex, photographicDescription } from '@/lib/media/editorial-carousel';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import { resolvePlaceMediaSource } from '@/lib/media/trip-media';
import type { TrovePlaceCategory } from '@/lib/place-categories';

type PlacePhotoCarouselProps = {
  category?: TrovePlaceCategory;
  images: EditorialImageReference[];
  name: string;
};

/** A small native carousel shared by every entry point into Place Details. */
export function PlacePhotoCarousel({ category, images, name }: Readonly<PlacePhotoCarouselProps>) {
  const t = useTranslations('placeDetail');
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const total = images.length;
  const activeImage = images[activeIndex];
  const description = photographicDescription(activeImage);

  function goTo(index: number) {
    const nextIndex = carouselIndex(index, total);
    const track = trackRef.current;
    if (!track) return;
    track.scrollTo({ left: track.clientWidth * nextIndex });
    setActiveIndex(nextIndex);
  }

  if (total === 0) {
    return (
      <PlaceMedia
        alt=""
        category={category}
        sizes="(max-width: 768px) 100vw, 30rem"
        source={resolvePlaceMediaSource({})}
        variant="card"
      />
    );
  }

  return (
    <figure aria-label={t('photoCarousel', { name })} className="grid gap-3">
      <div
        className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth rounded-[var(--radius-xl)] [scrollbar-width:none] outline-none motion-reduce:scroll-auto focus-visible:ring-3 focus-visible:ring-ring/40 [&::-webkit-scrollbar]:hidden"
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
        {images.map((image, index) => (
          <div
            aria-hidden={index !== activeIndex}
            className="w-full shrink-0 snap-center"
            key={image.externalPhotoId}
          >
            <PlaceMedia
              alt={t('photoAlt', { current: index + 1, name, total })}
              category={category}
              sizes="(max-width: 768px) 100vw, 30rem"
              source={resolvePlaceMediaSource({ editorial: image })}
              variant="card"
            />
          </div>
        ))}
      </div>

      {total > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <p aria-live="polite" className="text-xs font-medium text-muted-foreground">
            {t('photoPosition', { current: activeIndex + 1, total })}
          </p>
          <div className="flex gap-2">
            <Button
              aria-label={t('previousPhoto')}
              disabled={activeIndex === 0}
              onClick={() => goTo(activeIndex - 1)}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <Button
              aria-label={t('nextPhoto')}
              disabled={activeIndex === total - 1}
              onClick={() => goTo(activeIndex + 1)}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </div>
      ) : null}

      {description ? (
        <figcaption className="grid gap-1 text-sm leading-relaxed text-muted-foreground">
          <span className="text-xs font-medium text-foreground">{t('photoDescription')}</span>
          <span>{description}</span>
        </figcaption>
      ) : null}
    </figure>
  );
}
