'use client';

import { ChevronDown } from 'lucide-react';
import { motion, MotionConfigContext, useMotionValue, useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useContext, useLayoutEffect, useRef, useState } from 'react';

import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@/components/ui/collapsible';
import { motionDuration, motionEase } from '@/lib/motion';
import { cn } from '@/lib/utils';

type PlaceOpeningHoursProps = {
  hours: string[];
  highlightedIndex: number | null;
  plannedVisit: string | null;
};

type Anchor = { x: number; y: number; width: number };
type Geometry = {
  compact: Anchor;
  compactHeight: number;
  expanded: Anchor;
  expandedHeight: number;
  headerHeight: number;
  iconHeight: number;
};

/**
 * The visible summary never unmounts: only its measured anchor changes.
 * Invisible slots reserve text geometry, while the trigger and list provide
 * the appropriate accessible text. The whole card owns its height animation;
 * the weekly panel stays measurable without competing height transitions.
 */
export function PlaceOpeningHours({
  hours,
  highlightedIndex,
  plannedVisit,
}: Readonly<PlaceOpeningHoursProps>) {
  const t = useTranslations('placeDetail');
  const prefersReducedMotion = useReducedMotion();
  const motionPreference = useContext(MotionConfigContext).reducedMotion;
  const reducedMotion =
    motionPreference === 'always' ||
    (motionPreference !== 'never' && Boolean(prefersReducedMotion));
  const [open, setOpen] = useState(false);
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const compactRef = useRef<HTMLDivElement>(null);
  const compactTextRef = useRef<HTMLSpanElement>(null);
  const headerRef = useRef<HTMLSpanElement>(null);
  const weekRef = useRef<HTMLUListElement>(null);
  const selectedRef = useRef<HTMLSpanElement>(null);
  const iconRef = useRef<HTMLSpanElement>(null);
  const measuredRef = useRef(false);
  const cardHeight = useMotionValue<number | string>('auto');
  const textX = useMotionValue(16);
  const textY = useMotionValue(30);
  const textWidth = useMotionValue<number | string>('calc(100% - 60px)');
  const selectedLine = highlightedIndex === null ? null : (hours[highlightedIndex] ?? null);
  const summary = selectedLine ?? t('showWeek');
  const transition = { duration: reducedMotion ? 0 : motionDuration.standard, ease: motionEase };

  useLayoutEffect(() => {
    const root = rootRef.current;
    const compact = compactRef.current;
    const compactText = compactTextRef.current;
    const header = headerRef.current;
    const week = weekRef.current;
    if (!root || !compact || !compactText || !header || !week) return;

    function measure() {
      if (!root || !compact || !compactText || !header || !week) return;
      const rootBounds = root.getBoundingClientRect();
      const anchor = (element: HTMLElement): Anchor => {
        const bounds = element.getBoundingClientRect();
        return {
          x: bounds.left - rootBounds.left - root.clientLeft,
          y: bounds.top - rootBounds.top - root.clientTop,
          width: bounds.width,
        };
      };
      const compactAnchor = anchor(compactText);
      const headerHeight = header.offsetHeight + 2 * header.offsetTop;
      const selected = selectedRef.current;
      const expandedAnchor = selected ? anchor(selected) : compactAnchor;
      if (selected) {
        // The panel's current top may still use the previous header size during
        // a resize. Measure the row within the week and add the new header size.
        expandedAnchor.y =
          headerHeight + selected.getBoundingClientRect().top - week.getBoundingClientRect().top;
      }
      const next: Geometry = {
        compact: compactAnchor,
        compactHeight: compact.offsetHeight,
        expanded: expandedAnchor,
        expandedHeight: headerHeight + week.offsetHeight,
        headerHeight,
        iconHeight: iconRef.current?.offsetHeight ?? 16,
      };
      // Establish the first geometry without a mount animation. Subsequent
      // targets animate from these same values, including interrupted toggles.
      if (!measuredRef.current) {
        cardHeight.set(next.compactHeight);
        textX.set(next.compact.x);
        textY.set(next.compact.y);
        textWidth.set(next.compact.width);
        measuredRef.current = true;
      }
      setGeometry((current) =>
        current && JSON.stringify(current) === JSON.stringify(next) ? current : next,
      );
    }

    measure();
    // These are nonanimated geometry slots, so height animation does not cause
    // per-frame measurement or React updates. Resizing/text wrapping still does.
    const observer = new ResizeObserver(measure);
    observer.observe(compact);
    observer.observe(header);
    observer.observe(week);
    if (iconRef.current) observer.observe(iconRef.current);
    return () => observer.disconnect();
  }, [
    hours,
    highlightedIndex,
    plannedVisit,
    summary,
    open,
    geometry?.compact.width,
    cardHeight,
    textX,
    textY,
    textWidth,
  ]);

  const anchor = open && selectedLine ? geometry?.expanded : geometry?.compact;
  const height = open ? geometry?.expandedHeight : geometry?.compactHeight;

  return (
    <Collapsible
      className="relative mx-6 mt-5 overflow-hidden rounded-[var(--radius-lg)] border border-border-subtle"
      onOpenChange={setOpen}
      open={open}
      render={
        <motion.div
          animate={geometry ? { height } : undefined}
          initial={false}
          ref={rootRef}
          style={{ height: cardHeight, boxSizing: 'content-box' }}
          transition={transition}
        />
      }
    >
      <div
        aria-hidden="true"
        className="pointer-events-none invisible flex items-center gap-3 px-4 py-3"
        ref={compactRef}
      >
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="text-xs">{t('regularHours')}</span>
          <span className="block text-sm" ref={compactTextRef}>
            {summary}
          </span>
        </div>
        <span className="size-4 shrink-0" />
      </div>

      <span
        aria-hidden="true"
        className="pointer-events-none invisible absolute top-3 right-11 left-4 block text-sm font-medium"
        ref={headerRef}
      >
        {t('regularHours')}
      </span>

      <CollapsibleTrigger
        aria-label={open ? t('regularHours') : `${t('regularHours')} ${summary}`}
        className="absolute inset-x-0 top-0 z-10 block w-full text-left focus-visible:ring-inset"
        style={{
          height: geometry ? (open ? geometry.headerHeight : geometry.compactHeight) : '100%',
        }}
      >
        <motion.span
          animate={{
            fontSize: open ? '0.875rem' : '0.75rem',
            lineHeight: open ? '1.25rem' : '1rem',
            fontWeight: open ? 500 : 400,
            color: open ? 'var(--foreground)' : 'var(--muted-foreground)',
          }}
          aria-hidden="true"
          className="absolute top-3 right-11 left-4 block"
          initial={false}
          transition={transition}
        >
          {t('regularHours')}
        </motion.span>
        <motion.span
          animate={{
            y:
              (((open ? geometry?.headerHeight : geometry?.compactHeight) ?? 62) -
                (geometry?.iconHeight ?? 16)) /
              2,
            rotate: open ? 180 : 0,
          }}
          aria-hidden="true"
          className="absolute top-0 right-4 size-4"
          initial={false}
          ref={iconRef}
          transition={transition}
        >
          <ChevronDown className="size-4" />
        </motion.span>
      </CollapsibleTrigger>

      <CollapsiblePanel
        className="absolute inset-x-0 h-auto overflow-visible transition-none data-[ending-style]:h-auto data-[starting-style]:h-auto"
        keepMounted
        render={(props) => (
          <div
            {...props}
            aria-hidden={!open}
            hidden={false}
            inert={!open}
            style={{ ...props.style, top: geometry?.headerHeight ?? 44 }}
          />
        )}
      >
        <ul className="grid gap-0.5 px-1 pb-3 text-sm" ref={weekRef}>
          {hours.map((line, index) => {
            const selected = index === highlightedIndex && Boolean(selectedLine);
            const quietIndex =
              index - (highlightedIndex !== null && index > highlightedIndex ? 1 : 0);
            const staggerIndex = open ? quietIndex : hours.length - 2 - quietIndex;
            return (
              <motion.li
                animate={selected ? undefined : { opacity: open ? 1 : 0, y: open ? 0 : 4 }}
                aria-current={selected && open ? 'date' : undefined}
                className={cn(
                  'relative mx-1 rounded-[var(--radius-sm)] px-2 py-1.5 text-muted-foreground',
                  selected && 'font-medium text-secondary-foreground',
                )}
                initial={false}
                key={`${index}:${line}`}
                transition={{
                  duration: reducedMotion ? 0 : 0.14,
                  delay: reducedMotion ? 0 : Math.min(5, Math.max(0, staggerIndex)) * 0.012,
                  ease: motionEase,
                }}
              >
                {selected ? (
                  <>
                    <motion.span
                      animate={{ opacity: open ? 1 : 0 }}
                      aria-hidden="true"
                      className="absolute inset-0 rounded-[var(--radius-sm)] bg-secondary"
                      initial={false}
                      transition={transition}
                    />
                    <span className="sr-only">{line}</span>
                    <span
                      aria-hidden="true"
                      className="invisible block"
                      ref={selectedRef}
                      style={{ maxWidth: geometry?.compact.width }}
                    >
                      {line}
                    </span>
                    {plannedVisit ? (
                      <motion.span
                        animate={{ opacity: open ? 1 : 0 }}
                        className="relative mt-0.5 block text-xs font-normal"
                        initial={false}
                        transition={transition}
                      >
                        {plannedVisit}
                      </motion.span>
                    ) : null}
                  </>
                ) : (
                  line
                )}
              </motion.li>
            );
          })}
        </ul>
      </CollapsiblePanel>

      <motion.span
        animate={
          anchor
            ? {
                x: anchor.x,
                y: anchor.y,
                width: anchor.width,
                opacity: open && !selectedLine ? 0 : 1,
                fontWeight: open && selectedLine ? 500 : 400,
                color: open && selectedLine ? 'var(--secondary-foreground)' : 'var(--foreground)',
              }
            : undefined
        }
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 block text-sm"
        initial={false}
        style={{ x: textX, y: textY, width: textWidth }}
        transition={transition}
      >
        {summary}
      </motion.span>
    </Collapsible>
  );
}
