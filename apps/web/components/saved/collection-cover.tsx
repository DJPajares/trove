'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { MediaFrame } from '@/components/media-frame';
import { COVER_BLEED, COVER_HEIGHT, MEASURE, SCRIM } from '@/components/saved/finds-cover';
import { useCoverUnderHeader } from '@/hooks/use-cover-under-header';
import { dayHeaderFallback } from '@/lib/media/day-header-fallback';
import type { EditorialImageReference } from '@/lib/media/editorial-images';
import { pageEntrance } from '@/lib/page-entrance';
import { cn } from '@/lib/utils';

/**
 * A collection's own cover, in the same frame as Finds: its newest place's
 * photograph edge to edge, its name set large in the journal serif, where its
 * places are, and what can be done with it. With no photograph to show it is
 * Trove's bundled artwork, so a new collection still arrives somewhere.
 */
export function CollectionCover({
  actions,
  backHref,
  backLabel,
  editorial,
  enter,
  kicker,
  name,
  towns,
}: Readonly<{
  actions: ReactNode;
  backHref: string;
  backLabel: string;
  editorial: EditorialImageReference | null;
  /** The page's entrance, already decided for this mount. */
  enter: boolean;
  kicker: string;
  name: string;
  /** Where its places are, already worded; null when no address names a town. */
  towns: string | null;
}>) {
  useCoverUnderHeader();

  return (
    <section
      aria-labelledby="collection-heading"
      className={cn(
        'relative isolate flex flex-col justify-end overflow-hidden bg-surface-media text-white',
        COVER_BLEED,
        COVER_HEIGHT,
      )}
      data-slot="collection-cover"
    >
      <MediaFrame
        alt=""
        className={cn(
          'absolute inset-0 -z-20 h-full w-full rounded-none',
          enter && pageEntrance.media,
        )}
        dataSlot="collection-cover-media"
        photographicPlaceholder={editorial ? undefined : dayHeaderFallback.preview}
        preload
        sizes="100vw"
        source={
          editorial
            ? { kind: 'editorial', reference: editorial }
            : { kind: 'local', src: dayHeaderFallback.src }
        }
        variant="card"
      />
      <div aria-hidden="true" className={SCRIM} />

      {/* Where the trip cover keeps its way back: top left, on the photograph. */}
      <Link
        aria-label={backLabel}
        className="absolute top-[calc(var(--safe-top)+0.75rem)] left-[max(1rem,var(--safe-left))] z-20 grid size-11 place-items-center rounded-full border border-white/18 bg-neutral-950/50 text-white backdrop-blur-md outline-none transition-colors duration-[var(--motion-standard)] hover:bg-neutral-950/75 focus-visible:ring-3 focus-visible:ring-white/60 motion-reduce:transition-none md:top-[calc(var(--safe-top)+var(--header-height)+1.5rem)]"
        href={backHref}
      >
        <ArrowLeft aria-hidden="true" className="size-5 rtl:rotate-180" />
      </Link>

      <div className={MEASURE}>
        <div
          className={cn(
            'mx-auto w-full max-w-6xl pt-[calc(var(--safe-top)+5rem)] pb-16 md:pt-[calc(var(--safe-top)+var(--header-height)+5rem)] md:pb-24',
            enter && pageEntrance.rise,
          )}
        >
          <p className="text-[0.6875rem] font-semibold tracking-[0.14em] text-white/80 uppercase tabular-nums">
            {kicker}
          </p>
          <h1
            className="mt-2 max-w-[16ch] font-journal text-[clamp(3rem,13vw,5.5rem)] leading-[0.92] font-normal tracking-[-0.01em] text-balance [overflow-wrap:anywhere]"
            id="collection-heading"
          >
            {name}
          </h1>
          {towns ? <p className="mt-3 text-sm text-pretty text-white/85">{towns}</p> : null}
          <div className="mt-5 flex flex-wrap items-center gap-2">{actions}</div>
        </div>
      </div>
    </section>
  );
}
