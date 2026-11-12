'use client';

import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { useLayoutEffect, useRef, type CSSProperties } from 'react';

import { cn } from '@/lib/utils';

type ScrollShadowOrientation = 'vertical' | 'horizontal';

type ScrollShadowProps = Omit<useRender.ComponentProps<'div'>, 'ref'> & {
  /** Any element, since `render` can make it a list or a landmark. */
  ref?: React.Ref<HTMLElement>;
  orientation?: ScrollShadowOrientation;
  /** Fade depth at each edge, in pixels. */
  size?: number;
  /** Turns the fade off without unmounting, e.g. while the content wraps instead. */
  isEnabled?: boolean;
};

// Below a pixel is sub-pixel rounding, not content left to scroll to.
const EDGE_TOLERANCE = 1;

/**
 * Marks which edges still have content beyond them as `data-scroll-start` /
 * `data-scroll-end`. Written straight to the DOM so scrolling never re-renders.
 */
function useScrollShadow(
  ref: React.RefObject<HTMLElement | null>,
  orientation: ScrollShadowOrientation,
  isEnabled: boolean,
) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !isEnabled) return;

    const update = () => {
      const vertical = orientation === 'vertical';
      // RTL reports a negative scrollLeft, so measure distance from the start edge.
      const position = Math.abs(vertical ? element.scrollTop : element.scrollLeft);
      const viewport = vertical ? element.clientHeight : element.clientWidth;
      const content = vertical ? element.scrollHeight : element.scrollWidth;
      element.toggleAttribute('data-scroll-start', position > EDGE_TOLERANCE);
      element.toggleAttribute('data-scroll-end', position + viewport < content - EDGE_TOLERANCE);
    };

    // Content that grows or shrinks changes what is left to scroll, so watch
    // the children too, re-observing them whenever they are swapped.
    const resizeObserver = new ResizeObserver(update);
    const observeChildren = () => {
      resizeObserver.disconnect();
      resizeObserver.observe(element);
      for (const child of element.children) resizeObserver.observe(child);
    };
    const mutationObserver = new MutationObserver(() => {
      observeChildren();
      update();
    });

    observeChildren();
    mutationObserver.observe(element, { childList: true });
    element.addEventListener('scroll', update, { passive: true });
    update();

    return () => {
      element.removeEventListener('scroll', update);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      element.removeAttribute('data-scroll-start');
      element.removeAttribute('data-scroll-end');
    };
  }, [ref, orientation, isEnabled]);
}

// Each edge fades from opaque to clear over the last `size` pixels; Tailwind
// intersects the edge masks, so both edges can fade at once.
const orientationClasses: Record<ScrollShadowOrientation, string> = {
  vertical:
    'overflow-y-auto data-scroll-start:mask-t-from-[calc(100%-var(--scroll-shadow-size))] data-scroll-end:mask-b-from-[calc(100%-var(--scroll-shadow-size))]',
  horizontal:
    'overflow-x-auto ltr:data-scroll-start:mask-l-from-[calc(100%-var(--scroll-shadow-size))] ltr:data-scroll-end:mask-r-from-[calc(100%-var(--scroll-shadow-size))] rtl:data-scroll-start:mask-r-from-[calc(100%-var(--scroll-shadow-size))] rtl:data-scroll-end:mask-l-from-[calc(100%-var(--scroll-shadow-size))]',
};

/**
 * A scroll container that fades out at any edge with more content beyond it,
 * and stops fading once that edge is reached. Renders a `div` unless given
 * `render` (e.g. `render={<ul />}`), and can itself be another component's
 * `render`. Keep borders and shadows off it: the mask fades those too.
 */
function ScrollShadow({
  className,
  orientation = 'vertical',
  size = 40,
  isEnabled = true,
  style,
  render,
  ref,
  ...props
}: ScrollShadowProps) {
  const internalRef = useRef<HTMLElement>(null);
  useScrollShadow(internalRef, orientation, isEnabled);

  return useRender({
    defaultTagName: 'div',
    ref: ref ? [internalRef, ref] : internalRef,
    props: mergeProps<'div'>(
      {
        className: cn(orientationClasses[orientation], className),
        style: { '--scroll-shadow-size': `${size}px`, ...style } as CSSProperties,
      },
      props,
    ),
    render,
    state: { slot: 'scroll-shadow', orientation },
  });
}

export { ScrollShadow };
export type { ScrollShadowOrientation, ScrollShadowProps };
