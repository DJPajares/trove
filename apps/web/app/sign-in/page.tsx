import { MapPinned } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { EmailAuthForm } from '@/components/email-auth-form';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { getSafeRedirectPath } from '@/lib/auth/redirect';

type SignInPageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function SignInPage({ searchParams }: Readonly<SignInPageProps>) {
  const [{ next }, t] = await Promise.all([searchParams, getTranslations('auth')]);

  return (
    <section
      aria-labelledby="sign-in-heading"
      className="grid min-h-[calc(100dvh-12rem)] place-items-center"
    >
      <Card className="w-full max-w-md sm:[--card-spacing:--spacing(6)]">
        <CardHeader>
          <div className="mb-4 flex size-11 items-center justify-center rounded-[var(--radius-md)] bg-brand text-primary-foreground shadow-[var(--shadow-control)]">
            <MapPinned aria-hidden="true" className="size-5" />
          </div>
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
          <p className="text-center text-sm text-muted-foreground">
            {t('newToTrove')}{' '}
            <Link
              className="font-medium text-foreground underline underline-offset-4 transition-colors duration-[var(--motion-standard)] hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              href="/sign-up"
            >
              {t('createAccount')}
            </Link>
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
