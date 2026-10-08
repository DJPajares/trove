'use client';

import { Ellipsis, ImagePlus, Plus, TableOfContents } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

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

/** Scrolling less than this either way is a tremor, not a direction. */
const SCROLL_INTENT_PX = 8;
/** On the cover, before the journal has begun, there is nothing to act on yet. */
const NEAR_TOP_PX = 80;

/**
 * The dock follows the reader's direction: scrolling down brings it in,
 * scrolling up puts it away, so it is there while the journal is being read
 * on and out of the way when they go back. It stays away on the cover.
 */
function useRevealOnScrollDown() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let lastY = window.scrollY;
    const update = () => {
      const y = window.scrollY;
      if (y <= NEAR_TOP_PX) setVisible(false);
      else if (y > lastY + SCROLL_INTENT_PX) setVisible(true);
      else if (y < lastY - SCROLL_INTENT_PX) setVisible(false);
      else return;
      lastY = y;
    };

    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  return visible;
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
  const visible = useRevealOnScrollDown();

  return (
    <div
      aria-hidden={!visible}
      className="pointer-events-none sticky bottom-[calc(var(--safe-bottom)+1rem)] z-[var(--layer-sticky)] mt-6 mb-[calc(var(--safe-bottom)+1rem)] flex justify-center lg:hidden"
      data-slot="journal-dock"
    >
      <div
        className={cn(
          'flex items-center gap-1 rounded-full border border-border-subtle bg-paper-print/95 p-1 shadow-[var(--shadow-elevated)] backdrop-blur transition-[opacity,transform] duration-[var(--motion-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none supports-[backdrop-filter]:bg-paper-print/85',
          visible
            ? 'pointer-events-auto translate-y-0 opacity-100'
            : 'pointer-events-none translate-y-4 opacity-0',
        )}
        data-translucent-surface
        // Hidden, it is also out of the tab order and the accessibility tree.
        inert={!visible}
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
