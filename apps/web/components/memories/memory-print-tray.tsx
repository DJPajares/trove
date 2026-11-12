'use client';

import { ArrowLeft, ArrowRight, ImagePlus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, type CSSProperties } from 'react';

import { MediaFrame } from '@/components/media-frame';
import { journalPrintClassName } from '@/components/memories/journal-print';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { MemoryPhoto } from '@/lib/memories/api';
import { printTilts } from '@/lib/memories/photo-layout';
import { cn } from '@/lib/utils';
import { ScrollShadow } from '@/components/ui/scroll-shadow';

const PRINT_SIZES = '5.5rem';

/**
 * A memory's photographs as the journal lays them down - small prints with the
 * same lean they have on the page - rather than a list of file names. Each
 * print opens what can be done to it; the last place in the row is an empty
 * print that adds more.
 */
export function MemoryPrintTray({
  busyPhotoId,
  memoryId,
  onAdd,
  onMove,
  onRemove,
  onRemovePending,
  pending,
  photos,
  uploading,
}: Readonly<{
  busyPhotoId: string | null;
  /** Seeds the lean, so a print leans the same way here as in the journal. */
  memoryId: string | null;
  onAdd: () => void;
  onMove: (photoId: string, direction: -1 | 1) => void;
  onRemove: (photo: MemoryPhoto) => void;
  onRemovePending: (index: number) => void;
  /** Chosen for a memory not yet saved: shown from the device, uploaded on save. */
  pending: readonly File[];
  photos: readonly MemoryPhoto[];
  uploading: boolean;
}>) {
  const t = useTranslations('memories.editor');
  const count = photos.length + pending.length;
  const tilts = printTilts(memoryId ?? 'new-memory', Math.max(1, count + 1));
  // Object URLs for photos still on the device, released when they leave.
  const pendingUrls = useMemo(() => pending.map((file) => URL.createObjectURL(file)), [pending]);
  useEffect(() => () => pendingUrls.forEach((url) => URL.revokeObjectURL(url)), [pendingUrls]);

  const print = (index: number) => ({ '--tilt': `${tilts[index] ?? 0}deg` }) as CSSProperties;

  return (
    <ScrollShadow
      orientation="horizontal"
      render={<ul />}
      aria-label={t('photoList')}
      className="interaction-scrollbar -mx-2 flex gap-3.5 px-3 pt-2 pb-6"
    >
      {photos.map((photo, index) => (
        <li className="w-[5.5rem] shrink-0" key={photo.id}>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  aria-label={t('photoActions', { count, index: index + 1 })}
                  className={cn(journalPrintClassName, busyPhotoId === photo.id && 'opacity-60')}
                  disabled={busyPhotoId === photo.id}
                  style={print(index)}
                  type="button"
                />
              }
            >
              <MediaFrame
                alt=""
                className="aspect-[4/5] rounded-[1px]"
                dataSlot="memory-editor-print"
                sizes={PRINT_SIZES}
                source={photo.url ? { kind: 'memory', url: photo.url } : { kind: 'fallback' }}
                variant="card"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-44">
              <DropdownMenuItem disabled={index === 0} onClick={() => onMove(photo.id, -1)}>
                <ArrowLeft aria-hidden="true" />
                {t('moveEarlier')}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={index === photos.length - 1}
                onClick={() => onMove(photo.id, 1)}
              >
                <ArrowRight aria-hidden="true" />
                {t('moveLater')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onRemove(photo)} variant="destructive">
                <Trash2 aria-hidden="true" />
                {t('removeFromMemory')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </li>
      ))}
      {pending.map((file, index) => (
        <li className="w-[5.5rem] shrink-0" key={`${file.name}-${index}`}>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  aria-label={t('photoActions', { count, index: photos.length + index + 1 })}
                  className={journalPrintClassName}
                  style={print(photos.length + index)}
                  type="button"
                />
              }
            >
              {/* Still on this device, so it is shown from there rather than a link. */}
              <span className="block aspect-[4/5] overflow-hidden rounded-[1px] bg-muted">
                <img alt="" className="size-full object-cover" src={pendingUrls[index]} />
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-44">
              <DropdownMenuItem onClick={() => onRemovePending(index)} variant="destructive">
                <Trash2 aria-hidden="true" />
                {t('removeFromMemory')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </li>
      ))}
      <li className="w-[5.5rem] shrink-0">
        <button
          aria-label={uploading ? t('uploadingPhotos') : t('addPhotos')}
          className="flex aspect-[4/5] w-full rotate-[var(--tilt)] flex-col items-center justify-center gap-1.5 rounded-[3px] border-[1.5px] border-dashed border-border-strong text-muted-foreground outline-none transition-colors duration-[var(--motion-standard)] hover:border-brand hover:text-brand focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60 motion-reduce:transition-none"
          disabled={uploading}
          onClick={onAdd}
          style={print(count)}
          type="button"
        >
          <ImagePlus aria-hidden="true" className="size-5" />
          <span className="text-xs font-medium">
            {uploading ? t('uploadingPhotos') : t('addPrint')}
          </span>
        </button>
      </li>
    </ScrollShadow>
  );
}
