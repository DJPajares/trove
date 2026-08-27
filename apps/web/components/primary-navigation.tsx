'use client';

import { Bookmark, House, MapPinned, Plus } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ComponentType } from 'react';

import { AppMenuTrigger } from '@/components/app-menu';
import { useTripCreation } from '@/components/trip-creation-provider';
import { Button } from '@/components/ui/button';
import { navigationTransition } from '@/lib/motion';
import {
  isAppMenuPath,
  isNavigationPathActive,
  primaryNavigationDestinations,
} from '@/lib/navigation';
import { cn } from '@/lib/utils';

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
  const icons = { home: House, saved: Bookmark, trips: MapPinned };
  const items: NavigationItem[] = primaryNavigationDestinations.map(({ column, href, key }) => ({
    column,
    href,
    icon: icons[key],
    label: t(key),
  }));

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
    // The bar itself only sizes and positions. Its surface is a separate masked
    // layer, because the mask that carves the notch would otherwise carve the
    // create action out of existence along with it. Padding lives on the content
    // wrapper for the same reason: `inset-0` resolves against the padding box
    // while the mask resolves against the border box, and the two must agree.
    <div className="fixed inset-x-0 bottom-0 z-[var(--layer-sticky)] h-[calc(var(--bottom-bar-height)+var(--safe-bottom))] md:hidden">
      {/* The hairline is its own layer, cut to the same silhouette grown by 1px,
          because a `border-top` can only draw the flat part and would die at the
          shoulders where the curve begins. */}
      <span
        aria-hidden="true"
        className="nav-notch-edge absolute -top-px right-0 bottom-0 left-0 z-0 bg-border-subtle"
      />
      <span
        aria-hidden="true"
        className="nav-notch-surface absolute inset-0 z-0 bg-background/96 backdrop-blur supports-[backdrop-filter]:bg-background/90"
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
                        ? 'font-semibold text-brand'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    href={href}
                  >
                    <Icon aria-hidden="true" className="size-5" />
                    <span className="max-w-full truncate">{label}</span>
                  </Link>
                </li>
              );
            })}
            <li className="col-start-5">
              <AppMenuTrigger active={isAppMenuPath(pathname)} variant="mobile" />
            </li>
          </ul>
        </nav>
      </div>

      {/* Creation is an action, not a destination: the shared sheet opens over
          whichever screen the traveller is already using. It sits outside the
          masked surface and rides above the notch rather than inside it, so the
          curve reads as the bar giving way to the button. */}
      <Button
        aria-label={t('createTrip')}
        className="absolute top-[calc(-1*var(--nav-action-overhang))] left-1/2 z-20 size-[var(--nav-action-size)] -translate-x-1/2 rounded-full bg-primary text-primary-foreground shadow-[var(--nav-action-shadow)] transition-[background-color,box-shadow,transform] duration-[var(--motion-standard)] ease-[var(--ease-standard)] hover:bg-brand-strong hover:shadow-[var(--nav-action-shadow-hover)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring active:translate-y-px"
        onClick={openCreateTrip}
        type="button"
      >
        <Plus aria-hidden="true" className="size-7" />
      </Button>
    </div>
  );
}
