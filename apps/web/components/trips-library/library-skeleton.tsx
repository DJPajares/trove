import { HOME_SHEET } from '@/components/home/home-front-door';
import { LIBRARY_COVER_FRAME } from '@/components/trips-library/library-cover';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * The library while its trips are on the way: the cover at its real size and
 * place, then the sheet with the first month of tickets at theirs, so nothing
 * moves when the answer arrives (PRD 4.4). Shared by the route's loading file
 * and the library's own pending state, so the two can never disagree.
 */
export function LibrarySkeleton({ label }: Readonly<{ label: string }>) {
  return (
    <div aria-busy="true" aria-live="polite" role="status">
      <span className="sr-only">{label}</span>
      <Skeleton aria-hidden="true" className={cn('rounded-none', LIBRARY_COVER_FRAME)} />
      <div aria-hidden="true" className={HOME_SHEET}>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-40 rounded-full" />
          <Skeleton className="h-10 w-32 rounded-full" />
        </div>
        <div className="space-y-6">
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
    </div>
  );
}
