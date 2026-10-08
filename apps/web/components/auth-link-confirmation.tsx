'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { AuthLinkError } from '@/components/auth-link-error';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { parseEmailLink, type EmailLink, type EmailLinkError } from '@/lib/auth/email-link';
import { getSafeRedirectPath, withAuthNext } from '@/lib/auth/redirect';
import { clearLocalPrivateData } from '@/lib/auth/sign-out';
import { createBrowserSupabaseClient, getBrowserSession } from '@/lib/supabase/client';
import { getRememberedOfflineUser } from '@/lib/offline/trip-store';

export function AuthLinkConfirmation() {
  const t = useTranslations('auth');
  const captured = useRef(false);
  const established = useRef<{
    redirect: string;
    userId: string;
    session: { access_token: string; refresh_token: string };
  } | null>(null);
  const [link, setLink] = useState<EmailLink | null>(null);
  const [error, setError] = useState<EmailLinkError | null>(null);
  const [context, setContext] = useState({ next: '/', recovery: false });
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (captured.current) return;
    captured.current = true;
    const url = new URL(window.location.href);
    const next = getSafeRedirectPath(url.searchParams.get('next'));
    const recovery =
      url.searchParams.get('flow') === 'recovery' ||
      url.searchParams.get('type') === 'recovery' ||
      new URLSearchParams(url.hash.slice(1)).get('type') === 'recovery';
    setContext({ next, recovery });
    const result = parseEmailLink(url);
    // Keep secrets only in this mounted form's memory, out of history/referrers.
    window.history.replaceState(
      window.history.state,
      '',
      `${withAuthNext(url.pathname, next)}&flow=${recovery ? 'recovery' : 'signup'}`,
    );
    if ('link' in result) setLink(result.link);
    else setError(result.error);
  }, []);

  async function confirm() {
    if (!link || pending) return;
    setPending(true);
    setError(null);
    try {
      const previous = await getBrowserSession();
      if (!established.current) {
        const response = await fetch('/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(link),
          cache: 'no-store',
        });
        const result = (await response.json()) as {
          error?: EmailLinkError;
          redirect?: string;
          userId?: string;
          session?: { access_token: string; refresh_token: string };
        };
        if (!response.ok || !result.redirect || !result.userId || !result.session) {
          setError(result.error ?? 'invalidLink');
          return;
        }
        established.current = {
          redirect: result.redirect,
          userId: result.userId,
          session: result.session,
        };
      }
      const result = established.current;
      const supabase = createBrowserSupabaseClient();
      if (!supabase) {
        setError('configurationError');
        return;
      }
      const installed = await supabase.auth.setSession(result.session);
      if (installed.error || installed.data.user?.id !== result.userId) {
        setError(
          installed.error?.status === 0 || (installed.error?.status ?? 400) >= 500
            ? 'networkError'
            : 'invalidLink',
        );
        return;
      }
      const previousUserId = previous?.user.id ?? getRememberedOfflineUser();
      if (previousUserId && previousUserId !== result.userId) await clearLocalPrivateData();
      // Full navigation settles SSR identity and the user-scoped query provider.
      window.location.replace(result.redirect);
    } catch {
      setError('networkError');
    } finally {
      setPending(false);
    }
  }

  if (error && error !== 'networkError') return <AuthLinkError error={error} {...context} />;
  if (!link)
    return (
      <p aria-live="polite" role="status" className="text-sm text-muted-foreground">
        {t('checkingLink')}
      </p>
    );
  return (
    <div className="space-y-6">
      {error ? (
        <Alert role="alert" variant="destructive">
          <AlertDescription>{t(error)}</AlertDescription>
        </Alert>
      ) : null}
      <Button className="w-full" disabled={pending} onClick={confirm} size="lg" type="button">
        {t(pending ? 'confirmingLink' : link.recovery ? 'continueReset' : 'confirmEmail')}
      </Button>
      <p className="text-sm leading-6 text-muted-foreground">{t('confirmationHint')}</p>
    </div>
  );
}
