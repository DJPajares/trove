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
    /** Keeps the title and action opposite each other whenever the available width allows. */
    headerLayout?: 'inline' | 'stacked';
    /** A short kicker above the title, in the same brand-uppercase treatment `PageHeader` uses. */
    eyebrow?: string;
    headingId?: string;
    headingLevel?: 2 | 3;
    /**
     * A small brand-toned glyph beside the title, for the settings-card family
     * of sections that need one and nothing else in the shared vocabulary.
     * Every travel-content section leaves this unset.
     */
    icon?: ReactNode;
    title: string;
  };

export function EditorialSection({
  actions,
  children,
  className,
  density,
  description,
  eyebrow,
  headerLayout = 'stacked',
  headingId,
  headingLevel = 2,
  icon,
  title,
  treatment,
  ...props
}: Readonly<EditorialSectionProps>) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const generatedHeadingId = useId();
  const resolvedHeadingId = headingId ?? generatedHeadingId;

  const titleColumn = (
    <div
      className={cn(
        'min-w-0',
        headerLayout === 'inline' ? 'flex-1' : 'max-w-[var(--layout-reading)]',
      )}
    >
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
  );

  return (
    <section
      aria-labelledby={resolvedHeadingId}
      className={cn(sectionVariants({ density, treatment }), className)}
      data-density={density ?? 'default'}
      data-slot="editorial-section"
      data-treatment={treatment ?? 'plain'}
      {...props}
    >
      <div
        className={cn(
          headerLayout === 'inline'
            ? 'flex flex-wrap items-center justify-between gap-x-4 gap-y-3'
            : 'flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between',
        )}
      >
        {icon ? (
          <div
            className={cn('flex min-w-0 items-start gap-3', headerLayout === 'inline' && 'flex-1')}
          >
            <span aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand [&_svg]:size-5">
              {icon}
            </span>
            {titleColumn}
          </div>
        ) : (
          titleColumn
        )}
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {children}
    </section>
  );
}
