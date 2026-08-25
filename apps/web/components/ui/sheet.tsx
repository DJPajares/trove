'use client';

import * as React from 'react';
import { Drawer as SheetPrimitive } from '@base-ui/react/drawer';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { XIcon } from 'lucide-react';

type SheetSide = 'top' | 'right' | 'bottom' | 'left';

/**
 * A sheet is flush against the edges it is anchored to, so it is the layer that
 * has to hold its own content clear of a notch or a home indicator: a
 * full-height side sheet guards top, bottom and its own side, and an edge sheet
 * guards its own edge and both sides. Landscape is the case that bites — the
 * insets move to left and right, and a side sheet is exactly what sits there.
 */
const mobileSideClasses: Record<SheetSide, string> = {
  bottom:
    'inset-x-0 bottom-0 h-auto max-h-[90dvh] w-full rounded-t-[var(--radius-xl)] border-t pb-[var(--safe-bottom)] pl-[var(--safe-left)] pr-[var(--safe-right)] data-ending-style:translate-y-[2.5rem] data-starting-style:translate-y-[2.5rem]',
  left: 'inset-y-0 left-0 h-full w-[min(28rem,calc(100%-2rem))] border-r pt-[var(--safe-top)] pb-[var(--safe-bottom)] pl-[var(--safe-left)] data-ending-style:translate-x-[-2.5rem] data-starting-style:translate-x-[-2.5rem]',
  right:
    'inset-y-0 right-0 h-full w-[min(28rem,calc(100%-2rem))] border-l pt-[var(--safe-top)] pr-[var(--safe-right)] pb-[var(--safe-bottom)] data-ending-style:translate-x-[2.5rem] data-starting-style:translate-x-[2.5rem]',
  top: 'inset-x-0 top-0 h-auto max-h-[90dvh] w-full rounded-b-[var(--radius-xl)] border-b pt-[var(--safe-top)] pl-[var(--safe-left)] pr-[var(--safe-right)] data-ending-style:translate-y-[-2.5rem] data-starting-style:translate-y-[-2.5rem]',
};

const desktopSideClasses: Record<SheetSide, string> = {
  bottom:
    'md:inset-x-0 md:top-auto md:bottom-0 md:h-auto md:max-h-[90dvh] md:w-full md:rounded-t-[var(--radius-xl)] md:rounded-b-none md:border md:border-x-0 md:border-b-0 md:pb-[var(--safe-bottom)] md:data-ending-style:translate-x-0 md:data-ending-style:translate-y-[2.5rem] md:data-starting-style:translate-x-0 md:data-starting-style:translate-y-[2.5rem]',
  left: 'md:inset-y-0 md:top-0 md:right-auto md:bottom-0 md:left-0 md:h-full md:max-h-[100dvh] md:w-[min(24rem,calc(100%-2rem))] md:rounded-none md:border md:border-y-0 md:border-l-0 md:border-r md:pt-[var(--safe-top)] md:pb-[var(--safe-bottom)] md:pl-[var(--safe-left)] md:data-ending-style:translate-x-[-2.5rem] md:data-ending-style:translate-y-0 md:data-starting-style:translate-x-[-2.5rem] md:data-starting-style:translate-y-0',
  right:
    'md:inset-y-0 md:top-0 md:right-0 md:bottom-0 md:left-auto md:h-full md:max-h-[100dvh] md:w-[min(24rem,calc(100%-2rem))] md:rounded-none md:border md:border-y-0 md:border-r-0 md:border-l md:pt-[var(--safe-top)] md:pr-[var(--safe-right)] md:pb-[var(--safe-bottom)] md:data-ending-style:translate-x-[2.5rem] md:data-ending-style:translate-y-0 md:data-starting-style:translate-x-[2.5rem] md:data-starting-style:translate-y-0',
  top: 'md:inset-x-0 md:top-0 md:bottom-auto md:h-auto md:max-h-[90dvh] md:w-full md:rounded-t-none md:rounded-b-[var(--radius-xl)] md:border md:border-x-0 md:border-t-0 md:border-b md:pt-[var(--safe-top)] md:data-ending-style:translate-x-0 md:data-ending-style:translate-y-[-2.5rem] md:data-starting-style:translate-x-0 md:data-starting-style:translate-y-[-2.5rem]',
};

function subscribeToSheetViewport(onChange: () => void) {
  const query = window.matchMedia('(max-width: 767px)');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  const mobile = React.useSyncExternalStore(
    subscribeToSheetViewport,
    () => window.matchMedia('(max-width: 767px)').matches,
    () => false,
  );

  return (
    <SheetPrimitive.Root data-slot="sheet" swipeDirection={mobile ? 'down' : 'right'} {...props} />
  );
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        'fixed inset-0 z-[var(--layer-overlay)] bg-foreground/20 transition-opacity duration-[var(--motion-standard)] data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-xs dark:bg-surface-sunken/70',
        className,
      )}
      {...props}
    />
  );
}

function SheetContent({
  className,
  children,
  closeLabel,
  mobileSide = 'bottom',
  side = 'right',
  showCloseButton = true,
  ...props
}: SheetPrimitive.Popup.Props & {
  closeLabel: string;
  mobileSide?: SheetSide;
  side?: SheetSide;
  showCloseButton?: boolean;
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Viewport
        className="fixed inset-0 z-[var(--layer-overlay)]"
        data-slot="sheet-viewport"
      >
        <SheetPrimitive.Popup
          data-slot="sheet-content"
          data-side={side}
          data-mobile-side={mobileSide}
          className={cn(
            'fixed z-[var(--layer-overlay)] flex max-h-[100dvh] flex-col gap-4 border-border bg-popover bg-clip-padding text-sm text-popover-foreground shadow-[var(--shadow-overlay)] transition-[opacity,transform] duration-[var(--motion-standard)] ease-[var(--ease-standard)] [transform:translateY(var(--drawer-swipe-movement-y,0px))] data-ending-style:opacity-0 data-starting-style:opacity-0 data-swiping:duration-0 md:[transform:translateX(var(--drawer-swipe-movement-x,0px))]',
            mobileSideClasses[mobileSide],
            desktopSideClasses[side],
            className,
          )}
          {...props}
        >
          {mobileSide === 'bottom' ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-2 left-1/2 z-10 h-1 w-10 -translate-x-1/2 rounded-full bg-foreground/25 md:hidden"
              data-slot="sheet-drag-handle"
            />
          ) : null}
          {children}
          {showCloseButton && (
            <SheetPrimitive.Close
              data-slot="sheet-close"
              render={
                <Button
                  variant="ghost"
                  // An absolute offset resolves against the padding box, so the
                  // popup's own safe padding never reaches this button: it has to
                  // clear the insets itself. `max()` collapses to the plain offset
                  // on any device where the insets are zero. The two sides a sheet
                  // is not flush against are reset back.
                  className="absolute top-[max(0.75rem,var(--safe-top))] right-[max(0.75rem,var(--safe-right))] in-data-[mobile-side=bottom]:top-3 in-data-[mobile-side=left]:right-3 md:in-data-[side=bottom]:top-3 md:in-data-[side=left]:right-3"
                  size="icon-sm"
                />
              }
            >
              <XIcon />
              <span className="sr-only">{closeLabel}</span>
            </SheetPrimitive.Close>
          )}
        </SheetPrimitive.Popup>
      </SheetPrimitive.Viewport>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex flex-col gap-2 border-b border-border-subtle p-6 pr-16', className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn('mt-auto flex flex-col gap-2 border-t border-border-subtle p-6', className)}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        'text-[var(--text-section-title)] leading-tight font-semibold tracking-[-0.025em] text-foreground',
        className,
      )}
      {...props}
    />
  );
}

function SheetDescription({ className, ...props }: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetOverlay,
  SheetPortal,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
