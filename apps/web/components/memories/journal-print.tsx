'use client';

import type { CSSProperties } from 'react';

import { MediaFrame } from '@/components/media-frame';
import type { MemoryPhoto } from '@/lib/memories/api';
import { cn } from '@/lib/utils';

/**
 * One photograph as a print: a paper border, a soft contact shadow, and a lean
 * of a degree or two that is the same on every visit. It straightens a little
 * under a pointer that can hover - a print picked up, not a card lifted.
 *
 * The photograph goes through `MediaFrame`, which reserves its shape before a
 * byte arrives, fades it in, and falls back to Trove's branded tile when it
 * cannot load. That fallback is keyed by URL, so once the journal has fetched
 * a fresh signature the print simply tries again.
 */
export function JournalPrint({
  aspect,
  className,
  label,
  lip = false,
  onOpen,
  onPhotoError,
  photo,
  sizes,
  tilt,
}: Readonly<{
  /** A Tailwind aspect utility for the photograph inside the border. */
  aspect: string;
  className?: string;
  /** What opening it does, for a screen reader: "Open photo 1 of 3". */
  label: string;
  /** A deeper lower border, the way a print's lip sits below its picture. */
  lip?: boolean;
  onOpen: () => void;
  onPhotoError: (photo: MemoryPhoto) => void;
  photo: MemoryPhoto;
  sizes: string;
  tilt: number;
}>) {
  return (
    <button
      aria-label={label}
      className={cn(
        'group/print relative block w-full rotate-[var(--tilt)] rounded-[3px] bg-paper-print p-[clamp(0.4rem,1.8vw,0.65rem)] text-start shadow-[var(--shadow-print)] outline-none transition-transform duration-[var(--motion-slow)] ease-[var(--ease-standard)] focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none [@media(hover:hover)]:hover:rotate-[calc(var(--tilt)*0.35)]',
        lip && 'pb-[clamp(1.5rem,6vw,2.4rem)]',
        className,
      )}
      onClick={onOpen}
      style={{ '--tilt': `${tilt}deg` } as CSSProperties}
      type="button"
    >
      <MediaFrame
        alt=""
        className={cn('rounded-[1px]', aspect)}
        dataSlot="journal-print"
        onUnreachable={() => onPhotoError(photo)}
        sizes={sizes}
        source={photo.url ? { kind: 'memory', url: photo.url } : { kind: 'fallback' }}
        variant="card"
      />
    </button>
  );
}
