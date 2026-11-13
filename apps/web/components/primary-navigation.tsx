'use client';

import { Plus } from 'lucide-react';
import { motion, type Transition } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ComponentType } from 'react';

import { NavActiveIndicator } from '@/components/nav-active-indicator';
import { usePrimaryAction } from '@/components/primary-action-provider';
import { useTripCreation } from '@/components/trip-creation-provider';
import { Button } from '@/components/ui/button';
import { motionEase, navigationTransition } from '@/lib/motion';
import {
  isImmersiveTripPath,
  isNavigationPathActive,
  primaryNavigationDestinations,
} from '@/lib/navigation';
import { cn } from '@/lib/utils';
import * as Icons from '@/lib/icons';

/** A small settle as a tab becomes current: a dip, a slight overshoot, rest. */
const iconSelectTransition: Transition = {
  duration: 0.32,
  ease: motionEase,
  times: [0, 0.55, 1],
};

type NavigationItem = {
  /**
   * Which cell this destination takes in the mobile bar's five-column grid.
   * Static strings rather than an index, because Tailwind cannot generate a
   * class from a value it only sees at runtime. Column three is left empty for
   * the create action. Ignored by the desktop variant.
   */
  column: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
};

type PrimaryNavigationProps = {
  variant: 'desktop' | 'mobile';
};

export function PrimaryNavigation({ variant }: Readonly<PrimaryNavigationProps>) {
  const pathname = usePathname();
  const t = useTranslations('navigation');
  const { openCreateTrip } = useTripCreation();
  const primaryAction = usePrimaryAction();
  const icons = { home: Icons.Home, saved: Icons.Saved, tools: Icons.Tools, trips: Icons.Trips };
  const items: NavigationItem[] = primaryNavigationDestinations.map(({ column, href, key }) => ({
    column,
    href,
    icon: icons[key],
    label: t(key),
  }));

  // Trip Mode and the Memories journal own the bottom of the screen while a
  // traveller is in them. The desktop rail stays: there is no thumb zone to
  // compete for up there.
  if (variant === 'mobile' && isImmersiveTripPath(pathname)) return null;

  if (variant === 'desktop') {
    return (
      <nav aria-label={t('primary')} className="hidden items-center gap-1 md:flex">
        {items.map(({ href, label }) => {
          const active = isNavigationPathActive(pathname, href);

          return (
            <Link
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative isolate rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium transition-colors duration-[var(--motion-standard)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
              href={href}
              scroll={href === '/trips' ? false : undefined}
              key={href}
            >
              {active ? (
                <motion.span
                  aria-hidden="true"
                  className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-brand"
                  layoutId="primary-navigation-desktop"
                  transition={navigationTransition}
                />
              ) : null}
              <span className="relative">{label}</span>
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    // The bar is one plain frosted strip, and the create action rides over its
    // top edge. An earlier notch carved under the button let the page show
    // through sharp there, which made the button look cut out of the page.
    // Padding lives on the content wrapper so the surface layer can fill the
    // whole bar.
    <div className="fixed inset-x-0 bottom-0 z-[var(--layer-sticky)] h-[calc(var(--bottom-bar-height)+var(--safe-bottom))] md:hidden">
      <span
        aria-hidden="true"
        className="absolute inset-0 z-0 border-t border-border-subtle bg-background/96 backdrop-blur supports-[backdrop-filter]:bg-background/90"
        data-translucent-surface
      />
      <div className="relative z-10 mx-auto h-full max-w-xl px-[max(0.5rem,var(--safe-left),var(--safe-right))] pt-2 pb-[var(--safe-bottom)]">
        <nav aria-label={t('mobile')} className="h-full">
          <ul className="grid grid-cols-5 gap-1">
            {items.map(({ column, href, icon: Icon, label }) => {
              const active = isNavigationPathActive(pathname, href);

              return (
                <li className={column} key={href}>
                  <Link
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'relative isolate flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-[var(--radius-md)] px-1 py-1.5 text-xs font-medium transition-colors duration-[var(--motion-standard)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                      active
                        ? 'font-semibold text-brand [--icon-stroke:var(--icon-stroke-emphasis)]'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    href={href}
                    scroll={href === '/trips' ? false : undefined}
                  >
                    {active ? <NavActiveIndicator /> : null}
                    <motion.span
                      animate={{ scale: active ? [0.86, 1.06, 1] : 1 }}
                      className="grid place-items-center"
                      initial={false}
                      transition={iconSelectTransition}
                    >
                      <Icon aria-hidden="true" className="size-5" />
                    </motion.span>
                    <span className="max-w-full truncate">{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      {/* Creation is an action, not a destination: the shared sheet opens over
          whichever screen the traveller is already using. It rides half above
          the bar's top edge, lifted off it by its own shadow.

          What it creates is the screen's to name. On a day of the itinerary the
          nearest thing to make is a stop on that day, and in the saved library
          it is another place; a screen that claims the button says so through
          the primary action registry, and everywhere else it starts a trip. The
          icon and its place never move, so the button stays the same button. */}
      <Button
        aria-label={primaryAction?.label ?? t('createTrip')}
        className="absolute top-[calc(-1*var(--nav-action-overhang))] left-1/2 z-20 size-[var(--nav-action-size)] -translate-x-1/2 rounded-full bg-primary text-primary-foreground shadow-[var(--nav-action-shadow)] transition-[background-color,box-shadow,transform] duration-[var(--motion-standard)] ease-[var(--ease-standard)] hover:bg-brand-strong hover:shadow-[var(--nav-action-shadow-hover)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring active:translate-y-px"
        onClick={primaryAction?.onTrigger ?? openCreateTrip}
        type="button"
      >
        <Plus aria-hidden="true" className="size-7" />
      </Button>
    </div>
  );
}
