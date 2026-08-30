'use client';

import type { User } from '@supabase/supabase-js';
import { LogIn, LogOut, UserPlus, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { usePreferences } from '@/components/preferences-provider';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
import { useSignOut } from '@/lib/auth/use-sign-out';
import { floatingActionTriggerClass } from '@/lib/shell/floating-actions';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

function getDisplayName(
  user: User | null,
  profileName: string | null | undefined,
  fallback: string,
) {
  if (!user) return fallback;

  if (profileName?.trim()) return profileName.trim();

  const metadataName = user.user_metadata?.display_name;
  if (typeof metadataName === 'string' && metadataName.trim()) {
    return metadataName.trim();
  }

  return user.email ?? fallback;
}

type AccountMenuProps = {
  onNavigate?: () => void;
  triggerVariant?: 'floating' | 'icon';
};

export function AccountMenu({
  onNavigate,
  triggerVariant = 'icon',
}: Readonly<AccountMenuProps> = {}) {
  const t = useTranslations('account');
  const { profile } = usePreferences();
  const floating = triggerVariant === 'floating';
  const [user, setUser] = useState<User | null>(null);
  const [isReady, setIsReady] = useState(false);
  const {
    hasSignOutError,
    isSigningOut,
    requestSignOut,
    setShowUnsyncedWarning,
    showUnsyncedWarning,
    signOut,
  } = useSignOut(user?.id);

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
    if (await signOut()) {
      setUser(null);
      onNavigate?.();
    }
  }

  async function handleRequestSignOut() {
    if (await requestSignOut()) {
      setUser(null);
      onNavigate?.();
    }
  }

  const displayName = getDisplayName(user, profile?.displayName, t('signedOut'));
  const email =
    isReady && user?.email?.trim().toLocaleLowerCase() !== displayName.trim().toLocaleLowerCase()
      ? user?.email
      : null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={t('button')}
              className={cn('text-foreground', floating && floatingActionTriggerClass)}
              data-translucent-surface={floating ? '' : undefined}
              size={floating ? 'icon' : 'icon-sm'}
              type="button"
              variant="ghost"
            />
          }
        >
          <UserRound aria-hidden="true" className={floating ? 'size-5' : 'size-4'} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-2 py-2 tracking-normal normal-case">
              <span className="block truncate text-sm font-semibold text-foreground">
                {displayName}
              </span>
              {email ? (
                <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">
                  {email}
                </span>
              ) : null}
            </DropdownMenuLabel>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          {user ? (
            <>
              <DropdownMenuLinkItem render={<Link href="/profile" onClick={onNavigate} />}>
                <UserRound aria-hidden="true" className="size-4" />
                {t('profile')}
              </DropdownMenuLinkItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={isSigningOut}
                onClick={() => void handleRequestSignOut()}
                variant="destructive"
              >
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
              <DropdownMenuLinkItem render={<Link href="/sign-in" onClick={onNavigate} />}>
                <LogIn aria-hidden="true" className="size-4" />
                {t('signIn')}
              </DropdownMenuLinkItem>
              <DropdownMenuLinkItem render={<Link href="/sign-up" onClick={onNavigate} />}>
                <UserPlus aria-hidden="true" className="size-4" />
                {t('signUp')}
              </DropdownMenuLinkItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog onOpenChange={setShowUnsyncedWarning} open={showUnsyncedWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('unsyncedSignOutTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('unsyncedSignOutDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('keepSignedIn')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isSigningOut}
              onClick={() => void handleSignOut()}
              variant="destructive"
            >
              {isSigningOut ? t('signingOut') : t('discardAndSignOut')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
