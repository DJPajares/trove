import { Skeleton } from '@/components/ui/skeleton';

/** The Trip hub's own shape - cover, trip row, chapter - so nothing jumps when it arrives. */
export function TripDetailSkeleton({ label }: Readonly<{ label: string }>) {
  return (
    <article aria-busy="true" aria-live="polite" className="mx-auto w-full max-w-5xl" role="status">
      <span className="sr-only">{label}</span>
      <div
        aria-hidden="true"
        className="relative -mx-[var(--gutter-inline-start)] -mt-8 md:mx-[calc(50%-50vw)] md:-mt-[calc(var(--safe-top)+var(--header-height)+3rem+1px)]"
      >
        <Skeleton className="h-[clamp(27rem,118vw,34rem)] rounded-none md:h-[34rem] lg:h-[36rem]" />
        <div className="absolute inset-x-0 bottom-0 space-y-3 px-[var(--gutter-inline-start)] pb-14 md:mx-auto md:max-w-[calc(64rem+var(--gutter-inline-start)+var(--gutter-inline-end))] md:pb-20">
          <Skeleton className="h-6 w-28 rounded-full bg-white/20" />
          <Skeleton className="h-9 w-4/5 bg-white/20" />
          <Skeleton className="h-4 w-2/5 bg-white/20" />
        </div>
      </div>
      <div
        aria-hidden="true"
        className="relative -mx-[var(--gutter-inline-start)] -mt-8 flex h-14 items-center gap-3 rounded-t-[var(--trip-sheet-radius)] border-b border-border-subtle bg-background px-[var(--gutter-inline-start)] pt-2 md:mx-[calc(50%-50vw)] md:-mt-10 md:h-20 md:rounded-t-[2.5rem] md:px-[calc(50vw-50%)] md:pt-6"
      >
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-20" />
        <Skeleton className="ml-auto h-9 w-28 rounded-full" />
      </div>
      <div
        aria-hidden="true"
        className="space-y-4 pt-6 lg:mt-8 lg:grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-x-14 lg:space-y-0 lg:pt-0"
      >
        <div className="space-y-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-4/5" />
          <Skeleton className="h-24 w-full rounded-[var(--radius-xl)]" />
        </div>
        <div className="space-y-2.5">
          <Skeleton className="h-36 w-full rounded-[var(--radius-xl)]" />
          <Skeleton className="h-16 w-full rounded-[var(--radius-xl)]" />
          <Skeleton className="h-16 w-full rounded-[var(--radius-xl)]" />
        </div>
      </div>
    </article>
  );
}
