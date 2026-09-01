import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { AuthShell } from '@/components/auth-shell';
import { BrandMark } from '@/components/brand-logo';
import { EmailAuthForm } from '@/components/email-auth-form';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { getSafeRedirectPath } from '@/lib/auth/redirect';

type SignUpPageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function SignUpPage({ searchParams }: Readonly<SignUpPageProps>) {
  const [{ next }, t] = await Promise.all([searchParams, getTranslations('auth')]);

  return (
    <AuthShell headingId="sign-up-heading">
      <Card className="w-full max-w-md sm:[--card-spacing:--spacing(6)]">
        <CardHeader>
          <BrandMark className="mb-4 size-11 shadow-[var(--shadow-control)]" presentation="tile" />
          <p className="text-sm font-medium tracking-[0.01em] text-brand">{t('eyebrow')}</p>
          <h1
            className="mt-2 text-[clamp(1.75rem,5vw,2rem)] leading-tight font-semibold tracking-[-0.025em] text-pretty text-foreground"
            id="sign-up-heading"
          >
            {t('signUpTitle')}
          </h1>
          <p className="mt-2 text-base leading-7 text-pretty text-muted-foreground">
            {t('signUpDescription')}
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <EmailAuthForm mode="sign-up" nextPath={getSafeRedirectPath(next)} />
          <p className="text-center text-sm text-muted-foreground">
            {t('alreadyHaveAccount')}{' '}
            <Link
              className="font-medium text-foreground underline underline-offset-4 transition-colors duration-[var(--motion-standard)] hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              href="/sign-in"
            >
              {t('signIn')}
            </Link>
          </p>
        </CardContent>
      </Card>
    </AuthShell>
  );
}
