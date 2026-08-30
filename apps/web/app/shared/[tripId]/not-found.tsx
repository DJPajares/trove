import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { Button } from '@/components/ui/button';

/**
 * Deliberately says nothing about which of the reasons applies. A link that was
 * turned off and a trip that never existed read identically, so a visitor cannot
 * use this page to find out which trips are real.
 */
export default async function SharedTripNotFound() {
  const t = await getTranslations('sharedTrip');

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
