'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import * as Icons from '@/lib/icons';

const TENSES = [
  { icon: Icons.Itinerary, key: 'plan' },
  { icon: Icons.TripMode, key: 'live' },
  { icon: Icons.Memories, key: 'remember' },
] as const;

/**
 * A traveller with no trips yet. Rather than a lone button, it shows what this
 * page becomes - the three tenses Trove is built around, in the order the
 * library will hold them - so the first trip has somewhere to go.
 */
export function LibraryEmpty({ onCreateTrip }: Readonly<{ onCreateTrip: () => void }>) {
  const t = useTranslations('trips');
  const libraryT = useTranslations('trips.library.empty');

  return (
    <section
      aria-labelledby="library-empty-heading"
      className="overflow-hidden rounded-[var(--radius-2xl)] border border-border-subtle bg-card shadow-[var(--shadow-card)]"
      data-slot="library-empty"
    >
      <div className="space-y-4 p-6 sm:p-10">
        <h2
          className="max-w-[16ch] text-[length:var(--text-page-title)] leading-[1.06] font-semibold tracking-[-0.035em] text-balance text-foreground"
          id="library-empty-heading"
        >
          {t('emptyTitle')}
        </h2>
        <p className="max-w-[var(--layout-reading)] text-base leading-[1.65] text-muted-foreground">
          {t('emptyDescription')}
        </p>
        <Button className="mt-2" onClick={onCreateTrip}>
          <Plus aria-hidden="true" data-icon="inline-start" />
          {t('createFirstTrip')}
        </Button>
      </div>
      <ol className="grid border-t border-border-subtle sm:grid-cols-3 sm:divide-x sm:divide-border-subtle">
        {TENSES.map(({ icon: Icon, key }) => (
          <li
            className="flex gap-3 border-border-subtle p-5 not-first:border-t sm:p-6 sm:not-first:border-t-0"
            key={key}
          >
            <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand" />
            <div className="min-w-0">
              <p className="font-semibold text-foreground">{libraryT(`${key}.title`)}</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {libraryT(`${key}.description`)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Every trip finished and nothing planned. The space the next trip would lead
 * from asks where to, and the journeys already taken follow beneath it.
 */
export function LibraryNothingAhead({ onCreateTrip }: Readonly<{ onCreateTrip: () => void }>) {
  const t = useTranslations('trips.library.nothingAhead');

  return (
    <section
      aria-labelledby="library-nothing-ahead-heading"
      className="flex flex-col gap-5 rounded-[var(--radius-2xl)] border border-dashed border-border-strong p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8"
      data-slot="library-nothing-ahead"
    >
      <div className="min-w-0 space-y-1.5">
        <h2
          className="text-[length:var(--text-section-title)] leading-[1.18] font-semibold tracking-[-0.022em] text-foreground"
          id="library-nothing-ahead-heading"
        >
          {t('title')}
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">{t('description')}</p>
      </div>
      <Button className="shrink-0 self-start sm:self-auto" onClick={onCreateTrip}>
        <Plus aria-hidden="true" data-icon="inline-start" />
        {t('action')}
      </Button>
    </section>
  );
}
