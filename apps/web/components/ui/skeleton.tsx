import { cn } from '@/lib/utils';

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        'animate-pulse rounded-[var(--radius-md)] bg-[linear-gradient(100deg,var(--muted)_20%,var(--surface-hover)_38%,var(--muted)_55%)] bg-[length:220%_100%] motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
