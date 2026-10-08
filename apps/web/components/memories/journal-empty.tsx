'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import type { Trip } from '@/lib/trips/api';

/**
 * A journal with nothing in it yet still reads as a page someone meant to
 * keep (PRD 31.2): one quiet line about what will gather here, and the way to
 * begin. Before the trip it says the journal opens with the trip; once the trip
 * is under way or over, it offers the first memory.
 */
export function JournalEmpty({
  lifecycle,
  onAdd,
}: Readonly<{ lifecycle: Trip['lifecycle']; onAdd: () => void }>) {
  const t = useTranslations('memories.journal');

  return (
    <section
      aria-labelledby="journal-empty-title"
      className="mx-auto flex max-w-md flex-col items-center gap-5 py-6 text-center"
    >
      <h2
        className="font-journal text-[2.25rem] leading-tight font-normal text-foreground italic"
        id="journal-empty-title"
      >
        {t('emptyTitle')}
      </h2>
      <p className="text-base leading-7 text-pretty text-muted-foreground">
        {lifecycle === 'planning' ? t('emptyBefore') : t('emptyAfter')}
      </p>
      <Button className="rounded-full px-5" onClick={onAdd} type="button">
        <Plus aria-hidden="true" data-icon="inline-start" />
        {t('addFirstMemory')}
      </Button>
    </section>
  );
}
