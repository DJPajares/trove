'use client';

import type { ReactNode } from 'react';

import { useLocale } from 'next-intl';

import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

export type Tone = { fill: string; ink: string; track: string; trackInk: string };

/**
 * The two grounds a trip bar is ever drawn on: an ordinary card, and the dark
 * photographic hero Home and the Trips library lead with.
 */
export const TONES: Record<'default' | 'inverse', Tone> = {
  default: {
    fill: 'bg-primary',
    ink: 'text-muted-foreground',
    track: 'bg-primary/25',
    trackInk: 'color-mix(in oklab, var(--color-primary) 50%, transparent)',
  },
  inverse: {
    fill: 'bg-primary-on-media',
    ink: 'text-white/85',
    track: 'bg-primary-on-media/25',
    trackInk: 'color-mix(in oklab, var(--color-primary-on-media) 55%, transparent)',
  },
};

/**
 * The label row and the accessible value every trip bar shares, whatever it is
 * measuring. Children are the bar's own body, which is a plain track for the
 * phase bars and a two-ended leg for Trip Mode's.
 */
export function ProgressShell({
  announcement,
  children,
  className,
  label,
  tone,
  value,
  valueText,
}: Readonly<{
  announcement: string;
  children: ReactNode;
  className?: string;
  label: string;
  tone: Tone;
  value: number;
  valueText: string;
}>) {
  const locale = useLocale();

  return (
    <Progress.Root
      aria-valuetext={announcement}
      className={cn('w-full min-w-0', className)}
      locale={locale}
      value={value}
    >
      <div className={cn('mb-1.5 flex items-baseline justify-between gap-3 text-xs', tone.ink)}>
        <Progress.Label className="font-medium">{label}</Progress.Label>
        <Progress.Value className="shrink-0 tabular-nums">{() => valueText}</Progress.Value>
      </div>
      {children}
    </Progress.Root>
  );
}
