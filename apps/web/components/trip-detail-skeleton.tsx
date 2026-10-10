import { Skeleton } from '@/components/ui/skeleton';

/** The Trip hub's own shape - cover, trip row, chapter - so nothing jumps when it arrives. */
export function TripDetailSkeleton({ label }: Readonly<{ label: string }>) {
  return (
    <article aria-busy="true" aria-live="polite" className="mx-auto w-full max-w-5xl" role="status">
      <span className="sr-only">{label}</span>
      <div
        aria-hidden="true"
        className="-mx-[var(--gutter-inline-start)] -mt-8 lg:mx-0 lg:mt-0 lg:grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-x-5 lg:gap-y-4 lg:[grid-template-areas:'cover_chapter'_'bar_bar']"
      >
        <div className="relative lg:[grid-area:cover]">
          <Skeleton className="h-[clamp(27rem,118vw,34rem)] rounded-none lg:h-full lg:min-h-[33rem] lg:rounded-[var(--radius-2xl)]" />
          <div className="absolute inset-x-0 bottom-0 space-y-3 px-[var(--gutter-inline-start)] pb-14 lg:px-9 lg:pb-9">
            <Skeleton className="h-6 w-28 rounded-full bg-white/20" />
            <Skeleton className="h-9 w-4/5 bg-white/20" />
            <Skeleton className="h-4 w-2/5 bg-white/20" />
          </div>
        </div>
        <div className="relative -mt-8 flex h-14 items-center gap-3 rounded-t-[var(--trip-sheet-radius)] border-b border-border-subtle bg-background px-[var(--gutter-inline-start)] pt-2 lg:mt-0 lg:rounded-none lg:bg-transparent lg:px-0 lg:[grid-area:bar]">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-20" />
          <Skeleton className="ml-auto h-9 w-28 rounded-full" />
        </div>
        <div className="space-y-4 px-[var(--gutter-inline-start)] pt-6 lg:rounded-[var(--radius-2xl)] lg:border lg:border-border-subtle lg:p-7 lg:[grid-area:chapter]">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-4/5" />
          <Skeleton className="h-24 w-full rounded-[var(--radius-xl)]" />
          <Skeleton className="h-12 w-full rounded-[var(--radius-lg)]" />
          <div className="grid grid-cols-2 gap-2.5">
            <Skeleton className="h-24 rounded-[var(--radius-xl)]" />
            <Skeleton className="h-24 rounded-[var(--radius-xl)]" />
          </div>
        </div>
      </div>
    </article>
  );
}
