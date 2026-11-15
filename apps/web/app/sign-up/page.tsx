import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { AuthShell } from '@/components/auth-shell';
import { EmailAuthForm } from '@/components/email-auth-form';
import { Button } from '@/components/ui/button';
import { isSignUpEnabled } from '@/lib/auth/config.server';
import { getSafeRedirectPath, withAuthNext } from '@/lib/auth/redirect';

type SignUpPageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function SignUpPage({ searchParams }: Readonly<SignUpPageProps>) {
  const [{ next }, t] = await Promise.all([searchParams, getTranslations('auth')]);
  const signInHref = withAuthNext('/sign-in', getSafeRedirectPath(next));
  const em = (chunks: React.ReactNode) => <em>{chunks}</em>;

  // With sign-ups closed the page keeps its frame and says so on the
  // photograph, and its one way forward is signing in to an existing account.
  if (!isSignUpEnabled()) {
    return (
      <AuthShell
        formDescription={t('signUpClosedFormDescription')}
        formTitle={t('alreadyHaveAccount')}
        lead={t('signUpClosedDescription')}
        title={t.rich('signUpClosedTitle', { em })}
      >
        <Button
          className="w-full"
          nativeButton={false}
          render={<Link href={signInHref} />}
          size="lg"
        >
          {t('signIn')}
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      formDescription={t('signUpFormDescription')}
      formTitle={t('signUpFormTitle')}
      lead={t('signUpDescription')}
      title={t.rich('signUpTitle', { em })}
    >
      <EmailAuthForm mode="sign-up" nextPath={getSafeRedirectPath(next)} />
      <p className="text-center text-sm text-muted-foreground">
        {t('alreadyHaveAccount')}{' '}
        <Link
          className="font-medium text-foreground underline underline-offset-4 transition-colors duration-[var(--motion-standard)] hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          href={signInHref}
        >
          {t('signIn')}
        </Link>
      </p>
    </AuthShell>
  );
}
