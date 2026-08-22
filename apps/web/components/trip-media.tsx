import { cva } from 'class-variance-authority';
import { MapPinned } from 'lucide-react';
import Image from 'next/image';

import type { TripMediaSource, TripMediaVariant } from '@/lib/media/trip-media';
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
  className?: string;
  preload?: boolean;
  sizes?: string;
  source: TripMediaSource;
  variant?: TripMediaVariant;
};

function BrandedFallback({ alt }: Readonly<{ alt: string }>) {
  return (
    <span
      aria-hidden={alt ? undefined : 'true'}
      aria-label={alt || undefined}
      className="absolute inset-0 grid place-items-center overflow-hidden bg-[linear-gradient(145deg,var(--brand-strong),var(--surface-media))]"
      role={alt ? 'img' : undefined}
    >
      <span
        aria-hidden="true"
        className="absolute -right-[18%] -bottom-[28%] size-[78%] rounded-full border border-primary-foreground/15 bg-accent/25"
      />
      <span
        aria-hidden="true"
        className="absolute top-[12%] left-[10%] h-px w-[42%] -rotate-12 bg-primary-foreground/24"
      />
      <span className="relative grid size-12 place-items-center rounded-[var(--radius-lg)] border border-primary-foreground/18 bg-primary-foreground/10 shadow-[inset_0_1px_0_oklch(1_0_0/0.16)]">
        <MapPinned aria-hidden="true" className="size-5" strokeWidth={1.75} />
      </span>
    </span>
  );
}

export function TripMedia({
  alt,
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
        <BrandedFallback alt={alt} />
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
