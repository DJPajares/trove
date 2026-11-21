import { Lock } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { PageState } from '@/components/page-state';
import { Button } from '@/components/ui/button';

/** What a traveller sees opening their own public view while their profile is private. */
export async function PrivateProfileForOwner() {
  const t = await getTranslations('publicTraveller.privateOwner');

  return (
    <div className="mx-auto w-full max-w-3xl py-10">
      <PageState
        actions={
          <Button nativeButton={false} render={<Link href="/settings#profile-visibility" />}>
            {t('action')}
          </Button>
        }
        description={t('description')}
        headingLevel={1}
        icon={<Lock aria-hidden="true" />}
        title={t('title')}
      />
    </div>
  );
}
