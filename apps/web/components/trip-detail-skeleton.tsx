import { Skeleton } from '@/components/ui/skeleton';

/** Same photographic opening and chapter as the Trip hub, without a layout jump. */
export function TripDetailSkeleton({ label }: Readonly<{ label: string }>) {
  return (
    <article
      aria-busy="true"
      aria-live="polite"
      className="mx-auto w-full max-w-5xl space-y-6"
      role="status"
    >
      <span className="sr-only">{label}</span>
      <div
        aria-hidden="true"
        className="-mx-[var(--gutter-inline-start)] -mt-8 overflow-hidden bg-background md:mx-0 md:mt-0 md:grid md:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] md:rounded-[var(--radius-2xl)] md:bg-surface-raised"
      >
        <div>
          <Skeleton className="h-[var(--trip-cover-height)] rounded-none md:h-[25rem]" />
          <div className="relative -mt-8 space-y-3 rounded-t-[var(--trip-sheet-radius)] bg-background px-[var(--gutter-inline-start)] pt-6 md:hidden">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-4/5" />
            <Skeleton className="h-5 w-3/5" />
          </div>
        </div>
        <div className="space-y-4 p-6">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-4/5" />
          <Skeleton className="h-5 w-3/5" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="mt-8 h-12 w-full" />
        </div>
      </div>
      <div aria-hidden="true" className="grid grid-cols-2 gap-6 border-b border-border-subtle pb-6">
        <div className="space-y-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-full" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-full" />
        </div>
      </div>
      <div aria-hidden="true" className="space-y-4">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-3/5" />
      </div>
    </article>
  );
}
