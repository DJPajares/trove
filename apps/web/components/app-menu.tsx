'use client';

import { ArrowLeftRight, ChevronRight, ClipboardCheck, Ellipsis, Menu, X } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { AccountMenu } from '@/components/account-menu';
import { AppearanceToggle } from '@/components/appearance-toggle';
import { GlobalSearch } from '@/components/global-search';
import { NotificationCenter } from '@/components/notification-center';
import { useNotifications } from '@/components/notifications-provider';
import { usePreferences } from '@/components/preferences-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { navigationTransition } from '@/lib/motion';
import { isNavigationPathActive, toolNavigationDestinations } from '@/lib/navigation';
import { cn } from '@/lib/utils';

type AppMenuContextValue = {
  closeMenu: () => void;
  unreadCount: number;
};

const AppMenuContext = createContext<AppMenuContextValue | null>(null);

function useAppMenu() {
  const context = useContext(AppMenuContext);
  if (!context) throw new Error('useAppMenu must be used within AppMenuProvider');
  return context;
}

function AppMenuTools({ pathname }: Readonly<{ pathname: string }>) {
  const navigation = useTranslations('navigation');
  const currency = useTranslations('currency');
  const taskTemplates = useTranslations('taskTemplates');
  const { closeMenu } = useAppMenu();
  const details = {
    currency: { icon: ArrowLeftRight, label: currency('title') },
    taskTemplates: { icon: ClipboardCheck, label: taskTemplates('title') },
  };

  return (
    <section aria-labelledby="app-menu-tools-heading" className="space-y-2">
      <h2 className="px-3 text-sm font-semibold text-foreground" id="app-menu-tools-heading">
        {navigation('tools')}
      </h2>
      <nav aria-label={navigation('tools')} className="grid gap-1">
        {toolNavigationDestinations.map(({ href, key }) => {
          const { icon: Icon, label } = details[key];
          const active = isNavigationPathActive(pathname, href);

          return (
            <Link
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-12 items-center justify-between rounded-[var(--radius-md)] px-3 text-sm transition-colors duration-[var(--motion-standard)] hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                active ? 'bg-secondary font-medium text-foreground' : 'text-muted-foreground',
              )}
              href={href}
              key={href}
              onClick={closeMenu}
            >
              <span className="flex items-center gap-3">
                <Icon aria-hidden="true" className="size-4" />
                {label}
              </span>
              <ChevronRight aria-hidden="true" className="size-4" />
            </Link>
          );
        })}
      </nav>
    </section>
  );
}

function AppMenuContent() {
  const t = useTranslations('navigation');
  const appearance = useTranslations('appearance');
  const pathname = usePathname();
  const { closeMenu } = useAppMenu();
  const { appearanceSaveError } = usePreferences();

  return (
    <SheetContent
      className="h-[min(42rem,calc(100dvh-3rem))] gap-0 md:h-full"
      closeLabel={t('closeMenu')}
      keepMounted
      mobileSide="bottom"
      showCloseButton={false}
      side="right"
    >
      <SheetHeader className="gap-0 px-5 pt-7 pb-3 md:px-6 md:pt-6 md:pb-4">
        <SheetTitle className="sr-only">
          <span className="md:hidden">{t('more')}</span>
          <span className="hidden md:inline">{t('menu')}</span>
        </SheetTitle>
        <SheetDescription className="sr-only">{t('menuDescription')}</SheetDescription>
        <div className="flex justify-end">
          <div
            aria-label={t('menuActions')}
            className="flex shrink-0 items-center gap-1"
            role="toolbar"
          >
            <NotificationCenter onNavigate={closeMenu} />
            <AppearanceToggle />
            <AccountMenu onNavigate={closeMenu} />
            <SheetClose
              render={
                <Button
                  aria-label={t('closeMenu')}
                  className="text-foreground"
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                />
              }
            >
              <X aria-hidden="true" />
            </SheetClose>
          </div>
        </div>
      </SheetHeader>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 md:px-6">
        <div className="space-y-2">
          <GlobalSearch onNavigate={closeMenu} triggerVariant="field" />
          {appearanceSaveError ? (
            <p className="px-1 text-xs leading-5 text-destructive" role="status">
              {appearance('unsaved')}
            </p>
          ) : null}
        </div>

        <div className="border-t border-border-subtle pt-5">
          <AppMenuTools pathname={pathname} />
        </div>
      </div>
    </SheetContent>
  );
}

export function AppMenuProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { notifications, status } = useNotifications();
  const [open, setOpen] = useState(false);
  const closeMenu = useCallback(() => setOpen(false), []);
  const unreadCount = status === 'unavailable' ? 0 : notifications.length;
  const value = useMemo(() => ({ closeMenu, unreadCount }), [closeMenu, unreadCount]);

  return (
    <AppMenuContext.Provider value={value}>
      <Sheet onOpenChange={setOpen} open={open}>
        {children}
        <AppMenuContent />
      </Sheet>
    </AppMenuContext.Provider>
  );
}

type AppMenuTriggerProps = {
  active?: boolean;
  variant: 'desktop' | 'mobile';
};

export function AppMenuTrigger({ active = false, variant }: Readonly<AppMenuTriggerProps>) {
  const t = useTranslations('navigation');
  const { unreadCount } = useAppMenu();
  const badge = unreadCount ? (
    <Badge aria-hidden="true" className="absolute top-1 right-1" size="count" variant="solid">
      {unreadCount > 9 ? '9+' : unreadCount}
    </Badge>
  ) : null;

  if (variant === 'desktop') {
    return (
      <SheetTrigger
        render={
          <Button
            aria-label={
              unreadCount ? t('openMenuWithNotifications', { count: unreadCount }) : t('openMenu')
            }
            className="relative"
            size="icon"
            type="button"
            variant="ghost"
          />
        }
      >
        <Menu aria-hidden="true" className="size-5" />
        {badge}
      </SheetTrigger>
    );
  }

  return (
    <SheetTrigger
      render={
        <button
          aria-label={unreadCount ? t('moreWithNotifications', { count: unreadCount }) : t('more')}
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
      <span className="relative">
        <Ellipsis aria-hidden="true" className="size-4" />
        {badge}
      </span>
      <span className="relative max-w-full truncate">{t('more')}</span>
    </SheetTrigger>
  );
}
