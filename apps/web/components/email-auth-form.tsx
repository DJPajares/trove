'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { getSafeRedirectPath } from '@/lib/auth/redirect';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

type AuthMode = 'sign-in' | 'sign-up';

type EmailAuthFormProps = {
  mode: AuthMode;
  nextPath: string;
};

export function EmailAuthForm({ mode, nextPath }: Readonly<EmailAuthFormProps>) {
  const t = useTranslations('auth');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);

  const isSignUp = mode === 'sign-up';
  const redirectPath = getSafeRedirectPath(nextPath);
  const fieldClass =
    'mt-2 h-11 w-full rounded-[var(--radius-md)] border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/40';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setConfirmationSent(false);

    if (password.length < 6) {
      setError(t('passwordTooShort'));
      return;
    }

    if (isSignUp && password !== confirmation) {
      setError(t('passwordMismatch'));
      return;
    }

    const supabase = createBrowserSupabaseClient();
    if (!supabase) {
      setError(t('configurationError'));
      return;
    }

    setIsPending(true);

    if (!isSignUp) {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        setError(t('error'));
        setIsPending(false);
        return;
      }

      window.location.assign(redirectPath);
      return;
    }

    const callbackUrl = new URL('/auth/callback', window.location.origin);
    callbackUrl.searchParams.set('next', redirectPath);

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: callbackUrl.toString() },
    });

    if (signUpError) {
      setError(t('error'));
      setIsPending(false);
      return;
    }

    if (data.session) {
      window.location.assign(redirectPath);
      return;
    }

    setConfirmationSent(true);
    setIsPending(false);
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      {error ? (
        <p
          className="rounded-[var(--radius-md)] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {confirmationSent ? (
        <p
          className="rounded-[var(--radius-md)] border border-status-success/30 bg-status-success/10 px-4 py-3 text-sm text-status-success"
          role="status"
        >
          {t('confirmationSent')}
        </p>
      ) : null}

      <label className="block text-sm font-medium" htmlFor="auth-email">
        {t('email')}
        <input
          autoComplete="email"
          className={fieldClass}
          id="auth-email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>

      <label className="block text-sm font-medium" htmlFor="auth-password">
        {t('password')}
        <input
          autoComplete={isSignUp ? 'new-password' : 'current-password'}
          className={fieldClass}
          id="auth-password"
          minLength={6}
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>

      {isSignUp ? (
        <label className="block text-sm font-medium" htmlFor="auth-confirmation">
          {t('confirmPassword')}
          <input
            autoComplete="new-password"
            className={fieldClass}
            id="auth-confirmation"
            minLength={6}
            onChange={(event) => setConfirmation(event.target.value)}
            required
            type="password"
            value={confirmation}
          />
        </label>
      ) : null}

      <Button className="w-full" disabled={isPending} size="lg" type="submit">
        {isPending ? (isSignUp ? t('pendingSignUp') : t('pendingSignIn')) : t(mode)}
      </Button>
    </form>
  );
}
