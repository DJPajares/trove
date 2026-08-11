import { cva } from 'class-variance-authority';
import type { ReactNode } from 'react';

import { Empty, EmptyContent, EmptyHeader, EmptyMedia } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

type PageStateKind = 'empty' | 'error' | 'loading' | 'offline';

type PageStateProps = {
  actions?: ReactNode;
  className?: string;
  description?: string;
  detail?: ReactNode;
  eyebrow?: string;
  headingLevel?: 1 | 2;
  headingId?: string;
  icon?: ReactNode;
  kind?: PageStateKind;
  title: string;
};

const stateMediaVariants = cva(
  'mb-3 flex size-12 items-center justify-center rounded-[var(--radius-lg)] [&_svg]:size-6',
  {
    variants: {
      kind: {
        empty: 'bg-brand/10 text-brand',
        error: 'bg-destructive/10 text-destructive',
        loading: 'bg-muted text-muted-foreground',
        offline: 'bg-status-warning/15 text-foreground',
      },
    },
    defaultVariants: { kind: 'empty' },
  },
);

export function PageState({
  actions,
  className,
  description,
  detail,
  eyebrow,
  headingLevel = 1,
  headingId,
  icon,
  kind = 'empty',
  title,
}: Readonly<PageStateProps>) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';

  if (kind === 'loading') {
    return (
      <div
        aria-busy="true"
        aria-live="polite"
        className={cn('w-full max-w-2xl space-y-5', className)}
        data-slot="page-state"
        role="status"
      >
        <span className="sr-only">{title}</span>
        <Skeleton className="size-12" />
        <div className="space-y-3">
          <Skeleton className="h-9 w-2/3 max-w-md" />
          <Skeleton className="h-5 w-full max-w-xl" />
          <Skeleton className="h-5 w-4/5 max-w-lg" />
        </div>
      </div>
    );
  }

  return (
    <Empty
      aria-labelledby={headingId}
      className={cn('items-start border-0 p-0 text-left text-pretty', className)}
      data-state={kind}
      role={kind === 'error' ? 'alert' : undefined}
    >
      <EmptyHeader className="max-w-2xl items-start gap-0 text-left">
        {icon ? (
          <EmptyMedia className={stateMediaVariants({ kind })} variant="default">
            {icon}
          </EmptyMedia>
        ) : null}
        {eyebrow ? <p className="mb-3 text-sm font-medium text-brand">{eyebrow}</p> : null}
        <Heading
          className="text-3xl leading-tight font-semibold tracking-tight text-pretty text-foreground sm:text-4xl"
          id={headingId}
        >
          {title}
        </Heading>
        {description ? (
          <p className="mt-4 max-w-[65ch] text-base leading-7 text-pretty text-muted-foreground">
            {description}
          </p>
        ) : null}
      </EmptyHeader>
      {detail || actions ? (
        <EmptyContent className="mt-3 max-w-xl items-start gap-4 text-left">
          {detail ? (
            <div className="w-full border-t border-border pt-4 text-sm leading-6 text-text-subtle">
              {detail}
            </div>
          ) : null}
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
