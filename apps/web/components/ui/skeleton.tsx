import { cn } from '@/lib/utils';

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn('animate-pulse rounded-[var(--radius-md)] bg-muted', className)}
      {...props}
    />
  );
}

export { Skeleton };
