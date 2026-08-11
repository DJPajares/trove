'use client';

import { Bookmark, House, MapPinned, Wrench } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ComponentType } from 'react';

import { cn } from '@/lib/utils';

type NavigationItem = {
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

export function PrimaryNavigation({ variant }: Readonly<PrimaryNavigationProps>) {
  const pathname = usePathname();
  const t = useTranslations('navigation');
  const items: NavigationItem[] = [
    { href: '/', icon: House, label: t('home') },
    { href: '/trips', icon: MapPinned, label: t('trips') },
    { href: '/saved', icon: Bookmark, label: t('saved') },
    { href: '/tools', icon: Wrench, label: t('tools') },
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
                'rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium transition-colors duration-[var(--motion-standard)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                active
                  ? 'bg-secondary text-secondary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
              href={href}
              key={href}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav
      aria-label={t('mobile')}
      className="fixed inset-x-0 bottom-0 z-[var(--layer-sticky)] border-t border-border bg-background/95 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-background/85 md:hidden"
      data-translucent-surface
    >
      <ul className="mx-auto grid max-w-xl grid-cols-4 gap-1">
        {items.map(({ href, icon: Icon, label }) => {
          const active = isActivePath(pathname, href);

          return (
            <li key={href}>
              <Link
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-[var(--radius-md)] px-1 py-1.5 text-xs font-medium transition-colors duration-[var(--motion-standard)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  active
                    ? 'bg-secondary text-secondary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
                href={href}
              >
                <Icon aria-hidden="true" className="size-4" />
                <span className="max-w-full truncate">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
