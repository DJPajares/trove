'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { getSafeRedirectPath } from '@/lib/auth/redirect';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

type GoogleSignInButtonProps = {
  errorLabel: string;
  label: string;
  nextPath: string;
  pendingLabel: string;
};

export function GoogleSignInButton({
  errorLabel,
  label,
  nextPath,
  pendingLabel,
}: Readonly<GoogleSignInButtonProps>) {
  const [hasError, setHasError] = useState(false);
  const [isPending, setIsPending] = useState(false);

  async function signIn() {
    setHasError(false);
    setIsPending(true);

    const supabase = createBrowserSupabaseClient();

    if (!supabase) {
      setHasError(true);
      setIsPending(false);
      return;
    }

    const callbackUrl = new URL('/auth/callback', window.location.origin);
    callbackUrl.searchParams.set('next', getSafeRedirectPath(nextPath));

    const { error } = await supabase.auth.signInWithOAuth({
      options: { redirectTo: callbackUrl.toString() },
      provider: 'google',
    });

    if (error) {
      setHasError(true);
      setIsPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button className="w-full" disabled={isPending} onClick={signIn} size="lg" type="button">
        {isPending ? pendingLabel : label}
      </Button>
      {hasError ? <p className="text-sm text-destructive">{errorLabel}</p> : null}
    </div>
  );
}
