'use client';

import { LayoutList, List } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { ItineraryView } from '@/hooks/use-itinerary-view';
import { cn } from '@/lib/utils';

const OPTIONS = [
  { Icon: List, view: 'simple' },
  { Icon: LayoutList, view: 'detailed' },
] as const satisfies readonly { Icon: typeof List; view: ItineraryView }[];

/**
 * Simple or Detailed, as two buttons in one track: icons on a phone, where the
 * bar is short, and words beside them from `md`.
 */
export function ItineraryViewToggle({
  className,
  onChange,
  view,
}: Readonly<{
  className?: string;
  onChange: (view: ItineraryView) => void;
  view: ItineraryView;
}>) {
  const t = useTranslations('itinerary.planner.view');

  return (
    <div
      aria-label={t('label')}
      className={cn('inline-flex shrink-0 gap-0.5 rounded-full bg-muted p-[3px]', className)}
      data-slot="itinerary-view-toggle"
      role="group"
    >
      {OPTIONS.map(({ Icon, view: option }) => (
        <button
          aria-label={t(option)}
          aria-pressed={view === option}
          className={cn(
            'inline-flex h-8 min-w-9 items-center justify-center gap-1.5 rounded-full px-2.5 text-[0.8125rem] font-semibold outline-none transition-colors duration-[var(--motion-standard)] focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none md:px-3',
            view === option
              ? 'bg-card text-foreground shadow-[var(--shadow-control)]'
              : 'text-muted-foreground hover:text-foreground',
          )}
          key={option}
          onClick={() => onChange(option)}
          type="button"
        >
          <Icon aria-hidden="true" className="size-4" />
          <span className="max-md:hidden">{t(option)}</span>
        </button>
      ))}
    </div>
  );
}
