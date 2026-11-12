import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import type { CSSProperties } from 'react';

import { cn } from '@/lib/utils';

type ScrollShadowOrientation = 'vertical' | 'horizontal';

type ScrollShadowProps = useRender.ComponentProps<'div'> & {
  orientation?: ScrollShadowOrientation;
  /** Fade depth at each edge, as a CSS length. Defaults to 2.5rem. */
  size?: string;
};

/**
 * A scroll container that fades out at any edge with more content beyond it.
 * The fade is the `scroll-shadow-x` / `scroll-shadow-y` utility in globals.css;
 * reach for the utility directly on an existing scroller.
 */
function ScrollShadow({
  className,
  orientation = 'vertical',
  size,
  style,
  render,
  ...props
}: ScrollShadowProps) {
  const sizeStyle = size ? ({ '--scroll-shadow-size': size } as CSSProperties) : undefined;
  return useRender({
    defaultTagName: 'div',
    props: mergeProps<'div'>(
      {
        className: cn(
          orientation === 'horizontal'
            ? 'scroll-shadow-x overflow-x-auto'
            : 'scroll-shadow-y overflow-y-auto',
          className,
        ),
        style: sizeStyle ? { ...sizeStyle, ...style } : style,
      },
      props,
    ),
    render,
    state: { slot: 'scroll-shadow', orientation },
  });
}

export { ScrollShadow };
export type { ScrollShadowOrientation, ScrollShadowProps };
