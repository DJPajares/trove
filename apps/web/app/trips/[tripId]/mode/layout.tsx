import { Suspense, type ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';

import { PageState } from '@/components/page-state';
import { TripModeShell } from '@/components/trip-mode-shell';

export default async function TripModeLayout({
  children,
  params,
}: Readonly<{ children: ReactNode; params: Promise<{ tripId: string }> }>) {
  const { tripId } = await params;
  const t = await getTranslations('tripMode');

  return (
    <Suspense
      fallback={
        <section className="mx-auto w-full max-w-6xl">
          <PageState kind="loading" title={t('loading')} />
        </section>
      }
    >
      <TripModeShell tripId={tripId}>{children}</TripModeShell>
    </Suspense>
  );
}
