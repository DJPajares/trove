import { HOME_SHEET_FRAME } from '@/components/home/home-front-door';
import { FINDS_COVER_FRAME } from '@/components/saved/finds-cover';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * A collection's page before its places arrive: the cover at its real size and
 * place, then the sheet with a grid of cards where they will land, so nothing
 * jumps. The sheet does not rise: only the real one does.
 */
export function SavedCollectionSkeleton({ label }: Readonly<{ label: string }>) {
  return (
    <section aria-busy="true" aria-live="polite" className="mx-auto w-full max-w-6xl" role="status">
      <span className="sr-only">{label}</span>
      <Skeleton aria-hidden="true" className={cn('rounded-none', FINDS_COVER_FRAME)} />
      <div aria-hidden="true" className={HOME_SHEET_FRAME}>
        <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div className="space-y-2" key={index}>
              <Skeleton className="aspect-[4/3] w-full rounded-[var(--radius-xl)]" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
