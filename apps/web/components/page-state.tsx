import { cva } from 'class-variance-authority';
import { useId, type ReactNode } from 'react';

import { ContentSkeleton, type LoadingShape } from '@/components/content-skeleton';
import { Empty, EmptyContent, EmptyHeader, EmptyMedia } from '@/components/ui/empty';
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
  loadingShape?: LoadingShape;
  scope?: 'inline' | 'page' | 'section';
  title: string;
};

const scopeVariants = cva('', {
  variants: {
    scope: {
      inline: 'py-2',
      page: 'py-10',
      section: 'py-6',
    },
  },
  defaultVariants: { scope: 'section' },
});

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
  loadingShape = 'text',
  scope = 'section',
  title,
}: Readonly<PageStateProps>) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  const generatedHeadingId = useId();
  const resolvedHeadingId = headingId ?? generatedHeadingId;

  if (kind === 'loading') {
    return (
      <div
        aria-busy="true"
        aria-live="polite"
        className={cn('w-full', scopeVariants({ scope }), className)}
        data-slot="page-state"
        role="status"
      >
        <span className="sr-only">{title}</span>
        <ContentSkeleton shape={loadingShape} />
      </div>
    );
  }

  return (
    <Empty
      aria-labelledby={resolvedHeadingId}
      className={cn(
        'items-start border-0 p-0 text-left text-pretty',
        scopeVariants({ scope }),
        className,
      )}
      data-state={kind}
      role={kind === 'error' ? 'alert' : undefined}
    >
      <EmptyHeader className="max-w-2xl items-start gap-0 text-left">
        {icon ? (
          <EmptyMedia className={stateMediaVariants({ kind })} variant="default">
            {icon}
          </EmptyMedia>
        ) : null}
        {eyebrow ? (
          <p className="mb-2 text-xs font-semibold tracking-[0.08em] text-brand uppercase">
            {eyebrow}
          </p>
        ) : null}
        <Heading
          className="text-[length:var(--text-page-title)] leading-[1.08] font-semibold tracking-[-0.035em] text-pretty text-foreground"
          id={resolvedHeadingId}
        >
          {title}
        </Heading>
        {description ? (
          <p className="mt-3 max-w-[62ch] text-base leading-7 text-pretty text-muted-foreground">
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
