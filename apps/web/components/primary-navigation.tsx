'use client';

import { Bookmark, House, MapPinned, Plus } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ComponentType } from 'react';

import { AppMenuTrigger } from '@/components/app-menu';
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
      className="fixed inset-x-0 bottom-0 z-[var(--layer-sticky)] border-t border-border bg-background/95 pt-2 pr-[max(0.5rem,var(--safe-right))] pb-[max(0.5rem,var(--safe-bottom))] pl-[max(0.5rem,var(--safe-left))] backdrop-blur supports-[backdrop-filter]:bg-background/85 md:hidden"
      data-translucent-surface
    >
      <div className="relative mx-auto max-w-xl">
        <nav aria-label={t('mobile')}>
          <ul className="grid grid-cols-5 gap-1">
            {items.map(({ column, href, icon: Icon, label }) => {
              const active = isNavigationPathActive(pathname, href);

              return (
                <li className={column} key={href}>
                  <Link
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'relative isolate flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-[var(--radius-md)] px-1 py-1.5 text-xs font-medium transition-colors duration-[var(--motion-standard)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                      active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                    )}
                    href={href}
                  >
                    {active ? (
                      <motion.span
                        aria-hidden="true"
                        className="absolute inset-0 -z-10 rounded-[var(--radius-xl)] bg-secondary"
                        layoutId="primary-navigation-mobile"
                        transition={navigationTransition}
                      />
                    ) : null}
                    <Icon aria-hidden="true" className="relative size-4" />
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

        {/* Starting a trip is the one thing a traveller does from anywhere, so it
            sits in the middle of the bar rather than behind a destination. It is
            a link because it goes somewhere; /trips already reads and clears the
            create parameter, so nothing new happens here. It stays outside the
            nav landmark because it is an action, not a fifth destination. */}
        <Link
          aria-label={t('createTrip')}
          className="absolute -top-6 left-1/2 flex size-14 -translate-x-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[var(--shadow-surface)] ring-4 ring-background transition-[background-color,translate] duration-[var(--motion-standard)] ease-[var(--ease-standard)] hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:translate-y-px"
          href="/trips?create=1"
        >
          <Plus aria-hidden="true" className="size-6" />
        </Link>
      </div>
    </div>
  );
}
