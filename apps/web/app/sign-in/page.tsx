import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { AuthShell } from '@/components/auth-shell';
import { BrandMark } from '@/components/brand-logo';
import { EmailAuthForm } from '@/components/email-auth-form';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { getSafeRedirectPath } from '@/lib/auth/redirect';
import { isSignUpEnabled } from '@/lib/auth/config.server';

type SignInPageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function SignInPage({ searchParams }: Readonly<SignInPageProps>) {
  const [{ next }, t] = await Promise.all([searchParams, getTranslations('auth')]);
  const signUpEnabled = isSignUpEnabled();

  return (
    <AuthShell headingId="sign-in-heading">
      <Card className="w-full max-w-md sm:[--card-spacing:--spacing(6)]">
        <CardHeader>
          <BrandMark className="mb-4 size-11 shadow-[var(--shadow-control)]" presentation="tile" />
          <p className="text-sm font-medium tracking-[0.01em] text-brand">{t('eyebrow')}</p>
          <h1
            className="mt-2 text-[clamp(1.75rem,5vw,2rem)] leading-tight font-semibold tracking-[-0.025em] text-pretty text-foreground"
            id="sign-in-heading"
          >
            {t('signInTitle')}
          </h1>
          <p className="mt-2 text-base leading-7 text-pretty text-muted-foreground">
            {t('signInDescription')}
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <EmailAuthForm mode="sign-in" nextPath={getSafeRedirectPath(next)} />
          {signUpEnabled ? (
            <p className="text-center text-sm text-muted-foreground">
              {t('newToTrove')}{' '}
              <Link
                className="font-medium text-foreground underline underline-offset-4 transition-colors duration-[var(--motion-standard)] hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                href="/sign-up"
              >
                {t('createAccount')}
              </Link>
            </p>
          ) : null}
        </CardContent>
      </Card>
    </AuthShell>
  );
}
