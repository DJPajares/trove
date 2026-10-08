'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { buildEmailRedirectUrl, withAuthNext } from '@/lib/auth/redirect';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

export function EmailLinkRequestForm({
  next,
  verification,
}: Readonly<{ next: string; verification: boolean }>) {
  const t = useTranslations('auth');
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setSent(false);
    const supabase = createBrowserSupabaseClient();
    if (!supabase) {
      setError(t('configurationError'));
      return;
    }
    setPending(true);
    try {
      const redirectTo = buildEmailRedirectUrl(
        window.location.origin,
        next,
        verification ? 'signup' : 'recovery',
      );
      const { error: requestError } = verification
        ? await supabase.auth.resend({
            type: 'signup',
            email: email.trim(),
            options: { emailRedirectTo: redirectTo },
          })
        : await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
      if (requestError) {
        // Do not reveal whether an email belongs to an existing account.
        if (
          requestError.code === 'over_email_send_rate_limit' ||
          requestError.code === 'over_request_rate_limit'
        )
          setError(t('rateLimit'));
        else if (requestError.status === 0 || (requestError.status ?? 400) >= 500)
          setError(t('networkError'));
        else if (
          requestError.code === 'user_not_found' ||
          requestError.code === 'email_not_confirmed'
        )
          setSent(true);
        else setError(t('error'));
      } else setSent(true);
    } catch {
      setError(t('networkError'));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={submit}>
      {error ? (
        <Alert role="alert" variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {sent ? (
        <Alert role="status" aria-live="polite" variant="success">
          <AlertDescription>
            {t(verification ? 'verificationRequested' : 'resetRequested')}
          </AlertDescription>
        </Alert>
      ) : null}
      <Field>
        <FieldLabel htmlFor="link-email">{t('email')}</FieldLabel>
        <Input
          autoComplete="email"
          id="link-email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </Field>
      <Button className="w-full" disabled={pending} size="lg" type="submit">
        {t(pending ? 'sendingLink' : verification ? 'requestVerificationLink' : 'sendResetLink')}
      </Button>
      <Button
        className="w-full"
        nativeButton={false}
        render={<Link href={withAuthNext('/sign-in', next)} />}
        variant="ghost"
      >
        {t('backToSignIn')}
      </Button>
    </form>
  );
}
