'use client';

import { useTranslations } from 'next-intl';
import type { ComponentProps } from 'react';

import { MemoryContextChip } from '@/components/memories/memory-context';
import { MemoryPrintTray } from '@/components/memories/memory-print-tray';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import * as Icons from '@/lib/icons';
import { cn } from '@/lib/utils';

/**
 * A memory edited as it reads in the journal (PRD 31.2): the photographs as
 * prints, the note written straight onto the page in the journal's hand, then
 * where and when - the journal's quiet context line - as two things to tap.
 * Nothing here decides anything; the editor sheet owns the state and the save.
 */
export function MemoryPage({
  error,
  highlight,
  note,
  onHighlightChange,
  onNoteChange,
  onOpenWhen,
  onOpenWhere,
  prints,
  when,
  where,
}: Readonly<{
  error: string | null;
  highlight: boolean;
  note: string;
  onHighlightChange: (value: boolean) => void;
  onNoteChange: (value: string) => void;
  onOpenWhen: () => void;
  onOpenWhere: () => void;
  prints: ComponentProps<typeof MemoryPrintTray>;
  /** "Mon, Nov 9 · 3:00 PM", or null before there is one. */
  when: string | null;
  /** The stop or Place's name, or null before there is one. */
  where: string | null;
}>) {
  const t = useTranslations('memories.editor');

  return (
    <div className="space-y-5">
      <MemoryPrintTray {...prints} />

      <div>
        <label className="sr-only" htmlFor="memory-editor-note">
          {t('note')}
        </label>
        {/* Written on the page, in the journal's hand: no box around it. */}
        <Textarea
          className="field-sizing-content min-h-24 resize-none rounded-none border-0 border-b border-dashed border-border-subtle bg-transparent px-0 py-2 font-journal text-[1.375rem] leading-[1.4] italic shadow-none placeholder:text-text-subtle focus-visible:border-brand focus-visible:ring-0 md:text-[1.375rem] dark:bg-transparent"
          id="memory-editor-note"
          maxLength={2000}
          onChange={(event) => onNoteChange(event.target.value)}
          placeholder={t('notePlaceholder')}
          rows={2}
          value={note}
        />
      </div>

      <div className="space-y-2">
        <MemoryContextChip
          icon={<Icons.Place />}
          label={t(where ? 'whereChip' : 'whereChipEmpty', { place: where ?? '' })}
          onClick={onOpenWhere}
          placeholder={t('whereEmpty')}
          value={where}
        />
        <MemoryContextChip
          icon={<Icons.Now />}
          label={t(when ? 'whenChip' : 'whenChipEmpty', { when: when ?? '' })}
          onClick={onOpenWhen}
          placeholder={t('whenEmpty')}
          value={when}
        />
      </div>

      <Button
        aria-pressed={highlight}
        className={cn(
          'rounded-full',
          highlight &&
            'border-accent-strong/40 bg-accent-strong/10 text-accent-strong hover:bg-accent-strong/15 hover:text-accent-strong',
        )}
        onClick={() => onHighlightChange(!highlight)}
        size="sm"
        type="button"
        variant="outline"
      >
        <Icons.Highlight aria-hidden="true" data-icon="inline-start" />
        {t(highlight ? 'highlighted' : 'markHighlight')}
      </Button>

      {error ? (
        <Alert variant="destructive">
          <Icons.Error aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
