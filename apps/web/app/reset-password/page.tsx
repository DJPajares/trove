import { getTranslations } from 'next-intl/server';

import { AuthPanel } from '@/components/auth-panel';
import { AuthLinkError } from '@/components/auth-link-error';
import { PasswordResetForm } from '@/components/password-reset-form';
import { getSafeRedirectPath } from '@/lib/auth/redirect';
import { getValidatedAuthIdentity } from '@/lib/auth/recovery';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export default async function ResetPasswordPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ next?: string }>;
}>) {
  const [{ next }, t, supabase] = await Promise.all([
    searchParams,
    getTranslations('auth'),
    createServerSupabaseClient(),
  ]);
  const nextPath = getSafeRedirectPath(next);
  let identity = null;
  let error: 'configurationError' | 'invalidLink' | 'networkError' = supabase
    ? 'invalidLink'
    : 'configurationError';
  try {
    if (supabase) identity = (await getValidatedAuthIdentity(supabase))?.recovery ?? null;
  } catch {
    error = 'networkError';
  }
  return (
    <AuthPanel title={t('resetTitle')} description={t('resetDescription')}>
      {identity ? (
        <PasswordResetForm identity={identity} next={nextPath} />
      ) : (
        <AuthLinkError error={error} recovery next={nextPath} />
      )}
    </AuthPanel>
  );
}
