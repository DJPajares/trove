import { WifiOff } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

export default async function OfflinePage() {
  const t = await getTranslations('offline');

  return (
    <section
      aria-labelledby="offline-heading"
      className="grid min-h-[calc(100svh-8rem)] place-items-center"
    >
      <div className="w-full max-w-2xl rounded-[var(--radius-2xl)] border border-border bg-card p-6 shadow-sm sm:p-10">
        <div className="mb-8 flex size-12 items-center justify-center rounded-[var(--radius-lg)] bg-brand/10 text-brand">
          <WifiOff aria-hidden="true" className="size-6" />
        </div>
        <p className="mb-3 text-sm font-medium tracking-wide text-brand">{t('eyebrow')}</p>
        <h1
          id="offline-heading"
          className="max-w-xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl"
        >
          {t('title')}
        </h1>
        <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground sm:text-lg">
          {t('description')}
        </p>
      </div>
    </section>
  );
}
