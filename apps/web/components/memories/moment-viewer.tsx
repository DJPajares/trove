'use client';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  ImageOff,
  ImagePlus,
  Pencil,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { journalSerif } from '@/components/memories/journal-font';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { DialogOverlay, DialogPortal } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  deleteMemory,
  MemoriesApiError,
  type Memory,
  type MemoryPhoto,
  reorderHighlights,
  setStoryCoverPhoto,
  type StoryCover,
  updateMemory,
} from '@/lib/memories/api';
import { moveHighlightOrder } from '@/lib/memories/highlights';
import { cn } from '@/lib/utils';
import * as Icons from '@/lib/icons';

function ViewerPhoto({
  alt,
  onError,
  photo,
}: Readonly<{ alt: string; onError: () => void; photo: MemoryPhoto }>) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!photo.url || failedUrl === photo.url) {
    return (
      <span className="flex aspect-[4/5] w-[min(70vw,22rem)] items-center justify-center bg-surface-sunken text-muted-foreground">
        <ImageOff aria-hidden="true" className="size-6" />
        <span className="sr-only">{alt}</span>
      </span>
    );
  }

  return (
    // A photograph shown whole, at its own proportions, which the stored Memory
    // does not record - so a plain image sized by the browser, not a fixed frame.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={alt}
      className="block max-h-[calc(100svh-var(--safe-top)-var(--safe-bottom)-17rem)] w-auto max-w-full object-contain"
      decoding="async"
      onError={() => {
        setFailedUrl(photo.url);
        onError();
      }}
      src={photo.url}
    />
  );
}

/**
 * One moment, opened: its photographs large, as prints lifted off the page,
 * with what the traveller wrote beneath them. This is where a Memory is looked
 * after - edited, made a Highlight, given the cover, moved within Highlights,
 * or deleted - so the reading flow itself never carries a toolbar, and every
 * one of these stays reachable by keyboard and screen reader (PRD 31.2).
 *
 * Photographs swipe and snap natively; the buttons and the arrow keys do the
 * same for anyone not swiping. Only the photograph in view and its neighbours
 * are mounted, so a Memory with twenty photographs loads three.
 */
export function MomentViewer({
  context,
  highlightOrder,
  initialPhotoIndex,
  isCover,
  memory,
  onClosed,
  onCoverChanged,
  onDeleted,
  onEdit,
  onFeedback,
  onOpenChange,
  onPhotoError,
  onUpdated,
  open,
  tripId,
}: Readonly<{
  context: string;
  /** The ids of every Highlight, in their curated order. */
  highlightOrder: string[];
  initialPhotoIndex: number;
  isCover: (photoId: string) => boolean;
  /** The moment shown; it stays set while the viewer closes, so it can animate out. */
  memory: Memory | null;
  /** The viewer has finished closing; the moment can be let go. */
  onClosed: () => void;
  onCoverChanged: (cover: StoryCover | null) => void;
  onDeleted: (memory: Memory) => void;
  onEdit: (memory: Memory) => void;
  onFeedback: (message: string) => void;
  onOpenChange: (open: boolean) => void;
  onPhotoError: (photo: MemoryPhoto) => void;
  /** After a change the server accepted: the journal reads its Memories again. */
  onUpdated: () => Promise<unknown> | void;
  open: boolean;
  tripId: string;
}>) {
  const t = useTranslations('memories.journal.viewer');
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(initialPhotoIndex);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const photos = memory?.photos ?? [];
  const total = photos.length;
  const current = photos[active] ?? null;
  const highlightIndex = memory ? highlightOrder.indexOf(memory.id) : -1;

  useEffect(() => {
    if (open) setActive(Math.min(initialPhotoIndex, Math.max(0, total - 1)));
  }, [initialPhotoIndex, open, total, memory?.id]);

  // Open on the photograph that was tapped, without animating there.
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!open || !track) return;
    track.scrollLeft = initialPhotoIndex * track.clientWidth;
  }, [initialPhotoIndex, open, memory?.id]);

  function goTo(index: number) {
    const track = trackRef.current;
    const next = Math.max(0, Math.min(total - 1, index));
    setActive(next);
    if (!track) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    track.scrollTo({ behavior: reduced ? 'auto' : 'smooth', left: next * track.clientWidth });
  }

  async function act(run: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await run();
      await onUpdated();
      onFeedback(done);
    } catch (error) {
      onFeedback(
        error instanceof MemoriesApiError && error.status === 404 ? t('syncing') : t('error'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (!memory) return null;

  const coverPhoto = current && isCover(current.id);
  const localOnly = current?.url?.startsWith('blob:') ?? false;

  return (
    <DialogPrimitive.Root
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) onClosed();
      }}
      open={open}
    >
      <DialogPortal>
        <DialogOverlay className="bg-paper/95 dark:bg-paper/95" />
        <DialogPrimitive.Popup
          className={cn(
            journalSerif.variable,
            'fixed inset-0 z-[var(--layer-overlay)] flex flex-col bg-paper pt-[var(--safe-top)] pb-[var(--safe-bottom)] text-foreground outline-none duration-[var(--motion-standard)] data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
          )}
          data-slot="dialog-content"
        >
          <DialogPrimitive.Title className="sr-only">{t('title')}</DialogPrimitive.Title>

          <div className="grid h-14 shrink-0 grid-cols-[5rem_minmax(0,1fr)_5rem] items-center px-3">
            <DialogPrimitive.Close
              render={<Button aria-label={t('close')} size="icon" type="button" variant="ghost" />}
            >
              <X aria-hidden="true" />
            </DialogPrimitive.Close>
            <p
              aria-live="polite"
              className="text-center text-[0.68rem] font-semibold tracking-[0.2em] text-muted-foreground uppercase tabular-nums"
            >
              {total > 1 ? t('position', { count: total, index: active + 1 }) : null}
            </p>
          </div>

          <div className="relative min-h-0 flex-1">
            {total ? (
              <div
                aria-label={t('photos')}
                aria-roledescription="carousel"
                className="flex h-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] outline-none focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:scroll-auto [&::-webkit-scrollbar]:hidden"
                onKeyDown={(event) => {
                  if (event.key === 'ArrowLeft') {
                    event.preventDefault();
                    goTo(active - 1);
                  }
                  if (event.key === 'ArrowRight') {
                    event.preventDefault();
                    goTo(active + 1);
                  }
                }}
                onScroll={(event) => {
                  const track = event.currentTarget;
                  const index = Math.round(track.scrollLeft / Math.max(track.clientWidth, 1));
                  if (index !== active && index >= 0 && index < total) setActive(index);
                }}
                ref={trackRef}
                role="group"
                tabIndex={total > 1 ? 0 : -1}
              >
                {photos.map((photo, index) => (
                  <div
                    aria-hidden={index !== active}
                    aria-roledescription="slide"
                    className="flex h-full w-full shrink-0 snap-center items-center justify-center px-6 py-4"
                    key={photo.id}
                  >
                    {Math.abs(index - active) <= 1 ? (
                      <span className="inline-flex rounded-[3px] bg-paper-print p-2.5 pb-7 shadow-[var(--shadow-print)]">
                        <ViewerPhoto
                          alt={t('photoAlt', { count: total, index: index + 1 })}
                          onError={() => onPhotoError(photo)}
                          photo={photo}
                        />
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center px-6">
                <p className="relative w-full max-w-xl rounded-[2px] bg-paper-print py-6 ps-14 pe-8 font-journal text-[1.625rem] leading-[2.25rem] font-normal whitespace-pre-wrap text-pretty italic shadow-[var(--shadow-print)] [overflow-wrap:anywhere]">
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 start-9 w-px bg-accent-strong/55"
                  />
                  {memory.note}
                </p>
              </div>
            )}

            {total > 1 ? (
              <>
                <Button
                  aria-label={t('previous')}
                  className="absolute top-1/2 left-2 hidden -translate-y-1/2 rounded-full bg-paper-print/90 shadow-[var(--shadow-control)] sm:inline-flex"
                  disabled={active === 0}
                  onClick={() => goTo(active - 1)}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <ChevronLeft aria-hidden="true" />
                </Button>
                <Button
                  aria-label={t('next')}
                  className="absolute top-1/2 right-2 hidden -translate-y-1/2 rounded-full bg-paper-print/90 shadow-[var(--shadow-control)] sm:inline-flex"
                  disabled={active === total - 1}
                  onClick={() => goTo(active + 1)}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <ChevronRight aria-hidden="true" />
                </Button>
              </>
            ) : null}
          </div>

          <div className="mx-auto w-full max-w-xl shrink-0 px-6 pt-2 pb-4 text-center">
            {total && memory.note ? (
              <p className="line-clamp-4 font-journal text-xl leading-[1.4] font-normal whitespace-pre-wrap text-pretty italic [overflow-wrap:anywhere]">
                {memory.note}
              </p>
            ) : null}
            <p className="mt-2 text-[0.68rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
              {context}
            </p>

            <div className="mt-4 flex items-center justify-center gap-1">
              <Button
                className="rounded-full"
                disabled={busy}
                onClick={() => onEdit(memory)}
                size="sm"
                type="button"
                variant="outline"
              >
                <Pencil aria-hidden="true" data-icon="inline-start" />
                {t('edit')}
              </Button>
              <Button
                aria-pressed={memory.isHighlight}
                className={cn('rounded-full', memory.isHighlight && 'text-accent-strong')}
                disabled={busy}
                onClick={() =>
                  void act(
                    () => updateMemory(tripId, memory.id, { isHighlight: !memory.isHighlight }),
                    memory.isHighlight ? t('unhighlighted') : t('highlighted'),
                  )
                }
                size="sm"
                type="button"
                variant="ghost"
              >
                <Icons.Highlight
                  aria-hidden="true"
                  className={memory.isHighlight ? 'fill-current' : undefined}
                  data-icon="inline-start"
                />
                {t('highlight')}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      aria-label={t('more')}
                      className="rounded-full"
                      disabled={busy}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    />
                  }
                >
                  <Ellipsis aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-56">
                  {current && !localOnly ? (
                    <DropdownMenuItem
                      disabled={Boolean(coverPhoto)}
                      onClick={() =>
                        void act(async () => {
                          onCoverChanged(await setStoryCoverPhoto(tripId, current.id));
                        }, t('coverChanged'))
                      }
                    >
                      <ImagePlus aria-hidden="true" />
                      {coverPhoto ? t('isCover') : t('useAsCover')}
                    </DropdownMenuItem>
                  ) : null}
                  {memory.isHighlight ? (
                    <>
                      <DropdownMenuItem
                        disabled={highlightIndex <= 0}
                        onClick={() => {
                          const order = moveHighlightOrder(highlightOrder, memory.id, -1);
                          if (order) void act(() => reorderHighlights(tripId, order), t('moved'));
                        }}
                      >
                        <ArrowUp aria-hidden="true" />
                        {t('moveEarlier')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={highlightIndex < 0 || highlightIndex >= highlightOrder.length - 1}
                        onClick={() => {
                          const order = moveHighlightOrder(highlightOrder, memory.id, 1);
                          if (order) void act(() => reorderHighlights(tripId, order), t('moved'));
                        }}
                      >
                        <ArrowDown aria-hidden="true" />
                        {t('moveLater')}
                      </DropdownMenuItem>
                    </>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setConfirmDelete(true)} variant="destructive">
                    <Trash2 aria-hidden="true" />
                    {t('delete')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <AlertDialog onOpenChange={setConfirmDelete} open={confirmDelete}>
            <AlertDialogContent size="sm">
              <AlertDialogHeader>
                <AlertDialogMedia>
                  <TriangleAlert aria-hidden="true" />
                </AlertDialogMedia>
                <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
                <AlertDialogDescription>{t('deleteDescription')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void deleteMemory(
                      tripId,
                      memory.id,
                      memory.photos.map((photo) => photo.url),
                    )
                      .then(() => {
                        setConfirmDelete(false);
                        onDeleted(memory);
                      })
                      .catch((error: unknown) =>
                        onFeedback(
                          error instanceof MemoriesApiError && error.status === 404
                            ? t('syncing')
                            : t('error'),
                        ),
                      )
                      .finally(() => setBusy(false));
                  }}
                  variant="destructive"
                >
                  {t('deleteConfirm')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}
