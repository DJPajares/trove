import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { Button } from '@/components/ui/button';

/** One page for every traveller the API will not show, whatever the reason. */
export default async function TravellerNotFound() {
  const t = await getTranslations('publicTraveller');

  return (
    <div className="mx-auto flex max-w-prose flex-col items-start gap-4 py-12">
      <h1 className="text-[length:var(--text-page-title)] leading-[1.08] font-semibold tracking-[-0.035em]">
        {t('notFoundTitle')}
      </h1>
      <p className="text-sm leading-5 text-muted-foreground">{t('notFoundDescription')}</p>
      <Button nativeButton={false} render={<Link href="/" />} size="sm" variant="secondary">
        {t('notFoundAction')}
      </Button>
    </div>
  );
}
