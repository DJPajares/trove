import { cva } from 'class-variance-authority';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type HeaderDensity = 'compact' | 'default' | 'immersive';

type PageHeaderProps = {
  actions?: ReactNode;
  className?: string;
  density?: HeaderDensity;
  description?: string;
  eyebrow?: string;
  headingId?: string;
  media?: ReactNode;
  meta?: ReactNode;
  title: string;
};

const headerVariants = cva('grid items-end', {
  variants: {
    density: {
      compact: 'gap-4 sm:grid-cols-[minmax(0,1fr)_auto]',
      default: 'gap-5 sm:grid-cols-[minmax(0,1fr)_auto]',
      immersive: 'gap-6 md:grid-cols-[minmax(0,1fr)_minmax(16rem,0.6fr)] md:gap-10',
    },
  },
  defaultVariants: { density: 'default' },
});

const titleVariants = cva('font-semibold tracking-[-0.035em] text-pretty text-foreground', {
  variants: {
    density: {
      compact: 'text-[length:var(--text-page-title)] leading-[1.08]',
      default: 'text-[length:var(--text-page-title)] leading-[1.08]',
      immersive:
        'text-[length:var(--text-page-title)] leading-[1.08] md:text-[length:var(--text-immersive-title)] md:leading-[1.02]',
    },
  },
  defaultVariants: { density: 'default' },
});

export function PageHeader({
  actions,
  className,
  density = 'default',
  description,
  eyebrow,
  headingId,
  media,
  meta,
  title,
}: Readonly<PageHeaderProps>) {
  return (
    <header
      className={cn(headerVariants({ density }), className)}
      data-density={density}
      data-slot="page-header"
    >
      <div className="max-w-[var(--layout-reading)]">
        {eyebrow ? (
          <p className="mb-2 text-[length:var(--text-metadata)] font-semibold tracking-[0.08em] text-brand uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1 className={titleVariants({ density })} id={headingId}>
          {title}
        </h1>
        {meta ? (
          <div className="mt-2 text-[length:var(--text-metadata)] leading-5 font-medium text-text-subtle tabular-nums">
            {meta}
          </div>
        ) : null}
        {description ? (
          <p className="mt-3 max-w-[var(--layout-reading)] text-base leading-[1.65] text-pretty text-muted-foreground">
            {description}
          </p>
        ) : null}
        {density === 'compact' && actions && !media ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 sm:hidden">{actions}</div>
        ) : null}
      </div>
      {media ? (
        <div className="min-w-0">
          {media}
          {actions ? <div className="mt-4 flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {!media && actions ? (
        <div
          className={cn(
            'flex shrink-0 flex-wrap items-center gap-2',
            density === 'compact' && 'hidden sm:flex',
          )}
        >
          {actions}
        </div>
      ) : null}
    </header>
  );
}
