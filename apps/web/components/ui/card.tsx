import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const cardVariants = cva(
  'group/card flex flex-col gap-(--card-spacing) overflow-hidden py-(--card-spacing) text-sm text-card-foreground [--card-spacing:--spacing(5)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(4)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-[inherit] *:[img:last-child]:rounded-b-[inherit]',
  {
    variants: {
      variant: {
        media:
          'rounded-[var(--radius-2xl)] border border-border-subtle bg-card shadow-[var(--shadow-surface)]',
        outlined:
          'rounded-[var(--radius-xl)] border border-border-strong bg-transparent shadow-none',
        plain: 'rounded-none border-0 bg-transparent shadow-none',
        surface:
          'rounded-[var(--radius-xl)] border border-border-subtle bg-card shadow-[var(--shadow-surface)]',
      },
    },
    defaultVariants: { variant: 'surface' },
  },
);

function Card({
  className,
  size = 'default',
  variant = 'surface',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof cardVariants> & { size?: 'default' | 'sm' }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      data-variant={variant}
      className={cn(cardVariants({ variant }), className)}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        'group/card-header @container/card-header grid auto-rows-min items-start gap-1.5 rounded-t-[var(--radius-xl)] px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)',
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({
  as: Component = 'div',
  className,
  ...props
}: React.ComponentProps<'div'> & { as?: 'div' | 'h2' | 'h3' }) {
  return (
    <Component
      data-slot="card-title"
      className={cn(
        'text-base leading-snug font-semibold group-data-[size=sm]/card:text-sm',
        className,
      )}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="card-content" className={cn('px-(--card-spacing)', className)} {...props} />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        'flex items-center rounded-b-[var(--radius-xl)] border-t bg-muted/50 p-(--card-spacing)',
        className,
      )}
      {...props}
    />
  );
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent };
