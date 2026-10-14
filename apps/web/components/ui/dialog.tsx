'use client';

import * as React from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { XIcon } from 'lucide-react';

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 isolate z-[var(--layer-overlay)] bg-foreground/20 duration-[var(--motion-standard)] supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 dark:bg-surface-sunken/70',
        className,
      )}
      {...props}
    />
  );
}

/**
 * The close button travels with the header when there is one, so it sticks to
 * the top with it instead of scrolling away under it.
 */
const DialogCloseContext = React.createContext<{
  closeLabel: string;
  setHeaderClose: (owned: boolean) => void;
  showCloseButton: boolean;
} | null>(null);

function DialogCloseButton({ closeLabel }: Readonly<{ closeLabel: string }>) {
  return (
    <DialogPrimitive.Close
      data-slot="dialog-close"
      render={<Button variant="ghost" className="absolute top-3 right-3" size="icon-sm" />}
    >
      <XIcon />
      <span className="sr-only">{closeLabel}</span>
    </DialogPrimitive.Close>
  );
}

function DialogContent({
  className,
  children,
  closeLabel,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  closeLabel: string;
  showCloseButton?: boolean;
}) {
  const [headerClose, setHeaderClose] = React.useState(false);
  const closeContext = React.useMemo(
    () => ({ closeLabel, setHeaderClose, showCloseButton }),
    [closeLabel, showCloseButton],
  );
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-[var(--layer-overlay)] grid max-h-[calc(100dvh-2rem-var(--safe-top)-var(--safe-bottom))] w-full max-w-[calc(100%-2rem-var(--safe-left)-var(--safe-right))] -translate-x-1/2 -translate-y-1/2 gap-6 overflow-y-auto rounded-[var(--radius-2xl)] border border-border-subtle bg-popover p-6 text-sm text-popover-foreground shadow-[var(--shadow-overlay)] duration-[var(--motion-standard)] outline-none sm:max-w-lg sm:p-8 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
          className,
        )}
        {...props}
      >
        <DialogCloseContext.Provider value={closeContext}>{children}</DialogCloseContext.Provider>
        {showCloseButton && !headerClose ? <DialogCloseButton closeLabel={closeLabel} /> : null}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

/**
 * The dialog's title and context. Like the footer, it sticks - to the top of
 * the dialog's scroll, past its padding - so a long dialog never loses what it
 * is about, or the way to close it.
 */
function DialogHeader({ className, children, ...props }: React.ComponentProps<'div'>) {
  const close = React.useContext(DialogCloseContext);
  const setHeaderClose = close?.setHeaderClose;
  React.useLayoutEffect(() => {
    if (!setHeaderClose) return;
    setHeaderClose(true);
    return () => setHeaderClose(false);
  }, [setHeaderClose]);
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        'sticky -top-6 z-10 -mx-6 -mt-6 flex flex-col gap-2 border-b border-border-subtle bg-popover p-6 sm:-top-8 sm:-mx-8 sm:-mt-8 sm:p-8',
        className,
      )}
      {...props}
    >
      {children}
      {close?.showCloseButton ? <DialogCloseButton closeLabel={close.closeLabel} /> : null}
    </div>
  );
}

/**
 * The dialog's actions. The whole dialog scrolls when its content is taller
 * than the screen, so the footer sticks to the bottom of that scroll: what the
 * dialog asks for stays in reach however long the explanation above it runs.
 * It sticks past the dialog's own padding, so nothing scrolls by beneath it.
 */
function DialogFooter({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        'sticky -bottom-6 z-10 -mx-6 -mb-6 flex flex-col-reverse gap-2 border-t border-border-subtle bg-popover p-6 sm:-bottom-8 sm:-mx-8 sm:-mb-8 sm:flex-row sm:justify-end sm:p-8',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        'pr-10 text-[var(--text-section-title)] leading-tight font-semibold tracking-[-0.025em]',
        className,
      )}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        'text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground',
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
