'use client';

import { Radio as RadioPrimitive } from '@base-ui/react/radio';
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group';

import { cn } from '@/lib/utils';

function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props) {
  return (
    <RadioGroupPrimitive
      className={cn('grid gap-2', className)}
      data-slot="radio-group"
      {...props}
    />
  );
}

function RadioGroupItem({ className, ...props }: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      className={cn(
        'grid size-5 shrink-0 cursor-pointer place-items-center rounded-full border border-border-strong bg-background outline-none transition-colors duration-[var(--motion-fast)] data-checked:border-primary data-disabled:cursor-not-allowed data-disabled:opacity-50 focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none',
        className,
      )}
      data-slot="radio-group-item"
      {...props}
    >
      <RadioPrimitive.Indicator
        className="size-2.5 rounded-full bg-primary"
        data-slot="radio-group-indicator"
      />
    </RadioPrimitive.Root>
  );
}

export { RadioGroup, RadioGroupItem };
