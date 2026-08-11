import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

type PageHeaderProps = {
  actions?: ReactNode;
  className?: string;
  description?: string;
  eyebrow?: string;
  headingId?: string;
  title: string;
};

export function PageHeader({
  actions,
  className,
  description,
  eyebrow,
  headingId,
  title,
}: Readonly<PageHeaderProps>) {
  return (
    <header
      className={cn('flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between', className)}
      data-slot="page-header"
    >
      <div className="max-w-3xl">
        {eyebrow ? (
          <p className="mb-2 text-xs font-semibold tracking-[0.08em] text-brand uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1
          className="text-[clamp(1.875rem,5vw,2.5rem)] leading-[1.12] font-semibold tracking-[-0.025em] text-pretty text-foreground"
          id={headingId}
        >
          {title}
        </h1>
        {description ? (
          <p className="mt-3 max-w-[62ch] text-base leading-7 text-pretty text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
