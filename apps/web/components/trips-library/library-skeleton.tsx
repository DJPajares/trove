import { HOME_SHEET_FRAME } from '@/components/home/home-front-door';
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
      <div aria-hidden="true" className={HOME_SHEET_FRAME}>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-40 rounded-full" />
          <Skeleton className="h-10 w-32 rounded-full" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-3 w-24" />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <Skeleton
                className="aspect-[16/10] rounded-[var(--radius-2xl)] md:aspect-[4/5]"
                key={index}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
