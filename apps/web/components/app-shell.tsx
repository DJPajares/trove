import { MapPinned } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { AppHeader } from '@/components/app-header';
import { AppearanceToggle } from '@/components/appearance-toggle';
import { DesktopAppHeader } from '@/components/desktop-app-header';
import { FloatingActionStack } from '@/components/floating-action-stack';
import { PageTransition } from '@/components/page-transition';
import { PrimaryActionProvider } from '@/components/primary-action-provider';
import { PrimaryNavigation } from '@/components/primary-navigation';
import { TripCreationProvider } from '@/components/trip-creation-provider';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type AppShellProps = {
  children: ReactNode;
  isSignedIn: boolean;
};

/**
 * Signed out, the global destinations and the account tools all lead back to
 * sign-in, so the shell offers only what a visitor can actually use: the
 * product, its appearance, and the two ways in.
 */
export function AppShell({ children, isSignedIn }: Readonly<AppShellProps>) {
  const app = useTranslations('app');
  const auth = useTranslations('auth');
  const navigation = useTranslations('navigation');

  const headerContent = (
    <div
      className={cn(
        'mx-auto grid h-[var(--header-height)] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 pl-[var(--gutter-inline-start)] pr-[var(--gutter-inline-end)]',
        isSignedIn
          ? 'md:pr-[calc(var(--gutter-inline-end)+3.25rem)]'
          : 'md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]',
      )}
    >
      <Link
        className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground"
        href="/"
      >
        <span className="flex size-8 items-center justify-center rounded-[var(--radius-md)] bg-brand text-primary-foreground shadow-[var(--shadow-control)]">
          <MapPinned aria-hidden="true" className="size-4" />
        </span>
        {app('name')}
      </Link>

      {/* On desktop, destinations sit immediately beside the quick-actions
          trigger. The reserved right padding keeps the two controls distinct. */}
      {isSignedIn ? <PrimaryNavigation variant="desktop" /> : <span className="hidden md:block" />}

      {!isSignedIn ? (
        <div className="flex items-center justify-self-end gap-1">
          <AppearanceToggle />
          {/* On the narrowest screens the wordmark and the primary action
              need the room. Sign in stays one tap away from the landing
              hero and from the sign-up page's own link. */}
          <Button
            className="ml-1 hidden sm:inline-flex"
            nativeButton={false}
            render={<Link href="/sign-in" />}
            size="sm"
            variant="ghost"
          >
            {auth('signIn')}
          </Button>
          <Button
            nativeButton={false}
            render={<Link href="/sign-up" />}
            size="sm"
            variant="default"
          >
            {auth('createAccount')}
          </Button>
        </div>
      ) : null}
    </div>
  );

  const shell = (
    <div
      className={cn(
        'min-h-dvh bg-surface text-foreground',
        isSignedIn && '[--header-offset:0px] md:[--header-offset:var(--header-height)]',
      )}
    >
      <a
        // Parks itself a full height above its own resting offset, so it stays
        // hidden however deep the top inset is rather than peeking under a notch.
        className="fixed top-[calc(0.75rem+var(--safe-top))] left-[calc(0.75rem+var(--safe-left))] z-[calc(var(--layer-overlay)+1)] -translate-y-[calc(100%+0.75rem+var(--safe-top))] rounded-[var(--radius-md)] bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-[var(--shadow-overlay)] transition-transform duration-[var(--motion-standard)] focus:translate-y-0 focus:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        href="#main-content"
      >
        {navigation('skipToContent')}
      </a>

      {isSignedIn ? (
        <DesktopAppHeader>{headerContent}</DesktopAppHeader>
      ) : (
        <AppHeader>{headerContent}</AppHeader>
      )}

      {/* The everyday controls float in the upper right at every signed-in
          viewport. Ahead of the main content in the DOM, which is also where a
          traveller tabbing through the page expects them. */}
      {isSignedIn ? <FloatingActionStack /> : null}

      <main
        className={cn(
          'mx-auto w-full max-w-[var(--layout-app)] scroll-mt-[calc(var(--safe-top)+var(--header-height)+1rem)] py-8 pl-[var(--gutter-inline-start)] pr-[var(--gutter-inline-end)] outline-none md:py-12',
          isSignedIn &&
            'pt-[calc(var(--safe-top)+2rem)] pb-[calc(var(--bottom-bar-height)+var(--safe-bottom)+var(--nav-action-overhang)+0.75rem)] md:py-12',
        )}
        id="main-content"
        tabIndex={-1}
      >
        <PageTransition>{children}</PageTransition>
      </main>

      {isSignedIn ? <PrimaryNavigation variant="mobile" /> : null}
    </div>
  );

  // The registry sits inside trip creation because the bottom bar falls back to
  // it: a screen that claims the create button borrows it, and everything else
  // still starts a trip with it.
  return (
    <TripCreationProvider enabled={isSignedIn}>
      <PrimaryActionProvider>{shell}</PrimaryActionProvider>
    </TripCreationProvider>
  );
}
