import { MapPinned } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { AccountMenu } from '@/components/account-menu';
import { AppearanceMenu } from '@/components/appearance-menu';
import { PageTransition } from '@/components/page-transition';
import { PrimaryNavigation } from '@/components/primary-navigation';

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const app = useTranslations('app');
  const navigation = useTranslations('navigation');

  return (
    <div className="min-h-dvh bg-surface text-foreground">
      <a
        className="fixed top-3 left-3 z-[calc(var(--layer-overlay)+1)] -translate-y-20 rounded-[var(--radius-md)] bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-[var(--shadow-overlay)] transition-transform duration-[var(--motion-standard)] focus:translate-y-0 focus:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        href="#main-content"
      >
        {navigation('skipToContent')}
      </a>

      <header
        className="sticky top-0 z-[var(--layer-sticky)] border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85"
        data-translucent-surface
      >
        <div className="mx-auto grid h-16 w-full max-w-[1400px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-[var(--layout-gutter)] md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <Link
            className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground"
            href="/"
          >
            <span className="flex size-8 items-center justify-center rounded-[var(--radius-md)] bg-brand text-primary-foreground shadow-[var(--shadow-control)]">
              <MapPinned aria-hidden="true" className="size-4" />
            </span>
            {app('name')}
          </Link>

          <PrimaryNavigation variant="desktop" />

          <div className="flex items-center justify-self-end gap-1">
            <AppearanceMenu />
            <AccountMenu />
          </div>
        </div>
      </header>

      <main
        className="mx-auto w-full max-w-[1400px] scroll-mt-20 px-[var(--layout-gutter)] py-8 pb-28 outline-none md:py-12 md:pb-12"
        id="main-content"
        tabIndex={-1}
      >
        <PageTransition>{children}</PageTransition>
      </main>

      <PrimaryNavigation variant="mobile" />
    </div>
  );
}
