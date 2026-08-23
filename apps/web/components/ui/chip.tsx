import type * as React from 'react';
import { Toggle as TogglePrimitive } from '@base-ui/react/toggle';
import { ToggleGroup as ToggleGroupPrimitive } from '@base-ui/react/toggle-group';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

function ChipGroup<Value extends string>({
  className,
  ...props
}: ToggleGroupPrimitive.Props<Value>) {
  return (
    <ToggleGroupPrimitive
      data-slot="chip-group"
      className={cn('flex flex-wrap gap-1.5', className)}
      {...props}
    />
  );
}

const chipVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium whitespace-nowrap outline-none transition-colors duration-[var(--motion-standard)] focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 data-[pressed]:border-transparent data-[pressed]:bg-brand/15 data-[pressed]:text-brand',
  {
    variants: {
      variant: {
        default: 'border-border text-muted-foreground hover:bg-surface-hover hover:text-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

type ChipProps<Value extends string> = TogglePrimitive.Props<Value> &
  VariantProps<typeof chipVariants> & {
    /** A leading icon, e.g. a marker for a highlighted option. */
    icon?: React.ReactNode;
    /** A trailing count, rendered de-emphasized and with tabular figures. */
    count?: number;
  };

function Chip<Value extends string>({
  className,
  variant,
  icon,
  count,
  children,
  ...props
}: ChipProps<Value>) {
  return (
    <TogglePrimitive
      data-slot="chip"
      className={cn(chipVariants({ variant, className }))}
      {...props}
    >
      {icon ? <span className="size-3 shrink-0 [&_svg]:size-3">{icon}</span> : null}
      <span className="max-w-40 truncate">{children}</span>
      {count !== undefined ? <span className="tabular-nums opacity-60">{count}</span> : null}
    </TogglePrimitive>
  );
}

export { ChipGroup, Chip };
