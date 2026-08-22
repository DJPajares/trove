'use client';

import * as React from 'react';
import { Select as SelectPrimitive } from '@base-ui/react/select';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

const Select = SelectPrimitive.Root;

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      className={cn('flex min-w-0 flex-1 items-center text-left', className)}
      data-slot="select-value"
      {...props}
    />
  );
}

function SelectTrigger({
  children,
  className,
  size = 'default',
  ...props
}: SelectPrimitive.Trigger.Props & { size?: 'sm' | 'default' }) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        'flex w-fit items-center justify-between gap-3 rounded-[var(--radius-md)] border border-input bg-background px-3 text-base text-foreground transition-[color,background-color,border-color,box-shadow,transform] duration-[var(--motion-standard)] ease-[var(--ease-standard)] outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 active:translate-y-px disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-11 data-[size=sm]:h-9 data-[size=sm]:px-2.5 data-[size=sm]:text-sm dark:bg-input/20 dark:hover:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0',
        className,
      )}
      data-size={size}
      data-slot="select-trigger"
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={<ChevronDownIcon aria-hidden="true" className="size-4 text-muted-foreground" />}
      />
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  align = 'center',
  alignItemWithTrigger = true,
  alignOffset = 0,
  children,
  className,
  side = 'bottom',
  sideOffset = 6,
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<
    SelectPrimitive.Positioner.Props,
    'align' | 'alignItemWithTrigger' | 'alignOffset' | 'side' | 'sideOffset'
  >) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        align={align}
        alignItemWithTrigger={alignItemWithTrigger}
        alignOffset={alignOffset}
        className="z-(--layer-overlay)"
        side={side}
        sideOffset={sideOffset}
      >
        <SelectPrimitive.Popup
          className={cn(
            'w-(--anchor-width) min-w-40 max-h-[min(var(--available-height),20rem)] origin-(--transform-origin) overflow-y-auto rounded-[var(--radius-xl)] border border-border-subtle bg-popover p-1.5 text-popover-foreground shadow-[var(--shadow-overlay)] outline-none transition-[opacity,transform] duration-[var(--motion-standard)] ease-[var(--ease-standard)] data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1 data-closed:fade-out-0 data-closed:zoom-out-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95',
            className,
          )}
          data-slot="select-content"
          {...props}
        >
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({ children, className, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      className={cn(
        'relative flex min-h-10 w-full cursor-default items-center gap-3 rounded-[var(--radius-md)] py-2 pr-9 pl-3 text-sm outline-none select-none focus:bg-surface-hover focus:text-foreground data-disabled:pointer-events-none data-disabled:opacity-50',
        className,
      )}
      data-slot="select-item"
      {...props}
    >
      <SelectPrimitive.ItemText className="flex min-w-0 flex-1 items-center whitespace-nowrap">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-3 flex size-4 items-center justify-center" />
        }
      >
        <CheckIcon aria-hidden="true" className="size-4 text-primary" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
