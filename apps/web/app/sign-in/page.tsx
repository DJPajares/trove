import { LogIn } from 'lucide-react';
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
      className="grid min-h-[calc(100dvh-10rem)] place-items-center"
    >
      <Card className="w-full max-w-md sm:[--card-spacing:--spacing(6)]">
        <CardHeader>
          <div className="mb-3 flex size-12 items-center justify-center rounded-[var(--radius-lg)] bg-brand/10 text-brand">
            <LogIn aria-hidden="true" className="size-6" />
          </div>
          <h1
            className="text-3xl leading-tight font-semibold tracking-tight text-pretty text-foreground"
            id="sign-in-heading"
          >
            {t('signInTitle')}
          </h1>
          <p className="mt-1 text-base leading-7 text-pretty text-muted-foreground">
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
