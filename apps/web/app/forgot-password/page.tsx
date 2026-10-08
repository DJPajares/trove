import { getTranslations } from 'next-intl/server';

import { AuthPanel } from '@/components/auth-panel';
import { EmailLinkRequestForm } from '@/components/email-link-request-form';
import { getSafeRedirectPath } from '@/lib/auth/redirect';

export default async function ForgotPasswordPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ next?: string; flow?: string }>;
}>) {
  const [{ next, flow }, t] = await Promise.all([searchParams, getTranslations('auth')]);
  const verification = flow === 'verification';
  return (
    <AuthPanel
      title={t(verification ? 'resendTitle' : 'forgotTitle')}
      description={t(verification ? 'resendDescription' : 'forgotDescription')}
    >
      <EmailLinkRequestForm next={getSafeRedirectPath(next)} verification={verification} />
    </AuthPanel>
  );
}
