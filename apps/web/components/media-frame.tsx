'use client';

import { cva } from 'class-variance-authority';
import Image from 'next/image';
import { useState } from 'react';

import { MediaAttribution } from '@/components/media-attribution';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import { pexelsImageLoader } from '@/lib/media/pexels-loader';
import { resolvePlaceCategoryFallback } from '@/lib/media/place-category-fallback';
import type { TripMediaSource, TripMediaVariant } from '@/lib/media/trip-media';
import type { TrovePlaceCategory } from '@/lib/place-categories';
import { cn } from '@/lib/utils';

const frameVariants = cva(
  'relative isolate block overflow-hidden bg-surface-media text-primary-foreground',
  {
    variants: {
      variant: {
        card: 'aspect-[4/3] rounded-[var(--radius-xl)]',
        hero: 'aspect-[4/5] rounded-[var(--radius-2xl)] sm:aspect-[2/1]',
        thumbnail: 'aspect-square rounded-[var(--radius-md)]',
      },
    },
    defaultVariants: { variant: 'card' },
  },
);

export type MediaFrameProps = {
  alt: string;
  /**
   * What the media stands for, so the fallback can be specific to it. Defaults
   * to `destination`, because trip media is a destination and that is the tint
   * this frame has always carried. A place surface passes its own category, and
   * passes none when it has none - a category is derived rather than stored, and
   * a Custom Place never has one.
   */
  category?: TrovePlaceCategory;
  className?: string;
  /**
   * Where the editorial credit goes. `overlay` is the default because the
   * obligation belongs to the frame, not to each caller remembering it.
   *
   * `none` is for frames too small to carry text - a 40px row thumbnail - where
   * a credit under every row turns a list of places into a list of
   * photographers. It is not a way out of crediting: it commits the caller to a
   * surface that opens the photograph large enough to credit it properly, which
   * is what `PlaceDetailsSheet` is for.
   */
  credit?: 'none' | 'overlay';
  dataSlot: string;
  preload?: boolean;
  sizes?: string;
  source: TripMediaSource;
  variant?: TripMediaVariant;
};

export function BrandedFallback({
  alt,
  category,
}: Readonly<{ alt: string; category?: TrovePlaceCategory }>) {
  const { Icon, gradientClassName } = resolvePlaceCategoryFallback(category);

  return (
    <span
      aria-hidden={alt ? undefined : 'true'}
      aria-label={alt || undefined}
      className={cn(
        'absolute inset-0 grid place-items-center overflow-hidden text-media-fallback-foreground',
        gradientClassName,
      )}
      role={alt ? 'img' : undefined}
    >
      <span
        aria-hidden="true"
        className="absolute -right-[18%] -bottom-[28%] size-[78%] rounded-full border border-media-fallback-foreground/15 bg-accent/25"
      />
      <span
        aria-hidden="true"
        className="absolute top-[12%] left-[10%] h-px w-[42%] -rotate-12 bg-media-fallback-foreground/24"
      />
      <span className="relative grid size-12 place-items-center rounded-[var(--radius-lg)] border border-media-fallback-foreground/18 bg-media-fallback-foreground/10 shadow-[inset_0_1px_0_oklch(1_0_0/0.16)]">
        <Icon aria-hidden="true" className="size-5" strokeWidth={1.75} />
      </span>
    </span>
  );
}

/**
 * An editorial photograph, painted onto its own dominant colour while it loads.
 *
 * The colour is what the provider already measured, so the frame is never an
 * empty grey rectangle and never shifts once the bytes arrive. The fade is a
 * plain opacity transition on a duration token, which the global reduced-motion
 * rule collapses to nothing.
 *
 * `onError` is the whole of Trove's resilience story for hotlinked imagery: a
 * blocked host, an offline device and a provider outage all end here, and all
 * end as the branded fallback rather than as a broken image.
 */
function EditorialImage({
  alt,
  onError,
  preload,
  reference,
  sizes,
}: Readonly<{
  alt: string;
  onError: () => void;
  preload: boolean;
  reference: EditorialImageReference;
  sizes?: string;
}>) {
  const [loaded, setLoaded] = useState(false);

  return (
    <>
      <Image
        alt={alt}
        className={cn(
          'object-cover transition-opacity duration-[var(--motion-standard)] ease-[var(--ease-standard)]',
          loaded ? 'opacity-100' : 'opacity-0',
        )}
        fill
        loader={pexelsImageLoader}
        onError={onError}
        onLoad={() => setLoaded(true)}
        preload={preload}
        sizes={sizes}
        src={reference.sources.large}
      />
    </>
  );
}

/**
 * The one frame every Trove media surface renders through.
 *
 * `TripMedia` and `PlaceMedia` differ only in the ladder that produced their
 * source, so the frame vocabulary, the branded fallback and the credit live
 * here once rather than twice.
 */
export function MediaFrame({
  alt,
  category = 'destination',
  className,
  credit = 'overlay',
  dataSlot,
  preload = false,
  sizes,
  source,
  variant = 'card',
}: Readonly<MediaFrameProps>) {
  const [unreachable, setUnreachable] = useState(false);
  const frameClassName = cn(frameVariants({ variant }), className);
  const resolved = unreachable ? ({ kind: 'fallback' } as const) : source;

  if (resolved.kind === 'fallback') {
    return (
      <span className={frameClassName} data-media-kind="fallback" data-slot={dataSlot}>
        <BrandedFallback alt={alt} category={category} />
      </span>
    );
  }

  if (resolved.kind === 'editorial') {
    return (
      <span
        className={frameClassName}
        data-media-kind="editorial"
        data-slot={dataSlot}
        style={
          resolved.reference.dominantColor
            ? { backgroundColor: resolved.reference.dominantColor }
            : undefined
        }
      >
        <EditorialImage
          alt={alt}
          onError={() => setUnreachable(true)}
          preload={preload}
          reference={resolved.reference}
          sizes={sizes}
        />
        {credit === 'overlay' ? (
          <MediaAttribution attribution={resolved.reference.attribution} />
        ) : null}
      </span>
    );
  }

  if (resolved.kind === 'memory' && /^(blob:|data:)/.test(resolved.url)) {
    return (
      <span className={frameClassName} data-media-kind="memory" data-slot={dataSlot}>
        {/* Offline Memory previews use browser-local URLs that Next Image cannot optimize. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt={alt}
          className="absolute inset-0 size-full object-cover"
          decoding="async"
          loading={preload ? 'eager' : 'lazy'}
          onError={() => setUnreachable(true)}
          src={resolved.url}
        />
      </span>
    );
  }

  const src = resolved.kind === 'local' ? resolved.src : resolved.url;

  return (
    <span className={frameClassName} data-media-kind={resolved.kind} data-slot={dataSlot}>
      <Image
        alt={alt}
        className="object-cover"
        fill
        onError={() => setUnreachable(true)}
        preload={preload}
        sizes={sizes}
        src={src}
        unoptimized={resolved.kind !== 'local'}
      />
    </span>
  );
}
