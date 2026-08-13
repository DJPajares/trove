'use client';

import type { User } from '@supabase/supabase-js';
import { LogOut, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

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
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useSignOut } from '@/lib/auth/use-sign-out';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

export function PrivacySecuritySettings() {
  const t = useTranslations('privacySecurity');

  return (
    <section aria-labelledby="privacy-security-heading" className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground" id="privacy-security-heading">
          {t('title')}
        </h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{t('description')}</p>
      </div>

      <div className="flex gap-3 rounded-[var(--radius-md)] border border-border p-4">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-status-success" />
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">{t('privateByDefaultTitle')}</p>
          <ul className="space-y-1.5 text-sm leading-6 text-muted-foreground">
            <li>{t('ownerOnly')}</li>
            <li>{t('privateMedia')}</li>
            <li>{t('sharedPlaces')}</li>
          </ul>
        </div>
      </div>

      <p className="text-xs leading-5 text-text-subtle">{t('futureSharingNote')}</p>
    </section>
  );
}

export function AccountSettings() {
  const t = useTranslations('accountSettings');
  const account = useTranslations('account');
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

  return (
    <section aria-labelledby="account-settings-heading" className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground" id="account-settings-heading">
          {t('title')}
        </h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{t('description')}</p>
      </div>

      <div className="rounded-[var(--radius-md)] border border-border p-4">
        <p className="text-xs font-medium text-muted-foreground">{t('signedInAs')}</p>
        {isReady ? (
          <p className="mt-1 truncate text-sm font-medium text-foreground">
            {user?.email ?? t('noAccount')}
          </p>
        ) : (
          <Skeleton className="mt-2 h-4 w-48 motion-reduce:animate-none" />
        )}
      </div>

      <p className="text-sm leading-6 text-muted-foreground">{t('signOutNote')}</p>

      {hasSignOutError ? (
        <p className="text-sm leading-6 text-destructive" role="alert">
          {account('signOutError')}
        </p>
      ) : null}

      <Button
        disabled={!user || isSigningOut}
        onClick={() => void requestSignOut()}
        variant="outline"
      >
        <LogOut aria-hidden="true" data-icon="inline-start" />
        {isSigningOut ? account('signingOut') : account('signOut')}
      </Button>

      <AlertDialog onOpenChange={setShowUnsyncedWarning} open={showUnsyncedWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{account('unsyncedSignOutTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{account('unsyncedSignOutDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{account('keepSignedIn')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isSigningOut}
              onClick={() => void signOut()}
              variant="destructive"
            >
              {isSigningOut ? account('signingOut') : account('discardAndSignOut')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
