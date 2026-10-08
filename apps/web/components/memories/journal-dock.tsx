'use client';

import { Ellipsis, ImagePlus, Plus, TableOfContents } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

type JournalActionsProps = {
  hasCover: boolean;
  onAdd: () => void;
  onChooseCover: () => void;
  /** Null while there are no contents to go to: an empty journal has none. */
  onContents: (() => void) | null;
};

/** The journal's options: for now, its cover. */
function JournalStoryMenu({
  className,
  hasCover,
  onChooseCover,
}: Readonly<{ className?: string; hasCover: boolean; onChooseCover: () => void }>) {
  const t = useTranslations('memories.journal');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={t('storyMenu')}
            className={className}
            size="icon"
            type="button"
            variant="ghost"
          />
        }
      >
        <Ellipsis aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuItem onClick={onChooseCover}>
          <ImagePlus aria-hidden="true" />
          {hasCover ? t('changeCover') : t('chooseCover')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The dock: on a phone, where the global bar has stepped aside, the journal's
 * three actions float in the thumb's reach - the contents, adding a memory,
 * and the journal's options. From `lg` the same actions live in the header.
 *
 * Sticky at the end of the journal rather than fixed to the screen: it centres
 * on the journal's own column, so it can never be pushed off the page by a
 * viewport that reports a different width than the page is laid out at.
 */
export function JournalDock({
  hasCover,
  onAdd,
  onChooseCover,
  onContents,
}: Readonly<JournalActionsProps>) {
  const t = useTranslations('memories.journal');

  return (
    <div
      className="pointer-events-none sticky bottom-[calc(var(--safe-bottom)+1rem)] z-[var(--layer-sticky)] mt-6 mb-[calc(var(--safe-bottom)+1rem)] flex justify-center lg:hidden"
      data-slot="journal-dock"
    >
      <div
        className="pointer-events-auto flex items-center gap-1 rounded-full border border-border-subtle bg-paper-print/95 p-1 shadow-[var(--shadow-elevated)] backdrop-blur supports-[backdrop-filter]:bg-paper-print/85"
        data-translucent-surface
      >
        {onContents ? (
          <Button
            aria-label={t('contents')}
            className="rounded-full"
            onClick={onContents}
            size="icon"
            type="button"
            variant="ghost"
          >
            <TableOfContents aria-hidden="true" />
          </Button>
        ) : null}
        <Button className="rounded-full px-5" onClick={onAdd} type="button">
          <Plus aria-hidden="true" data-icon="inline-start" />
          {t('addMemory')}
        </Button>
        <JournalStoryMenu
          className="rounded-full"
          hasCover={hasCover}
          onChooseCover={onChooseCover}
        />
      </div>
    </div>
  );
}

/** The same actions, set in the header from `lg` up. */
export function JournalHeadActions({
  hasCover,
  onAdd,
  onChooseCover,
  onContents,
  overCover,
}: Readonly<JournalActionsProps & { overCover: boolean }>) {
  const t = useTranslations('memories.journal');
  const onImage = overCover
    ? 'text-media-fallback-foreground hover:bg-neutral-950/40 hover:text-media-fallback-foreground'
    : undefined;

  return (
    <>
      {onContents ? (
        <Button
          className={cn(onImage)}
          onClick={onContents}
          size="sm"
          type="button"
          variant="ghost"
        >
          <TableOfContents aria-hidden="true" data-icon="inline-start" />
          {t('contents')}
        </Button>
      ) : null}
      <JournalStoryMenu
        className={cn('size-9', onImage)}
        hasCover={hasCover}
        onChooseCover={onChooseCover}
      />
      <Button className="rounded-full" onClick={onAdd} size="sm" type="button">
        <Plus aria-hidden="true" data-icon="inline-start" />
        {t('addMemory')}
      </Button>
    </>
  );
}
