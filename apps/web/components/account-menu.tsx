'use client';

import type { User } from '@supabase/supabase-js';
import { LogIn, LogOut, UserPlus, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { signOutFromTrove } from '@/lib/auth/sign-out';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

function getDisplayName(user: User | null, fallback: string) {
  if (!user) return fallback;

  const metadataName = user.user_metadata?.display_name;
  if (typeof metadataName === 'string' && metadataName.trim()) {
    return metadataName.trim();
  }

  return user.email ?? fallback;
}

export function AccountMenu() {
  const t = useTranslations('account');
  const [user, setUser] = useState<User | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [hasSignOutError, setHasSignOutError] = useState(false);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();

    if (!supabase) {
      setIsReady(true);
      return;
    }

    let active = true;

    void supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      setUser(data.user);
      setIsReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setIsReady(true);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleSignOut() {
    setHasSignOutError(false);
    setIsSigningOut(true);

    try {
      await signOutFromTrove();
      setUser(null);
    } catch {
      setHasSignOutError(true);
    } finally {
      setIsSigningOut(false);
    }
  }

  const displayName = getDisplayName(user, t('signedOut'));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button aria-label={t('button')} size="icon" type="button" variant="ghost" />}
      >
        <UserRound aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 py-2">
            <span className="block truncate text-sm font-semibold text-foreground">
              {displayName}
            </span>
            {isReady && user?.email ? (
              <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">
                {user.email}
              </span>
            ) : null}
          </DropdownMenuLabel>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        {user ? (
          <>
            <DropdownMenuLinkItem render={<Link href="/profile" />}>
              <UserRound aria-hidden="true" className="size-4" />
              {t('profile')}
            </DropdownMenuLinkItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={isSigningOut} onClick={handleSignOut} variant="destructive">
              <LogOut aria-hidden="true" className="size-4" />
              {isSigningOut ? t('signingOut') : t('signOut')}
            </DropdownMenuItem>
            {hasSignOutError ? (
              <p className="px-2 py-1 text-xs text-destructive" role="alert">
                {t('signOutError')}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <DropdownMenuLinkItem render={<Link href="/sign-in" />}>
              <LogIn aria-hidden="true" className="size-4" />
              {t('signIn')}
            </DropdownMenuLinkItem>
            <DropdownMenuLinkItem render={<Link href="/sign-up" />}>
              <UserPlus aria-hidden="true" className="size-4" />
              {t('signUp')}
            </DropdownMenuLinkItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
