import { Skeleton } from '@/components/ui/skeleton';

/**
 * The library while its trips are on the way: the lead trip at its real
 * height, then the first month of tickets at theirs, so nothing below moves
 * when the answer arrives (PRD 4.4). Shared by the route's loading file and
 * the library's own pending state, so the two can never disagree.
 */
export function LibrarySkeleton({ label }: Readonly<{ label: string }>) {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-10 sm:space-y-12" role="status">
      <span className="sr-only">{label}</span>
      <Skeleton className="min-h-[34rem] w-full rounded-[var(--radius-2xl)] sm:min-h-[32rem] lg:min-h-[34rem]" />
      <div aria-hidden="true" className="space-y-6">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-3 w-24" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <div
              className="overflow-hidden rounded-[var(--radius-xl)] border border-border-subtle bg-card"
              key={index}
            >
              <Skeleton className="aspect-[2/1] rounded-none md:aspect-[4/3]" />
              <div className="flex h-12 items-center justify-between px-4">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
