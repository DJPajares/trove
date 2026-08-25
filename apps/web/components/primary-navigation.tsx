'use client';

import { Bookmark, Ellipsis, House, MapPinned, Plus, Wrench } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type ComponentType } from 'react';

import { AccountMenu } from '@/components/account-menu';
import { AppearanceMenu } from '@/components/appearance-menu';
import { GlobalSearch } from '@/components/global-search';
import { NotificationCenter } from '@/components/notification-center';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { navigationTransition } from '@/lib/motion';

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

function isActivePath(pathname: string, href: string) {
  return href === '/' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

function MobileMoreMenu({ active }: Readonly<{ active: boolean }>) {
  const t = useTranslations('navigation');
  const [open, setOpen] = useState(false);

  return (
    <Sheet onOpenChange={setOpen} open={open}>
      <SheetTrigger
        render={
          <button
            aria-label={t('more')}
            className={cn(
              'relative isolate flex min-h-12 w-full min-w-0 flex-col items-center justify-center gap-1 rounded-[var(--radius-md)] px-1 py-1.5 text-xs font-medium transition-colors duration-[var(--motion-standard)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
            type="button"
          />
        }
      >
        {active ? (
          <motion.span
            aria-hidden="true"
            className="absolute inset-0 -z-10 rounded-[var(--radius-xl)] bg-secondary"
            layoutId="primary-navigation-mobile"
            transition={navigationTransition}
          />
        ) : null}
        <Ellipsis aria-hidden="true" className="relative size-4" />
        <span className="relative max-w-full truncate">{t('more')}</span>
      </SheetTrigger>

      <SheetContent closeLabel={t('closeMore')}>
        <SheetHeader>
          <SheetTitle>{t('more')}</SheetTitle>
          <SheetDescription>{t('moreDescription')}</SheetDescription>
        </SheetHeader>
        <div className="grid gap-1 px-5 pb-6">
          <Link
            className="flex min-h-12 items-center justify-between rounded-[var(--radius-md)] px-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            href="/tools"
            onClick={() => setOpen(false)}
          >
            <span>{t('tools')}</span>
            <Wrench aria-hidden="true" className="size-4 text-muted-foreground" />
          </Link>
          <div className="flex min-h-12 items-center justify-between rounded-[var(--radius-md)] px-3">
            <span className="text-sm font-medium">{t('search')}</span>
            <GlobalSearch />
          </div>
          <div className="flex min-h-12 items-center justify-between rounded-[var(--radius-md)] px-3">
            <span className="text-sm font-medium">{t('notifications')}</span>
            <NotificationCenter />
          </div>
          <div className="flex min-h-12 items-center justify-between rounded-[var(--radius-md)] px-3">
            <span className="text-sm font-medium">{t('appearance')}</span>
            <AppearanceMenu />
          </div>
          <div className="flex min-h-12 items-center justify-between rounded-[var(--radius-md)] px-3">
            <span className="text-sm font-medium">{t('account')}</span>
            <AccountMenu />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function PrimaryNavigation({ variant }: Readonly<PrimaryNavigationProps>) {
  const pathname = usePathname();
  const t = useTranslations('navigation');
  const items: NavigationItem[] = [
    { column: 'col-start-1', href: '/', icon: House, label: t('home') },
    { column: 'col-start-2', href: '/trips', icon: MapPinned, label: t('trips') },
    { column: 'col-start-4', href: '/saved', icon: Bookmark, label: t('saved') },
    { column: 'col-start-5', href: '/tools', icon: Wrench, label: t('tools') },
  ];

  if (variant === 'desktop') {
    return (
      <nav aria-label={t('primary')} className="hidden items-center gap-1 md:flex">
        {items.map(({ href, label }) => {
          const active = isActivePath(pathname, href);

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
            {items
              .filter(({ href }) => href !== '/tools')
              .map(({ column, href, icon: Icon, label }) => {
                const active = isActivePath(pathname, href);

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
              <MobileMoreMenu
                active={isActivePath(pathname, '/tools') || isActivePath(pathname, '/profile')}
              />
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
