import { cva, type VariantProps } from 'class-variance-authority';
import { useId, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

const sectionVariants = cva('min-w-0', {
  variants: {
    density: {
      compact: 'space-y-3',
      default: 'space-y-5',
    },
    treatment: {
      plain: '',
      ruled: 'border-t border-border-subtle pt-5 sm:pt-6',
      tinted: 'rounded-[var(--radius-xl)] border border-border-subtle bg-surface-tint p-5 sm:p-6',
    },
  },
  defaultVariants: { density: 'default', treatment: 'plain' },
});

type EditorialSectionProps = React.ComponentProps<'section'> &
  VariantProps<typeof sectionVariants> & {
    actions?: ReactNode;
    description?: string;
    /** A short kicker above the title, in the same brand-uppercase treatment `PageHeader` uses. */
    eyebrow?: string;
    headingId?: string;
    headingLevel?: 2 | 3;
    title: string;
  };

export function EditorialSection({
  actions,
  children,
  className,
  density,
  description,
  eyebrow,
  headingId,
  headingLevel = 2,
  title,
  treatment,
  ...props
}: Readonly<EditorialSectionProps>) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const generatedHeadingId = useId();
  const resolvedHeadingId = headingId ?? generatedHeadingId;

  return (
    <section
      aria-labelledby={resolvedHeadingId}
      className={cn(sectionVariants({ density, treatment }), className)}
      data-density={density ?? 'default'}
      data-slot="editorial-section"
      data-treatment={treatment ?? 'plain'}
      {...props}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-[var(--layout-reading)]">
          {eyebrow ? (
            <p className="mb-2 text-[length:var(--text-metadata)] font-semibold tracking-[0.08em] text-brand uppercase">
              {eyebrow}
            </p>
          ) : null}
          <Heading
            className="text-[length:var(--text-section-title)] leading-[1.18] font-semibold tracking-[-0.022em] text-pretty"
            id={resolvedHeadingId}
          >
            {title}
          </Heading>
          {description ? (
            <p className="mt-2 text-sm leading-[1.55] text-pretty text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {children}
    </section>
  );
}
