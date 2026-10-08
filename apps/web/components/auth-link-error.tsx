'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { withAuthNext } from '@/lib/auth/redirect';
import type { EmailLinkError } from '@/lib/auth/email-link';
import * as Icons from '@/lib/icons';

export function AuthLinkError({
  error,
  recovery,
  next,
}: Readonly<{
  error: EmailLinkError;
  recovery: boolean;
  next: string;
}>) {
  const t = useTranslations('auth');
  const href = `${withAuthNext('/forgot-password', next)}${recovery ? '' : '&flow=verification'}`;
  return (
    <div className="space-y-6">
      <Alert role="alert" variant="destructive">
        <Icons.Error aria-hidden="true" />
        <AlertDescription className="text-destructive">{t(error)}</AlertDescription>
      </Alert>
      <Button className="w-full" nativeButton={false} render={<Link href={href} />} size="lg">
        {t(recovery ? 'requestResetLink' : 'requestVerificationLink')}
      </Button>
      <Button
        className="w-full"
        nativeButton={false}
        render={<Link href={withAuthNext('/sign-in', next)} />}
        variant="ghost"
      >
        {t('backToSignIn')}
      </Button>
    </div>
  );
}
