'use client';

import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { CoverArtworkCredit } from '@/components/cover-artwork-credit';
import { MediaFrame } from '@/components/media-frame';
import { COVER_BLEED, COVER_HEIGHT, MEASURE, SCRIM } from '@/components/saved/finds-cover';
import { useCoverUnderHeader } from '@/hooks/use-cover-under-header';
import { dayHeaderFallback } from '@/lib/media/day-header-fallback';
import type { TripMediaSource } from '@/lib/media/trip-media';
import { pageEntrance } from '@/lib/page-entrance';
import { cn } from '@/lib/utils';

/**
 * Atlas's photographic cover, in the same frame as Home, Trips, Finds and Kit:
 * an editorial photograph with the page's name set on it in the journal serif.
 * Without a photograph it falls back to Trove's bundled artwork.
 */
export function AtlasCover({
  back,
  children,
  description,
  enter = true,
  folio,
  kicker,
  media,
  title,
}: Readonly<{
  back?: { href: string; label: string };
  children?: ReactNode;
  description?: string;
  /** The page's entrance, already decided for this mount. */
  enter?: boolean;
  /** Compact mono folio shown at the cover's top end (e.g. code and coordinates). */
  folio?: string;
  kicker: string;
  media: TripMediaSource | null;
  title: string;
}>) {
  useCoverUnderHeader();

  return (
    <section
      aria-labelledby="atlas-heading"
      className={cn(
        'relative isolate flex flex-col justify-end overflow-hidden bg-surface-media text-white',
        COVER_BLEED,
        COVER_HEIGHT,
      )}
      data-slot="atlas-cover"
    >
      <MediaFrame
        alt=""
        className={cn(
          'absolute inset-0 -z-20 h-full w-full rounded-none',
          enter && pageEntrance.media,
        )}
        dataSlot="atlas-cover-media"
        photographicPlaceholder={media ? undefined : dayHeaderFallback.preview}
        preload
        sizes="100vw"
        source={media ?? { kind: 'local', src: dayHeaderFallback.src }}
        variant="cover"
      />
      <div aria-hidden="true" className={SCRIM} />
      {media ? null : <CoverArtworkCredit />}

      {back ? (
        <Link
          className="absolute start-[var(--gutter-inline-start)] top-[calc(var(--safe-top)+0.75rem)] z-20 inline-flex h-11 items-center gap-1 rounded-full bg-black/25 pe-4 ps-2.5 text-sm font-semibold text-white backdrop-blur-md outline-none hover:bg-black/35 focus-visible:ring-3 focus-visible:ring-white/70 md:top-[calc(var(--safe-top)+var(--header-height)+1rem)]"
          href={back.href}
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          {back.label}
        </Link>
      ) : null}

      {folio ? (
        <p className="pointer-events-none absolute end-[var(--gutter-inline-end)] top-[calc(var(--safe-top)+1.25rem)] z-20 hidden font-mono text-xs tracking-wider text-white/75 uppercase tabular-nums sm:block md:top-[calc(var(--safe-top)+var(--header-height)+1.5rem)]">
          {folio}
        </p>
      ) : null}

      <div className={MEASURE}>
        <div
          className={cn(
            'mx-auto w-full max-w-5xl pt-[calc(var(--safe-top)+5rem)] pb-16 md:pt-[calc(var(--safe-top)+var(--header-height)+3rem)] md:pb-24',
            enter && pageEntrance.rise,
          )}
        >
          <p className="text-[0.6875rem] font-semibold tracking-[0.14em] text-white/80 uppercase">
            {kicker}
          </p>
          <h1
            className="mt-2 max-w-[14ch] font-journal text-[clamp(3.25rem,14vw,5.5rem)] leading-[0.92] font-normal tracking-[-0.01em] text-balance [overflow-wrap:anywhere]"
            id="atlas-heading"
          >
            {title}
          </h1>
          {description ? (
            <p className="mt-3 max-w-md text-base leading-[1.55] text-pretty text-white/90">
              {description}
            </p>
          ) : null}
          {children}
        </div>
      </div>
    </section>
  );
}
