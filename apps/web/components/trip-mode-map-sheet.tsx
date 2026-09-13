'use client';

import { ChevronUp } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';

import { motionDuration, motionEase } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * What the day looks like, over the map rather than under it.
 *
 * The map view used to put its header, an explanatory paragraph, a location
 * button and a permission notice above the map, which on a 390x844 phone left
 * the map itself entirely off-screen - a map view whose map you had to scroll
 * to find. The map now fills the screen and this rides over it, which is what
 * every companion app a traveller already owns does, and for the same reason:
 * the map is the thing being consulted.
 *
 * Two detents, not a free drag. The handle is a real button that toggles them,
 * so the sheet works from the keyboard, works for a screen reader, and cannot
 * be left stranded halfway - and a drag is offered on top for thumbs that
 * expect one. Collapsed still shows the route summary, because "how far and how
 * long" is the question the map is usually opened to answer.
 *
 * At `lg:` there is room for both at once, so it stops being a sheet and
 * becomes the rail the desktop layout always had.
 */
export function TripModeMapSheet({ children }: Readonly<{ children: ReactNode }>) {
  const t = useTranslations('tripMode.views.map');
  const reducedMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.section
      animate={{ height: expanded ? '92%' : '12.5rem' }}
      aria-label={t('dayContextLabel')}
      className="absolute inset-x-0 bottom-0 z-[2] flex flex-col overflow-hidden rounded-t-[var(--trip-sheet-radius)] border-t border-border-subtle bg-background shadow-[var(--shadow-overlay)] lg:static lg:h-auto lg:rounded-none lg:border-0 lg:bg-transparent lg:shadow-none"
      // The rail owns its own height; only the sheet is animated.
      drag={reducedMotion ? false : 'y'}
      dragConstraints={{ bottom: 0, top: 0 }}
      dragElastic={0.12}
      initial={false}
      onDragEnd={(_event, info) => {
        if (info.offset.y < -40) setExpanded(true);
        if (info.offset.y > 40) setExpanded(false);
      }}
      transition={
        reducedMotion ? { duration: 0 } : { duration: motionDuration.standard, ease: motionEase }
      }
    >
      <button
        aria-expanded={expanded}
        className="group flex shrink-0 flex-col items-center gap-1.5 px-4 pt-2.5 pb-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/40 lg:hidden"
        onClick={() => setExpanded((open) => !open)}
        type="button"
      >
        <span
          aria-hidden="true"
          className="h-1 w-9 rounded-full bg-border-strong transition-colors duration-[var(--motion-standard)] ease-[var(--ease-standard)] group-hover:bg-text-subtle motion-reduce:transition-none"
        />
        <span className="inline-flex items-center gap-1 text-[length:var(--text-metadata)] font-medium text-muted-foreground">
          <ChevronUp
            aria-hidden="true"
            className={cn(
              'size-3.5 transition-transform duration-[var(--motion-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none',
              expanded && 'rotate-180',
            )}
          />
          {t(expanded ? 'sheetCollapse' : 'sheetExpand')}
        </span>
      </button>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-[var(--gutter-inline-start)] pb-4 lg:overflow-visible lg:px-0 lg:pb-0">
        {children}
      </div>
    </motion.section>
  );
}
