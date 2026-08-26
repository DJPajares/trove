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
    <div
      className="fixed inset-x-0 bottom-0 z-[var(--layer-sticky)] h-[calc(var(--bottom-bar-height)+var(--safe-bottom))] border-t border-border-subtle bg-background/96 pt-2 pr-[max(0.5rem,var(--safe-right))] pb-[var(--safe-bottom)] pl-[max(0.5rem,var(--safe-left))] shadow-[0_-0.25rem_1.25rem_oklch(0_0_0/0.035)] backdrop-blur supports-[backdrop-filter]:bg-background/90 md:hidden"
      data-translucent-surface
    >
      <div className="relative mx-auto h-full max-w-xl">
        <span
          aria-hidden="true"
          className="absolute -top-8 left-1/2 z-0 size-20 -translate-x-1/2 rounded-full bg-background shadow-[0_-0.2rem_0.8rem_oklch(0_0_0/0.08)] ring-1 ring-border-subtle supports-[backdrop-filter]:bg-background/94"
        />
        <nav aria-label={t('mobile')} className="relative z-10 h-full">
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
                    <span className="relative">
                      <Icon aria-hidden="true" className="size-5" />
                      {active ? (
                        <span
                          aria-hidden="true"
                          className="absolute -top-1 -right-2 size-2.5 rounded-full bg-brand"
                        />
                      ) : null}
                    </span>
                    <span className="relative max-w-full truncate">{label}</span>
                  </Link>
                </li>
              );
            })}
            <li className="col-start-5">
              <AppMenuTrigger active={isAppMenuPath(pathname)} variant="mobile" />
            </li>
          </ul>
        </nav>

        {/* Creation is an action, not a destination: the shared sheet opens over
            whichever screen the traveller is already using. */}
        <Button
          aria-label={t('createTrip')}
          className="absolute -top-6 left-1/2 z-20 flex size-16 -translate-x-1/2 items-center justify-center rounded-full border border-primary/15 bg-primary text-primary-foreground shadow-[0_0.5rem_1rem_oklch(0_0_0/0.16)] transition-[background-color,box-shadow,transform] duration-[var(--motion-standard)] ease-[var(--ease-standard)] hover:bg-brand-strong hover:shadow-[0_0.35rem_0.8rem_oklch(0_0_0/0.14)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring active:translate-y-px"
          onClick={openCreateTrip}
          size="icon-lg"
          type="button"
        >
          <Plus aria-hidden="true" className="size-7" />
        </Button>
      </div>
    </div>
  );
}
