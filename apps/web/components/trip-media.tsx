import { cva } from 'class-variance-authority';
import Image from 'next/image';

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

type TripMediaProps = {
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
  preload?: boolean;
  sizes?: string;
  source: TripMediaSource;
  variant?: TripMediaVariant;
};

function BrandedFallback({
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

export function TripMedia({
  alt,
  category = 'destination',
  className,
  preload = false,
  sizes,
  source,
  variant = 'card',
}: Readonly<TripMediaProps>) {
  const frameClassName = cn(frameVariants({ variant }), className);

  if (source.kind === 'fallback') {
    return (
      <span className={frameClassName} data-media-kind="fallback" data-slot="trip-media">
        <BrandedFallback alt={alt} category={category} />
      </span>
    );
  }

  if (source.kind === 'memory' && /^(blob:|data:)/.test(source.url)) {
    return (
      <span className={frameClassName} data-media-kind="memory" data-slot="trip-media">
        {/* Offline Memory previews use browser-local URLs that Next Image cannot optimize. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt={alt}
          className="absolute inset-0 size-full object-cover"
          decoding="async"
          loading={preload ? 'eager' : 'lazy'}
          src={source.url}
        />
      </span>
    );
  }

  const src = source.kind === 'local' ? source.src : source.url;

  return (
    <span className={frameClassName} data-media-kind={source.kind} data-slot="trip-media">
      <Image
        alt={alt}
        className="object-cover"
        fill
        preload={preload}
        sizes={sizes}
        src={src}
        unoptimized={source.kind !== 'local'}
      />
    </span>
  );
}
