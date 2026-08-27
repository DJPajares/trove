import { ArrowLeft } from 'lucide-react';

import { TripMedia } from '@/components/trip-media';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Trip detail while its trip is still in flight.
 *
 * It is the screen, not a shape standing in for it: the same cover frame at the
 * same height with the same back button, and blanks where the name, the dates
 * and the tiles will be. Nothing here moves when the trip arrives — the
 * photograph and the words simply appear inside boxes that were already the
 * right size.
 *
 * The route's `loading.tsx` and the component's own loading branch both render
 * this, so the handoff between them is invisible.
 */
export function TripDetailSkeleton({ label }: Readonly<{ label: string }>) {
  return (
    <article aria-busy="true" aria-live="polite" className="w-full space-y-8" role="status">
      <span className="sr-only">{label}</span>
      <section className="relative isolate -mx-[var(--gutter-inline-start)] -mt-8 md:mx-0 md:mt-0">
        <TripMedia alt="" source={{ kind: 'fallback' }} variant="cover" />
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-end rounded-none bg-gradient-to-t from-surface-overlay from-10% via-surface-overlay/66 to-transparent p-5 sm:p-8 md:rounded-[var(--radius-2xl)]">
          <Skeleton className="h-[length:var(--text-metadata)] w-36 bg-media-fallback-foreground/20" />
          <Skeleton className="mt-1 h-[calc(var(--text-page-title)*1.08*2)] w-4/5 max-w-sm bg-media-fallback-foreground/20" />
          <Skeleton className="mt-1 h-[length:var(--text-metadata)] w-2/5 max-w-40 bg-media-fallback-foreground/20" />
        </div>
        <span
          aria-hidden="true"
          className="absolute top-[max(1rem,var(--safe-top))] left-[max(1rem,var(--safe-left))] z-10 flex size-10 items-center justify-center rounded-full border border-media-fallback-foreground/18 bg-neutral-950/58 text-media-fallback-foreground backdrop-blur-sm"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
        </span>
      </section>

      {/* The primary action and the two experience tiles, in the shape and at
          the sizes `TripDetail` gives them. */}
      <div aria-hidden="true" className="space-y-3">
        <Skeleton className="h-11 w-full rounded-[var(--radius-md)]" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-28 w-full rounded-[var(--radius-xl)]" />
          <Skeleton className="h-28 w-full rounded-[var(--radius-xl)]" />
        </div>
      </div>

      <div aria-hidden="true" className="space-y-3">
        <Skeleton className="h-4 w-2/5 max-w-48" />
        <Skeleton className="h-4 w-3/5 max-w-72" />
        <Skeleton className="h-4 w-1/2 max-w-60" />
      </div>
    </article>
  );
}
