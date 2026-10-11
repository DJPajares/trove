'use client';

import type { ComponentProps } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The one card Trip Mode's supporting surfaces share - weather, Plan Score,
 * tasks - so nothing beside the place and the next move looks like it came from
 * another screen.
 */
export const tripModeCardClass =
  'rounded-[var(--radius-2xl)] border border-border-subtle bg-card shadow-[var(--shadow-control)]';

/**
 * A secondary action in Trip Mode: a soft pill rather than an outlined box, so
 * it reads as something to do on the way past, never as the screen's answer.
 */
export function TripModeActionButton({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      className={cn(
        'h-11 gap-2 rounded-full border-transparent bg-muted px-4 text-sm font-semibold text-foreground shadow-none hover:bg-surface-hover hover:text-foreground has-data-[icon=inline-start]:pl-3.5',
        className,
      )}
      variant="ghost"
      {...props}
    />
  );
}
