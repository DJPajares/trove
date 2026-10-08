import { getTranslations } from 'next-intl/server';

import { AuthPanel } from '@/components/auth-panel';
import { AuthLinkConfirmation } from '@/components/auth-link-confirmation';

export default async function ConfirmEmailPage() {
  const t = await getTranslations('auth');
  return (
    <AuthPanel title={t('confirmLinkTitle')} description={t('confirmLinkDescription')}>
      <AuthLinkConfirmation />
    </AuthPanel>
  );
}
