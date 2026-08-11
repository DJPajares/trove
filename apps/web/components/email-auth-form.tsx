'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { FormEvent } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
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
    <form className="space-y-6" onSubmit={handleSubmit}>
      {error ? (
        <Alert role="alert" variant="destructive">
          <AlertDescription className="text-destructive">{error}</AlertDescription>
        </Alert>
      ) : null}
      {confirmationSent ? (
        <Alert aria-live="polite" role="status" variant="success">
          <AlertDescription className="text-foreground">{t('confirmationSent')}</AlertDescription>
        </Alert>
      ) : null}

      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="auth-email">{t('email')}</FieldLabel>
          <Input
            autoComplete="email"
            id="auth-email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="auth-password">{t('password')}</FieldLabel>
          <Input
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            id="auth-password"
            minLength={6}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </Field>

        {isSignUp ? (
          <Field>
            <FieldLabel htmlFor="auth-confirmation">{t('confirmPassword')}</FieldLabel>
            <Input
              autoComplete="new-password"
              id="auth-confirmation"
              minLength={6}
              onChange={(event) => setConfirmation(event.target.value)}
              required
              type="password"
              value={confirmation}
            />
          </Field>
        ) : null}
      </FieldGroup>

      <Button className="w-full" disabled={isPending} size="lg" type="submit">
        {isPending ? (isSignUp ? t('pendingSignUp') : t('pendingSignIn')) : t(mode)}
      </Button>
    </form>
  );
}
