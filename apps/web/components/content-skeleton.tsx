import { cva } from 'class-variance-authority';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const skeletonVariants = cva('w-full', {
  variants: {
    shape: {
      list: 'space-y-3',
      media: 'grid gap-5 sm:grid-cols-[minmax(0,1.2fr)_minmax(16rem,0.8fr)]',
      text: 'max-w-2xl space-y-4',
      timeline: 'max-w-3xl space-y-0',
    },
  },
  defaultVariants: { shape: 'text' },
});

export type LoadingShape = 'list' | 'media' | 'text' | 'timeline';

export function ContentSkeleton({
  className,
  shape = 'text',
}: Readonly<{ className?: string; shape?: LoadingShape }>) {
  if (shape === 'list') {
    return (
      <div aria-hidden="true" className={cn(skeletonVariants({ shape }), className)}>
        {[0, 1, 2].map((row) => (
          <div className="flex items-center gap-4 border-b border-border-subtle py-3" key={row}>
            <Skeleton className="size-14 shrink-0 rounded-[var(--radius-md)]" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (shape === 'media') {
    return (
      <div aria-hidden="true" className={cn(skeletonVariants({ shape }), className)}>
        <Skeleton className="aspect-[4/3] w-full rounded-[var(--radius-xl)]" />
        <div className="self-center space-y-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full max-w-sm" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-11 w-36 rounded-[var(--radius-md)]" />
        </div>
      </div>
    );
  }

  if (shape === 'timeline') {
    return (
      <div aria-hidden="true" className={cn(skeletonVariants({ shape }), className)}>
        {[0, 1, 2].map((row) => (
          <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3" key={row}>
            <div className="flex flex-col items-center">
              <Skeleton className="mt-4 size-3 rounded-full" />
              {row < 2 ? <Skeleton className="min-h-16 w-px flex-1 rounded-none" /> : null}
            </div>
            <div className="space-y-2 border-b border-border-subtle py-4">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div aria-hidden="true" className={cn(skeletonVariants({ shape }), className)}>
      <Skeleton className="size-11 rounded-[var(--radius-lg)]" />
      <div className="space-y-3">
        <Skeleton className="h-9 w-2/3 max-w-md" />
        <Skeleton className="h-4 w-full max-w-xl" />
        <Skeleton className="h-4 w-4/5 max-w-lg" />
      </div>
    </div>
  );
}
