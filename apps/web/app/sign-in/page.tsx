import { LogIn } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { GoogleSignInButton } from '@/components/google-sign-in-button';
import { getSafeRedirectPath } from '@/lib/auth/redirect';

type SignInPageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function SignInPage({ searchParams }: Readonly<SignInPageProps>) {
  const [{ next }, t] = await Promise.all([searchParams, getTranslations('auth')]);

  return (
    <section
      aria-labelledby="sign-in-heading"
      className="grid min-h-[calc(100svh-8rem)] place-items-center"
    >
      <div className="w-full max-w-md rounded-[var(--radius-2xl)] border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex size-12 items-center justify-center rounded-[var(--radius-lg)] bg-brand/10 text-brand">
          <LogIn aria-hidden="true" className="size-6" />
        </div>
        <h1 id="sign-in-heading" className="text-3xl font-semibold tracking-tight text-foreground">
          {t('title')}
        </h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">{t('description')}</p>
        <div className="mt-8">
          <GoogleSignInButton
            errorLabel={t('error')}
            label={t('google')}
            nextPath={getSafeRedirectPath(next)}
            pendingLabel={t('pending')}
          />
        </div>
      </div>
    </section>
  );
}
