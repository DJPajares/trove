import { Skeleton } from '@/components/ui/skeleton';

/**
 * A collection's page before its places arrive: the way back, its heading and
 * a grid of cards in the places they will land, so nothing jumps.
 */
export function SavedCollectionSkeleton({ label }: Readonly<{ label: string }>) {
  return (
    <section
      aria-busy="true"
      aria-live="polite"
      className="mx-auto w-full max-w-6xl space-y-8"
      role="status"
    >
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="space-y-3">
        <Skeleton className="h-5 w-28 rounded-full" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-10 w-3/5 max-w-sm" />
        <Skeleton className="h-4 w-24" />
      </div>
      <div
        aria-hidden="true"
        className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4"
      >
        {Array.from({ length: 4 }, (_, index) => (
          <div className="space-y-2" key={index}>
            <Skeleton className="aspect-[4/3] w-full rounded-[var(--radius-xl)]" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ))}
      </div>
    </section>
  );
}
