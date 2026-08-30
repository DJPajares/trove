'use client';

import { Menu, Search, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { AccountMenu } from '@/components/account-menu';
import { AppearanceToggle } from '@/components/appearance-toggle';
import { GlobalSearch } from '@/components/global-search';
import { NotificationCenter } from '@/components/notification-center';
import { useNotifications } from '@/components/notifications-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCollapsingHeader } from '@/hooks/use-collapsing-header';
import { navigationTransition } from '@/lib/motion';
import {
  floatingActionDelay,
  floatingActionOrder,
  floatingActionTriggerClass,
} from '@/lib/shell/floating-actions';
import { cn } from '@/lib/utils';

/**
 * The controls portal their popups to the end of the document, so a tap inside
 * an open account menu, notification panel or search dialog lands nowhere near
 * the stack. Without this the stack would collapse out from under its own popup.
 */
const POPUP_SELECTOR =
  '[data-slot="dropdown-menu-content"],[data-slot="popover-content"],[data-slot="sheet-content"],[data-slot="dialog-content"]';

/**
 * The everyday controls, floating in the upper right of the signed-in shell.
 *
 * The same trigger serves every viewport. On mobile it stands in for the
 * absent header; on tablet and desktop it occupies the header's open right
 * rail. The burger unfolds downwards and turns into an X in the same place, so
 * the way out is where the way in was.
 */
export function FloatingActionStack() {
  const t = useTranslations('navigation');
  const search = useTranslations('globalSearch');
  const pathname = usePathname();
  const [searchOpen, setSearchOpen] = useState(false);
  const { notifications, status } = useNotifications();
  const [expanded, setExpanded] = useState(false);
  const reducedMotion = useReducedMotion();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // An unavailable feed has nothing to count.
  const unreadCount = status === 'unavailable' ? 0 : notifications.length;

  const collapse = useCallback(() => setExpanded(false), []);

  /**
   * Collapsing must never strand the focus ring on a button that is about to
   * unmount, but a tap somewhere else on the page is the traveller moving on —
   * pulling focus back to the trigger there would be taking the screen from
   * them.
   */
  const collapseAndRestoreFocus = useCallback(() => {
    const wrapper = wrapperRef.current;
    const active = document.activeElement;

    if (wrapper && active && active !== triggerRef.current && wrapper.contains(active)) {
      triggerRef.current?.focus();
    }

    setExpanded(false);
  }, []);

  // Links inside the popups, and the browser's own back button, both leave the
  // stack expanded over a screen it no longer belongs to.
  useEffect(() => {
    setExpanded(false);
  }, [pathname]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;

      event.preventDefault();
      setExpanded(false);
      setSearchOpen(true);
    };

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  useEffect(() => {
    if (!expanded) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (!(target instanceof Element)) return;
      if (wrapperRef.current?.contains(target)) return;
      if (target.closest(POPUP_SELECTOR)) return;

      setExpanded(false);
    };

    document.addEventListener('pointerdown', handlePointerDown, true);

    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [expanded]);

  // The stack shares the top of the screen with the trip, Trip Mode and
  // itinerary sticky rows, which dock there once the page has scrolled. Yielding
  // to the scroll direction keeps the two off each other without every sticky
  // row having to reserve a corner for this one button. Expanded, it holds its
  // ground: the traveller has just opened it.
  const { collapsed, reveal } = useCollapsingHeader();
  const hidden = collapsed && !expanded;

  const actions: Record<(typeof floatingActionOrder)[number], ReactNode> = {
    account: <AccountMenu onNavigate={collapse} triggerVariant="floating" />,
    appearance: <AppearanceToggle triggerVariant="floating" />,
    notifications: <NotificationCenter onNavigate={collapse} triggerVariant="floating" />,
    // Search fills the screen, so the stack that opened it has nothing left to
    // say and folds away. The dialog itself lives outside the stack for exactly
    // that reason: collapsing must not take its own dialog down with it.
    search: (
      <Button
        aria-label={search('button')}
        className={cn('text-foreground', floatingActionTriggerClass)}
        data-translucent-surface
        onClick={() => {
          setSearchOpen(true);
          setExpanded(false);
        }}
        size="icon"
        type="button"
        variant="ghost"
      >
        <Search aria-hidden="true" className="size-5" />
      </Button>
    ),
  };

  return (
    <>
      <div
        className="fixed top-[calc(0.75rem+var(--safe-top))] right-[max(0.75rem,var(--safe-right))] z-[var(--layer-notice)] flex flex-col items-end gap-3 transition-transform duration-[var(--motion-standard)] ease-[var(--ease-standard)]"
        onFocusCapture={reveal}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || !expanded) return;

          event.stopPropagation();
          collapseAndRestoreFocus();
        }}
        ref={wrapperRef}
        style={
          hidden
            ? { transform: 'translateY(calc(-100% - 0.75rem - var(--safe-top)))' }
            : { transform: 'none' }
        }
      >
        <Button
          aria-controls="floating-action-stack"
          aria-expanded={expanded}
          aria-label={
            expanded
              ? t('closeQuickActions')
              : unreadCount
                ? t('openQuickActionsWithNotifications', { count: unreadCount })
                : t('openQuickActions')
          }
          className="relative rounded-full border-border-subtle bg-background/95 text-foreground shadow-[var(--nav-action-shadow)] backdrop-blur focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring supports-[backdrop-filter]:bg-background/90"
          data-translucent-surface
          onClick={() => (expanded ? collapseAndRestoreFocus() : setExpanded(true))}
          ref={triggerRef}
          size="icon"
          type="button"
          variant="ghost"
        >
          {/* The icon swaps inside a box that never moves, so the tap target stays
            put under a finger that is already on it. */}
          <AnimatePresence initial={false} mode="wait">
            <motion.span
              animate={{ opacity: 1, rotate: 0 }}
              className="flex items-center justify-center"
              exit={{ opacity: 0, rotate: 90 }}
              initial={{ opacity: 0, rotate: -90 }}
              key={expanded ? 'close' : 'open'}
              transition={navigationTransition}
            >
              {expanded ? (
                <X aria-hidden="true" className="size-5" />
              ) : (
                <Menu aria-hidden="true" className="size-5" />
              )}
            </motion.span>
          </AnimatePresence>
          {/* Expanded, the notification button carries its own count a few pixels
            below. Two badges would read as two different numbers. */}
          {!expanded && unreadCount ? (
            <Badge
              aria-hidden="true"
              className="absolute top-1 right-1"
              size="count"
              variant="solid"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </Badge>
          ) : null}
        </Button>

        <AnimatePresence>
          {expanded ? (
            <motion.div
              aria-label={t('quickActions')}
              className="flex flex-col items-end gap-3"
              id="floating-action-stack"
              key="floating-action-stack"
              role="group"
            >
              {floatingActionOrder.map((action, index) => (
                <motion.div
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{
                    opacity: 0,
                    scale: 0.85,
                    // Folds back towards the trigger it came from.
                    transition: {
                      ...navigationTransition,
                      delay: reducedMotion ? 0 : floatingActionDelay(index, true),
                    },
                    y: -8,
                  }}
                  initial={{ opacity: 0, scale: 0.85, y: -8 }}
                  key={action}
                  transition={{
                    ...navigationTransition,
                    delay: reducedMotion ? 0 : floatingActionDelay(index),
                  }}
                >
                  {actions[action]}
                </motion.div>
              ))}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {/* A sibling of the stack, not a child: outside it so a collapse never
          unmounts an open dialog, and outside it so the modal can mark the
          burger inert along with the rest of the page. Focus comes back to that
          burger, the one control still on screen when the dialog closes. */}
      <GlobalSearch
        finalFocus={triggerRef}
        onNavigate={collapse}
        onOpenChange={setSearchOpen}
        open={searchOpen}
      />
    </>
  );
}
