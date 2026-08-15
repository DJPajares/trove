'use client';

import { Check, ImageOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { setStoryCoverPhoto, type Memory, type StoryCover } from '@/lib/memories/api';

/**
 * The Trip Story cover is chosen from photos the traveller already uploaded to
 * their Memories, never a separate upload, so it always stays user-owned media.
 */
export function StoryCoverPicker({
  memories,
  onOpenChange,
  onSelected,
  open,
  storyCover,
  tripId,
}: Readonly<{
  memories: Memory[];
  onOpenChange: (open: boolean) => void;
  onSelected: (cover: StoryCover | null) => void;
  open: boolean;
  storyCover: StoryCover | null;
  tripId: string;
}>) {
  const t = useTranslations('memories.story.cover');
  const [busyId, setBusyId] = useState<string | null>(null);

  const photos = memories.flatMap((memory) => memory.photos.map((photo) => ({ memory, photo })));

  async function choose(photoId: string | null) {
    setBusyId(photoId ?? 'clear');
    try {
      const cover = await setStoryCoverPhoto(tripId, photoId);
      onSelected(cover);
      onOpenChange(false);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent closeLabel={t('close')}>
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          {photos.length ? (
            <ul className="grid grid-cols-3 gap-2">
              {photos.map(({ memory, photo }) => (
                <li className="relative" key={photo.id}>
                  <button
                    aria-pressed={storyCover?.photoId === photo.id}
                    className="block aspect-square w-full overflow-hidden rounded-[var(--radius-md)] outline-none ring-brand focus-visible:ring-3"
                    disabled={busyId !== null}
                    onClick={() => void choose(photo.id)}
                    type="button"
                  >
                    {photo.url ? (
                      <img
                        alt={memory.note ?? t('photoAlt')}
                        className="size-full object-cover"
                        loading="lazy"
                        src={photo.url}
                      />
                    ) : (
                      <span className="flex size-full items-center justify-center bg-muted/40 text-muted-foreground">
                        <ImageOff aria-hidden="true" className="size-5" />
                      </span>
                    )}
                  </button>
                  {storyCover?.photoId === photo.id ? (
                    <span className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full bg-brand text-primary-foreground">
                      <Check aria-hidden="true" className="size-3.5" />
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-4 text-sm leading-6 text-muted-foreground">{t('empty')}</p>
          )}
        </div>

        {storyCover ? (
          <SheetFooter>
            <Button disabled={busyId !== null} onClick={() => void choose(null)} variant="outline">
              {t('remove')}
            </Button>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
