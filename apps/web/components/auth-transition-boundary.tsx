'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { PageState } from '@/components/page-state';
import { Button } from '@/components/ui/button';
import { signOutFromTrove } from '@/lib/auth/sign-out';
import {
  getAuthTransition,
  getServerAuthTransition,
  subscribeAuthTransition,
} from '@/lib/auth/transition';

/** Keep the departure screen outside protected providers and their cached data. */
export function AuthTransitionBoundary({ children }: Readonly<{ children: ReactNode }>) {
  const state = useSyncExternalStore(
    subscribeAuthTransition,
    getAuthTransition,
    getServerAuthTransition,
  );
  const account = useTranslations('account');
  const app = useTranslations('app');
  const home = useTranslations('home');
  if (state === 'idle' || state === 'sign-out-failed') return children;

  return (
    <main
      className="flex min-h-dvh items-center justify-center bg-surface px-6 text-foreground"
      id="main-content"
    >
      {state === 'cleanup-failed' ? (
        <PageState
          className="max-w-sm"
          kind="error"
          title={account('signOutError')}
          actions={
            <Button onClick={() => void signOutFromTrove().catch(() => undefined)}>
              {home('tryAgain')}
            </Button>
          }
        />
      ) : (
        <div className="w-full max-w-sm">
          <PageState
            kind="loading"
            title={state === 'signing-out' ? account('signingOut') : app('loading')}
          />
          <p className="text-center text-sm text-text-subtle" aria-hidden="true">
            {state === 'signing-out' ? account('signingOut') : app('loading')}
          </p>
        </div>
      )}
    </main>
  );
}
