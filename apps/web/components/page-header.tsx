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
      className={cn('flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between', className)}
      data-slot="page-header"
    >
      <div className="max-w-3xl">
        {eyebrow ? <p className="mb-3 text-sm font-medium text-brand">{eyebrow}</p> : null}
        <h1
          className="text-3xl leading-tight font-semibold tracking-tight text-pretty text-foreground sm:text-4xl"
          id={headingId}
        >
          {title}
        </h1>
        {description ? (
          <p className="mt-4 max-w-[65ch] text-base leading-7 text-pretty text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
