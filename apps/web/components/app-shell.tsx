import { Bookmark, House, MapPinned, UserRound, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ComponentType, ReactNode } from 'react';

import { AppearanceMenu } from '@/components/appearance-menu';

type NavigationItem = {
  href: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
};

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const app = useTranslations('app');
  const navigation = useTranslations('navigation');
  const items: NavigationItem[] = [
    { href: '/', icon: House, label: navigation('home') },
    { href: '/trips', icon: MapPinned, label: navigation('trips') },
    { href: '/saved', icon: Bookmark, label: navigation('saved') },
    { href: '/tools', icon: Wrench, label: navigation('tools') },
  ];

  return (
    <div className="min-h-svh bg-surface text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-15 w-full max-w-screen-2xl items-center justify-between px-4 sm:px-6 md:h-16 md:px-8">
          <Link
            className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground"
            href="/"
          >
            <span className="flex size-8 items-center justify-center rounded-[var(--radius-md)] bg-brand text-primary-foreground">
              <MapPinned aria-hidden="true" className="size-4" />
            </span>
            {app('name')}
          </Link>

          <nav aria-label={navigation('primary')} className="hidden items-center gap-1 md:flex">
            {items.map(({ href, label }) => (
              <Link
                key={href}
                className="rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                href={href}
              >
                {label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-1">
            <AppearanceMenu />
            <Link
              aria-label={navigation('profile')}
              className="inline-flex size-8 items-center justify-center rounded-[var(--radius-md)] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              href="/profile"
            >
              <UserRound aria-hidden="true" className="size-4" />
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-screen-2xl px-4 py-6 pb-24 sm:px-6 md:px-8 md:py-10 md:pb-10">
        {children}
      </main>

      <nav
        aria-label={navigation('mobile')}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden"
      >
        <ul className="grid grid-cols-4 gap-1">
          {items.map(({ href, icon: Icon, label }) => (
            <li key={href}>
              <Link
                className="flex min-w-0 flex-col items-center gap-1 rounded-[var(--radius-md)] px-1 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                href={href}
              >
                <Icon aria-hidden="true" className="size-4" />
                <span className="truncate">{label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
