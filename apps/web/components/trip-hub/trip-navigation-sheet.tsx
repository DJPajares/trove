'use client';

import { useEffect, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Whether a sticky element is pinned at its `top` right now. Read on scroll
 * directly: one rect read per event, no frame loop to stall.
 */
function useStuck(element: HTMLElement | null) {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (!element) return;
    const update = () => {
      const style = getComputedStyle(element);
      setStuck(
        style.position === 'sticky' &&
          element.getBoundingClientRect().top <= Number.parseFloat(style.top) + 0.5,
      );
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [element]);
  return stuck;
}

/**
 * The trip's navigation row on a phone: a sheet rising over the cover with a
 * rounded top, which stays pinned below the status bar as the section scrolls.
 * Pinned, the curve would show the page scrolling behind its corners, so it
 * squares off. The sticky range is the element's parent, so callers place it
 * directly in the section it should stay with. `className` carries only the
 * wider layouts' placement.
 */
export function TripNavigationSheet({
  children,
  className,
}: Readonly<{ children: ReactNode; className?: string }>) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const stuck = useStuck(element);

  return (
    <div
      className={cn(
        'sticky top-[calc(var(--safe-top)+var(--header-offset))] z-[var(--layer-sticky)] -mx-[var(--gutter-inline-start)] -mt-8 rounded-t-[var(--trip-sheet-radius)] bg-background px-[var(--gutter-inline-start)] pt-2 transition-[border-radius] duration-[var(--motion-standard)] motion-reduce:transition-none md:relative md:top-auto md:z-auto',
        stuck && 'rounded-t-none',
        className,
      )}
      data-slot="trip-navigation-sheet"
      data-stuck={stuck || undefined}
      ref={setElement}
    >
      {children}
    </div>
  );
}
