import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { AuthShell } from '@/components/auth-shell';
import { EmailAuthForm } from '@/components/email-auth-form';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { isSignUpEnabled } from '@/lib/auth/config.server';
import { getSafeRedirectPath, withAuthNext } from '@/lib/auth/redirect';

type SignInPageProps = {
  searchParams: Promise<{ next?: string; error?: string }>;
};

export default async function SignInPage({ searchParams }: Readonly<SignInPageProps>) {
  const [{ next, error }, t] = await Promise.all([searchParams, getTranslations('auth')]);
  const signUpEnabled = isSignUpEnabled();

  return (
    <AuthShell
      formDescription={t('signInFormDescription')}
      formTitle={t('signIn')}
      lead={t('signInDescription')}
      title={t.rich('signInTitle', { em: (chunks) => <em>{chunks}</em> })}
    >
      {error ? (
        <Alert role="alert" variant="destructive">
          <AlertDescription>
            {t(error === 'configuration' ? 'configurationError' : 'invalidLink')}
          </AlertDescription>
        </Alert>
      ) : null}
      <EmailAuthForm mode="sign-in" nextPath={getSafeRedirectPath(next)} />
      {signUpEnabled ? (
        <p className="text-center text-sm text-muted-foreground">
          {t('newToTrove')}{' '}
          <Link
            className="font-medium text-foreground underline underline-offset-4 transition-colors duration-[var(--motion-standard)] hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            href={withAuthNext('/sign-up', getSafeRedirectPath(next))}
          >
            {t('createAccount')}
          </Link>
        </p>
      ) : null}
    </AuthShell>
  );
}
