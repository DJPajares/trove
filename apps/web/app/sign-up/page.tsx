import { UserPlus } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { EmailAuthForm } from '@/components/email-auth-form';
import { getSafeRedirectPath } from '@/lib/auth/redirect';

type SignUpPageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function SignUpPage({ searchParams }: Readonly<SignUpPageProps>) {
  const [{ next }, t] = await Promise.all([searchParams, getTranslations('auth')]);

  return (
    <section
      aria-labelledby="sign-up-heading"
      className="grid min-h-[calc(100svh-8rem)] place-items-center"
    >
      <div className="w-full max-w-md rounded-[var(--radius-2xl)] border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex size-12 items-center justify-center rounded-[var(--radius-lg)] bg-brand/10 text-brand">
          <UserPlus aria-hidden="true" className="size-6" />
        </div>
        <h1 id="sign-up-heading" className="text-3xl font-semibold tracking-tight text-foreground">
          {t('signUpTitle')}
        </h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">{t('signUpDescription')}</p>
        <div className="mt-8">
          <EmailAuthForm mode="sign-up" nextPath={getSafeRedirectPath(next)} />
        </div>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          {t('alreadyHaveAccount')}{' '}
          <Link
            className="font-medium text-foreground underline underline-offset-4"
            href="/sign-in"
          >
            {t('signIn')}
          </Link>
        </p>
      </div>
    </section>
  );
}
