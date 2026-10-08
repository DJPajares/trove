'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';

import { AuthLinkError } from '@/components/auth-link-error';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { RecoveryIdentity } from '@/lib/auth/recovery';
import type { EmailLinkError } from '@/lib/auth/email-link';

type ResetError =
  | EmailLinkError
  | 'passwordTooShort'
  | 'passwordMismatch'
  | 'samePassword'
  | 'weakPassword'
  | 'rateLimit'
  | 'resetError';

export function PasswordResetForm({
  identity,
  next,
}: Readonly<{ identity: RecoveryIdentity; next: string }>) {
  const t = useTranslations('auth');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ResetError | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || done) return;
    setError(null);
    if (password.length < 6) {
      setError('passwordTooShort');
      return;
    }
    if (password !== confirmation) {
      setError('passwordMismatch');
      return;
    }
    setPending(true);
    try {
      const response = await fetch('/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          userId: identity.userId,
          sessionId: identity.sessionId,
          password,
          confirmation,
          next,
        }),
      });
      const result = (await response.json()) as { error?: ResetError; redirect?: string };
      if (!response.ok || !result.redirect) {
        setError(result.error ?? 'resetError');
        return;
      }
      setPassword('');
      setConfirmation('');
      setDone(true);
    } catch {
      setError('networkError');
    } finally {
      setPending(false);
    }
  }

  if (error === 'invalidLink' || error === 'expiredLink')
    return <AuthLinkError error={error} recovery next={next} />;
  if (done)
    return (
      <div className="space-y-6">
        <Alert role="status" aria-live="polite" variant="success">
          <AlertDescription>{t('passwordUpdated')}</AlertDescription>
        </Alert>
        <Button
          className="w-full"
          onClick={() => window.location.replace(next)}
          size="lg"
          type="button"
        >
          {t('continueToTrove')}
        </Button>
      </div>
    );
  return (
    <form className="space-y-6" onSubmit={submit}>
      <p className="text-sm text-muted-foreground">
        {t('resetAccount', { email: identity.email })}
      </p>
      {error ? (
        <Alert role="alert" variant="destructive">
          <AlertDescription>{t(error)}</AlertDescription>
        </Alert>
      ) : null}
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="reset-password">{t('newPassword')}</FieldLabel>
          <Input
            autoComplete="new-password"
            id="reset-password"
            minLength={6}
            maxLength={1024}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="reset-confirmation">{t('confirmPassword')}</FieldLabel>
          <Input
            autoComplete="new-password"
            id="reset-confirmation"
            minLength={6}
            maxLength={1024}
            onChange={(event) => setConfirmation(event.target.value)}
            required
            type="password"
            value={confirmation}
          />
        </Field>
      </FieldGroup>
      <Button className="w-full" disabled={pending} size="lg" type="submit">
        {t(pending ? 'updatingPassword' : 'updatePassword')}
      </Button>
    </form>
  );
}
