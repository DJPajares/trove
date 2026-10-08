'use client';

import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The day's one map, and the only place it ever lives.
 *
 * From `lg` it stands beside the day and stays in view while the day scrolls,
 * so a stop and its pin are always on screen together (PRD 18.3). On a phone
 * it is not drawn until asked for - the day's sketch stands in for it - and,
 * once asked for, it takes the day's place below the ribbon, so changing day
 * on the map is a tap along the ribbon. Going back hides it rather than
 * removing it.
 *
 * It is never moved: no portal, no second container, no key that changes.
 * Google bills a map each time one is built, and a map moved to another part
 * of the page is a map built again.
 */
export function PlannerMapPane({
  children,
  label,
  mounted,
  onClose,
  open,
}: Readonly<{
  /** The map itself, once it has been built. */
  children: ReactNode;
  label: string;
  mounted: boolean;
  onClose: () => void;
  /** A phone is showing the map in place of the day. */
  open: boolean;
}>) {
  const t = useTranslations('itinerary.planner.map');
  const paneRef = useRef<HTMLElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);

  // Opening brings the map's top up under the ribbon, where it fills the
  // screen, and puts the way back where focus can find it.
  useEffect(() => {
    if (!open) return;
    paneRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
    backRef.current?.focus({ preventScroll: true });
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose, open]);

  return (
    <aside
      aria-label={label}
      className={cn(
        'min-w-0 scroll-mt-[calc(var(--planner-sticky)+0.5rem)] lg:sticky lg:top-[calc(var(--planner-sticky)+1rem)] lg:block lg:self-start',
        open ? 'block' : 'hidden',
      )}
      data-slot="planner-map-pane"
      id="itinerary-map-panel"
      ref={paneRef}
    >
      <div className="relative h-[calc(100dvh-var(--planner-sticky)-var(--bottom-bar-height)-var(--safe-bottom)-1.25rem)] min-h-[22rem] overflow-hidden rounded-[var(--radius-xl)] border border-border-subtle bg-muted/40 lg:h-[calc(100dvh-var(--planner-sticky)-2rem)] lg:min-h-[28rem]">
        {mounted ? children : null}
        {open ? (
          <Button
            className="absolute top-3 left-3 z-[2] shadow-[var(--shadow-overlay)] lg:hidden"
            onClick={onClose}
            ref={backRef}
            size="sm"
            type="button"
            variant="outline"
          >
            <ArrowLeft aria-hidden="true" data-icon="inline-start" />
            {t('backToDay')}
          </Button>
        ) : null}
      </div>
    </aside>
  );
}
