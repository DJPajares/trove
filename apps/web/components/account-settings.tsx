'use client';

import type { User } from '@supabase/supabase-js';
import { CircleAlert, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { EditorialSection } from '@/components/editorial-section';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useSignOut } from '@/lib/auth/use-sign-out';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

export function PrivacySecuritySettings() {
  const t = useTranslations('privacySecurity');

  return (
    <Card className="gap-0 py-0" id="privacy-security">
      <EditorialSection
        className="p-5 sm:p-6"
        description={t('description')}
        headingId="privacy-security-heading"
        icon={<ShieldCheck aria-hidden="true" />}
        title={t('title')}
      >
        <div className="mt-6 space-y-3 border-y border-border py-4">
          <p className="text-sm font-medium text-foreground">{t('privateByDefaultTitle')}</p>
          <ul className="space-y-1.5 text-sm leading-6 text-muted-foreground">
            <li>{t('ownerOnly')}</li>
            <li>{t('privateMedia')}</li>
            <li>{t('sharedPlaces')}</li>
          </ul>
        </div>

        <p className="mt-4 text-xs leading-5 text-text-subtle">{t('futureSharingNote')}</p>
      </EditorialSection>
    </Card>
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

  async function handleRequestSignOut() {
    if (await requestSignOut()) setUser(null);
  }

  async function handleSignOut() {
    if (await signOut()) setUser(null);
  }

  return (
    <Card className="gap-0 py-0" id="account">
      <EditorialSection
        className="p-5 sm:p-6"
        description={t('description')}
        headingId="account-settings-heading"
        icon={<UserRound aria-hidden="true" />}
        title={t('title')}
      >
        {hasSignOutError ? (
          <Alert className="mt-5" role="alert" variant="destructive">
            <CircleAlert aria-hidden="true" />
            <AlertDescription>{account('signOutError')}</AlertDescription>
          </Alert>
        ) : null}

        <div className="mt-6 flex items-center justify-between gap-5 border-y border-border py-4">
          <span>
            <span className="block text-xs font-medium text-muted-foreground">
              {t('signedInAs')}
            </span>
            {isReady ? (
              <span className="mt-1 block truncate text-sm font-medium text-foreground">
                {user?.email ?? t('noAccount')}
              </span>
            ) : (
              <Skeleton className="mt-2 h-4 w-48 motion-reduce:animate-none" />
            )}
          </span>
          <Button
            disabled={!user || isSigningOut}
            onClick={() => void handleRequestSignOut()}
            size="sm"
            variant="outline"
          >
            <LogOut aria-hidden="true" data-icon="inline-start" />
            {isSigningOut ? account('signingOut') : account('signOut')}
          </Button>
        </div>

        <p className="mt-4 text-xs leading-5 text-text-subtle">{t('signOutNote')}</p>
      </EditorialSection>

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
              onClick={() => void handleSignOut()}
              variant="destructive"
            >
              {isSigningOut ? account('signingOut') : account('discardAndSignOut')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
