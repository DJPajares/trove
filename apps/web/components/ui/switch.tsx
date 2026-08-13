'use client';

import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import * as React from 'react';

import { cn } from '@/lib/utils';

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-input p-0.5 transition-colors duration-[var(--motion-fast)] outline-none data-checked:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-50 focus-visible:ring-3 focus-visible:ring-ring/50',
        className,
      )}
      data-slot="switch"
      {...props}
    >
      <SwitchPrimitive.Thumb
        className="pointer-events-none block size-5 translate-x-0 rounded-full bg-background shadow-[var(--shadow-control)] transition-transform duration-[var(--motion-fast)] data-checked:translate-x-5"
        data-slot="switch-thumb"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
